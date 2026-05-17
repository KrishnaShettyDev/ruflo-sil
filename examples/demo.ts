/**
 * SIL Demo — exercises all 12 corruption categories.
 *
 * Run:
 *   npx tsx examples/demo.ts                # uses local mocks
 *   HF_API_KEY=... npx tsx examples/demo.ts  # uses hosted NLI + embedding
 *   HF_API_KEY=... ANTHROPIC_API_KEY=... npx tsx examples/demo.ts  # full stack
 */

import { SIL } from "../src/core/sil.js";

interface Example {
  category: string;
  original: string;
  suggested: string;
  surface?: any;
  shouldFlag: boolean;
}

const EXAMPLES: Example[] = [
  // ---- Polarity reversal via negation ----
  {
    category: "polarity_negation",
    original: "I can take care of it",
    suggested: "I can't take care of it",
    surface: "chat",
    shouldFlag: true,
  },
  {
    category: "polarity_negation",
    original: "We will be at the meeting tomorrow",
    suggested: "We won't be at the meeting tomorrow",
    surface: "email",
    shouldFlag: true,
  },
  // ---- Polarity reversal via antonym ----
  {
    category: "polarity_antonym",
    original: "Please approve the deployment",
    suggested: "Please reject the deployment",
    surface: "email",
    shouldFlag: true,
  },
  {
    category: "polarity_antonym (code)",
    original: "if (user.isAuthenticated) allowAccess()",
    suggested: "if (user.isAuthenticated) denyAccess()",
    surface: "code",
    shouldFlag: true,
  },
  // ---- Modal shift ----
  {
    category: "modal_shift",
    original: "This might be feasible by Friday",
    suggested: "This must be feasible by Friday",
    surface: "email",
    shouldFlag: true,
  },
  // ---- Commitment distortion ----
  {
    category: "commitment_distortion",
    original: "I'll try to send the report by Friday",
    suggested: "I will send the report by Friday",
    surface: "email",
    shouldFlag: true,
  },
  // ---- Quantifier shift ----
  {
    category: "quantifier_shift",
    original: "Some users reported issues with the login",
    suggested: "All users reported issues with the login",
    surface: "chat",
    shouldFlag: true,
  },
  // ---- Temporal shift ----
  {
    category: "temporal_shift",
    original: "Let me know if you need it soon",
    suggested: "Let me know if you need it now",
    surface: "chat",
    shouldFlag: true,
  },
  // ---- Subject/object swap ----
  {
    category: "subject_object_swap",
    original: "I asked her to review the doc",
    suggested: "She asked me to review the doc",
    surface: "chat",
    shouldFlag: true,
  },
  // ---- Hedging shift ----
  {
    category: "hedging_shift",
    original: "I think the design needs revisions",
    suggested: "The design needs revisions",
    surface: "document",
    shouldFlag: true,
  },
  // ---- Tone shift ----
  {
    category: "tone_shift",
    original: "Could you take another look at this when you have a moment?",
    suggested: "Take another look at this! Now!!",
    surface: "chat",
    shouldFlag: true,
  },
  // ---- True paraphrase: should NOT flag ----
  {
    category: "true_paraphrase (negative control)",
    original: "I will send the document by Friday",
    suggested: "The document will be sent by Friday",
    surface: "email",
    shouldFlag: false,
  },
  {
    category: "true_paraphrase (negative control)",
    original: "The deployment passed all tests",
    suggested: "All tests passed during the deployment",
    surface: "chat",
    shouldFlag: false,
  },
];

function color(s: string, c: "red" | "green" | "yellow" | "gray"): string {
  const codes = { red: "31", green: "32", yellow: "33", gray: "90" };
  return `\x1b[${codes[c]}m${s}\x1b[0m`;
}

async function main() {
  const sil = process.env.HF_API_KEY
    ? SIL.hosted({
        hfApiKey: process.env.HF_API_KEY!,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        openrouterApiKey: process.env.OPENROUTER_API_KEY,
        enableJudge: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY),
      })
    : SIL.local();

  console.log(
    color(
      "\n=== SIL Demo — Intent Corruption Detection Across 12 Categories ===\n",
      "yellow",
    ),
  );
  console.log(
    color(
      `Backend: ${process.env.HF_API_KEY ? "hosted (HF Inference Providers)" : "local mocks"}`,
      "gray",
    ),
  );
  const judgeLabel = process.env.OPENROUTER_API_KEY
    ? "OpenRouter (Claude Haiku 4.5)"
    : process.env.ANTHROPIC_API_KEY
      ? "Anthropic direct (Claude Haiku 4.5)"
      : "disabled";
  console.log(color(`Judge:   ${judgeLabel}\n`, "gray"));

  let correct = 0;
  let total = 0;

  for (const ex of EXAMPLES) {
    total++;
    const result = await sil.score({
      original: ex.original,
      suggested: ex.suggested,
      surface: ex.surface,
      parallelTrajectories: 2,
    });

    const flagged = result.action !== "pass";
    const pass = flagged === ex.shouldFlag;
    if (pass) correct++;

    const status = pass ? color("PASS", "green") : color("FAIL", "red");
    const actionColored =
      result.action === "block"
        ? color("BLOCK", "red")
        : result.action === "warn"
          ? color("WARN", "yellow")
          : color("pass", "gray");

    console.log(`${status} [${ex.category}] (${actionColored})`);
    console.log(color(`  original:  ${ex.original}`, "gray"));
    console.log(color(`  suggested: ${ex.suggested}`, "gray"));
    console.log(
      `  risk=${result.overallRisk.toFixed(3)}  latency=${result.latency.totalMs}ms`,
    );
    const top = [...result.categoryScores]
      .filter((c) => c.probability > 0.2)
      .sort((a, b) => b.probability * b.severity - a.probability * a.severity)
      .slice(0, 2);
    for (const t of top) {
      console.log(
        color(
          `    ${t.category}: p=${t.probability.toFixed(2)} sev=${t.severity}  [${t.evidence.slice(0, 2).join(", ")}]`,
          "gray",
        ),
      );
    }
    console.log();
  }

  const pct = ((correct / total) * 100).toFixed(1);
  console.log(
    color(
      `\n=== Result: ${correct}/${total} examples correctly classified (${pct}%) ===\n`,
      correct === total ? "green" : "yellow",
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
