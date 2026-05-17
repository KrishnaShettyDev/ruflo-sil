/**
 * Cascade analyzer — Recursive Semantic Drift (RSD).
 *
 * Given a multi-hop AI pipeline (e.g., email_assistant -> summarizer -> reply_drafter),
 * trace intent divergence at each hop and characterize the drift pattern.
 *
 * This is the empirical core of paper Section 7. It is also useful at runtime
 * to flag when a ruflo swarm is corrupting intent across agent handoffs.
 */

import { SIL } from "../core/sil.js";
import {
  CascadeReport,
  CorruptionCategory,
  PipelineHop,
  Surface,
  ALL_CATEGORIES,
} from "../types/index.js";

export interface CascadeInput {
  pipelineId: string;
  hops: Array<{
    agentId: string;
    input: string;
    output: string;
  }>;
  surface?: Surface;
}

export class CascadeAnalyzer {
  constructor(private readonly sil: SIL) {}

  async analyze(input: CascadeInput): Promise<CascadeReport> {
    const surface = input.surface ?? "agent_pipeline";
    const hops: PipelineHop[] = [];

    for (let i = 0; i < input.hops.length; i++) {
      const h = input.hops[i];
      const risk = await this.sil.score({
        original: h.input,
        suggested: h.output,
        surface,
        parallelTrajectories: 2,
      });
      hops.push({
        hopIndex: i,
        agentId: h.agentId,
        input: h.input,
        output: h.output,
        risk,
      });
    }

    // Cumulative drift: compare hop 0 input vs final hop output directly
    const firstInput = input.hops[0]?.input ?? "";
    const lastOutput = input.hops[input.hops.length - 1]?.output ?? "";
    const cumulativeRisk = await this.sil.score({
      original: firstInput,
      suggested: lastOutput,
      surface,
      parallelTrajectories: 3,
    });

    const driftByCategory = {} as Record<CorruptionCategory, number>;
    for (const cat of ALL_CATEGORIES) {
      const s = cumulativeRisk.categoryScores.find((c) => c.category === cat);
      driftByCategory[cat] = s?.probability ?? 0;
    }

    // Characterize drift pattern from per-hop risks
    const perHopRisks = hops.map((h) => h.risk?.overallRisk ?? 0);
    const pattern = classifyDriftPattern(perHopRisks);

    return {
      pipelineId: input.pipelineId,
      hops,
      cumulativeDrift: cumulativeRisk.overallRisk,
      driftByCategory,
      driftPattern: pattern,
    };
  }
}

function classifyDriftPattern(
  risks: number[],
): CascadeReport["driftPattern"] {
  if (risks.length < 2) return "noisy";

  // Compute deltas
  const deltas: number[] = [];
  for (let i = 1; i < risks.length; i++) {
    deltas.push(risks[i] - risks[i - 1]);
  }

  // If the variance is high relative to the trend, it's noisy
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const variance =
    deltas.reduce((a, d) => a + (d - meanDelta) ** 2, 0) / deltas.length;

  if (Math.sqrt(variance) > Math.abs(meanDelta) * 2 && Math.abs(meanDelta) < 0.05) {
    return "noisy";
  }

  // Linear: roughly constant positive delta
  const allPositive = deltas.every((d) => d > 0);
  const allNegative = deltas.every((d) => d < 0);
  if (allPositive || allNegative) {
    // Exponential if deltas grow; linear if roughly constant; saturating if shrink
    const firstHalf = deltas.slice(0, Math.ceil(deltas.length / 2));
    const secondHalf = deltas.slice(Math.ceil(deltas.length / 2));
    const meanFirst = firstHalf.reduce((a, b) => a + b, 0) / Math.max(firstHalf.length, 1);
    const meanSecond = secondHalf.reduce((a, b) => a + b, 0) / Math.max(secondHalf.length, 1);
    if (Math.abs(meanSecond) > Math.abs(meanFirst) * 1.5) return "exponential";
    if (Math.abs(meanSecond) < Math.abs(meanFirst) * 0.6) return "saturating";
    return "linear";
  }

  return "noisy";
}
