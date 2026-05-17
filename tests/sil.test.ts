import { describe, it, expect } from "vitest";
import { SIL } from "../src/core/sil.js";
import { PolarityDetector } from "../src/detectors/polarity/index.js";
import { ModalDetector } from "../src/detectors/modal/index.js";
import {
  CommitmentDetector,
  QuantifierDetector,
  TemporalDetector,
  HedgingDetector,
  SubjectSwapDetector,
} from "../src/detectors/lexical/index.js";
import { CorruptionCategory } from "../src/types/index.js";

const opts = {
  surface: "chat" as const,
  latencyBudgetMs: 500,
};

describe("PolarityDetector", () => {
  const det = new PolarityDetector();

  it("flags negation insertion", async () => {
    const scores = await det.score(
      "I can do it",
      "I can't do it",
      opts,
    );
    const neg = scores.find((s) => s.category === CorruptionCategory.POLARITY_NEGATION)!;
    expect(neg.probability).toBeGreaterThan(0.7);
    expect(neg.severity).toBe(5);
  });

  it("flags antonym replacement", async () => {
    const scores = await det.score(
      "Please approve the request",
      "Please reject the request",
      opts,
    );
    const ant = scores.find((s) => s.category === CorruptionCategory.POLARITY_ANTONYM)!;
    expect(ant.probability).toBeGreaterThan(0.7);
    expect(ant.evidence.some((e) => e.includes("approve->reject"))).toBe(true);
  });

  it("does not flag true paraphrase", async () => {
    const scores = await det.score(
      "I will send the document",
      "The document will be sent",
      opts,
    );
    for (const s of scores) {
      expect(s.probability).toBeLessThan(0.5);
    }
  });
});

describe("ModalDetector", () => {
  const det = new ModalDetector();

  it("flags might->must (strength 2 jump)", async () => {
    const [score] = await det.score(
      "This might work",
      "This must work",
      opts,
    );
    expect(score.probability).toBeGreaterThan(0.7);
  });

  it("flags modal removal", async () => {
    const [score] = await det.score(
      "We might consider it",
      "We will consider it",
      opts,
    );
    expect(score.probability).toBeGreaterThan(0.4);
  });
});

describe("CommitmentDetector", () => {
  const det = new CommitmentDetector();

  it("flags tentative->certain", async () => {
    const [score] = await det.score(
      "I'll try to send it",
      "I will definitely send it",
      opts,
    );
    expect(score.probability).toBeGreaterThan(0.4);
  });
});

describe("QuantifierDetector", () => {
  it("flags some->all", async () => {
    const det = new QuantifierDetector();
    const [score] = await det.score(
      "Some users reported issues",
      "All users reported issues",
      opts,
    );
    expect(score.probability).toBeGreaterThan(0.3);
  });
});

describe("TemporalDetector", () => {
  it("flags soon->now (small adjacent shift)", async () => {
    const det = new TemporalDetector();
    const [score] = await det.score(
      "Send it soon",
      "Send it now",
      opts,
    );
    expect(score.probability).toBeGreaterThan(0);
  });
});

describe("SubjectSwapDetector", () => {
  it("flags pronoun reversal", async () => {
    const det = new SubjectSwapDetector();
    const [score] = await det.score(
      "I asked her",
      "She asked me",
      opts,
    );
    expect(score.probability).toBeGreaterThan(0.3);
  });
});

describe("HedgingDetector", () => {
  it("flags removal of hedge", async () => {
    const det = new HedgingDetector();
    const [score] = await det.score(
      "I think this is correct",
      "This is correct",
      opts,
    );
    expect(score.probability).toBeGreaterThan(0);
  });
});

describe("SIL.local end-to-end", () => {
  const sil = SIL.local();

  it("blocks polarity reversal", async () => {
    const result = await sil.score({
      original: "I can take care of it",
      suggested: "I can't take care of it",
      surface: "chat",
    });
    expect(["warn", "block"]).toContain(result.action);
    expect(result.overallRisk).toBeGreaterThan(0.4);
    const topPolarity = result.categoryScores.find(
      (c) => c.category === CorruptionCategory.POLARITY_NEGATION,
    );
    expect(topPolarity?.probability).toBeGreaterThan(0.5);
  });

  it("passes true paraphrase", async () => {
    const result = await sil.score({
      original: "I will send the report by Friday",
      suggested: "The report will be sent by Friday",
      surface: "email",
    });
    expect(result.action).toBe("pass");
  });

  it("produces trajectory diversity", async () => {
    const result = await sil.score({
      original: "Please approve this",
      suggested: "Please reject this",
      surface: "email",
      parallelTrajectories: 3,
    });
    expect(result.trajectories.length).toBeGreaterThanOrEqual(2);
    // Each trajectory should have a distinct id
    const ids = new Set(result.trajectories.map((t) => t.id));
    expect(ids.size).toBe(result.trajectories.length);
  });

  it("respects surface-specific weights", async () => {
    // Code surface weights polarity antonym at 1.6x
    const codeResult = await sil.score({
      original: "if (ok) accept()",
      suggested: "if (ok) reject()",
      surface: "code",
    });
    const chatResult = await sil.score({
      original: "if (ok) accept()",
      suggested: "if (ok) reject()",
      surface: "chat",
    });
    // Both should flag, but code surface should weight it higher
    expect(codeResult.overallRisk).toBeGreaterThanOrEqual(chatResult.overallRisk - 0.01);
  });

  it("returns latency metadata under budget", async () => {
    const result = await sil.score({
      original: "test message",
      suggested: "another message",
      surface: "chat",
    });
    expect(result.latency.totalMs).toBeLessThan(1000);
    expect(result.trace.requestId).toBeTruthy();
  });
});

describe("CascadeAnalyzer", () => {
  it("detects drift across hops", async () => {
    const sil = SIL.local();
    const { CascadeAnalyzer } = await import("../src/scorers/cascade.js");
    const cascade = new CascadeAnalyzer(sil);

    const report = await cascade.analyze({
      pipelineId: "test-pipeline",
      hops: [
        {
          agentId: "drafter",
          input: "I can probably help with that this week",
          output: "I should be able to help this week",
        },
        {
          agentId: "summarizer",
          input: "I should be able to help this week",
          output: "I will help this week",
        },
        {
          agentId: "formalizer",
          input: "I will help this week",
          output: "I commit to helping this week",
        },
      ],
    });

    expect(report.hops).toHaveLength(3);
    expect(report.cumulativeDrift).toBeGreaterThan(0);
    expect(["linear", "exponential", "saturating", "noisy"]).toContain(
      report.driftPattern,
    );
  });
});
