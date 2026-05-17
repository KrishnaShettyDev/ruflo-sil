/**
 * Risk aggregator with parallel-thinking.
 *
 * Inspired by Genie's three techniques applied to intent corruption:
 *
 *  1. Specialized Knowledge Search (Genie) -> Per-user style profile retrieval (knowledge module)
 *  2. Parallel Thinking (Genie)            -> N independent trajectories through different
 *                                              detector mixes; aggregate by voting + max
 *  3. Multi-LLM Design (Genie)             -> Different judges per sub-task (router module)
 *
 * This module owns (2): it constructs N trajectories, runs them in parallel
 * under a latency budget, and aggregates results into a final risk score.
 */

import {
  ALL_CATEGORIES,
  CategoryScore,
  CorruptionCategory,
  Detector,
  DetectorOptions,
  DEFAULT_THRESHOLDS,
  ScoreRequest,
  ScoreResponse,
  Surface,
  ThresholdConfig,
  Trajectory,
  UserStyleProfile,
} from "../types/index.js";

export interface AggregatorConfig {
  /** All detectors available; trajectories select a mix from these. */
  detectors: Detector[];
  /** Per-surface threshold overrides */
  thresholds?: Partial<Record<Surface, ThresholdConfig>>;
  /** Default latency budget per trajectory in ms */
  trajectoryBudgetMs?: number;
}

interface TrajectoryPlan {
  id: string;
  detectorNames: string[];
}

export class RiskAggregator {
  constructor(private readonly config: AggregatorConfig) {}

  /**
   * Build N trajectory plans. Each plan selects a subset of detectors so the
   * trajectories disagree productively (Genie's parallel thinking trick).
   *
   * T1 (fast):  rules-only — polarity + lexical detectors. <5ms target.
   * T2 (NLI):   rules + NLI cross-encoder. <100ms target.
   * T3 (full):  rules + NLI + embedding + LLM judge. <500ms target.
   * T4+ (vote): subsamples of (T1, T2, T3) detectors for ensemble disagreement signal.
   */
  private planTrajectories(n: number): TrajectoryPlan[] {
    const byName = new Map(this.config.detectors.map((d) => [d.name, d]));
    const has = (name: string) => byName.has(name);

    const ruleNames = this.config.detectors
      .filter((d) => d.name.includes("rules"))
      .map((d) => d.name);
    const nli = this.config.detectors.find((d) => d.name.startsWith("nli"))?.name;
    const emb = this.config.detectors.find((d) => d.name.startsWith("embedding"))?.name;
    const judge = this.config.detectors.find((d) => d.name.startsWith("llm-judge"))?.name;

    const trajectories: TrajectoryPlan[] = [];
    trajectories.push({ id: "T1-rules", detectorNames: ruleNames });
    if (nli) trajectories.push({ id: "T2-nli", detectorNames: [...ruleNames, nli] });
    if (nli && emb) {
      trajectories.push({
        id: "T3-deep",
        detectorNames: [...ruleNames, nli, emb, judge].filter((x): x is string => Boolean(x)),
      });
    }
    // Add diversity trajectories that drop one detector each — for disagreement signal
    if (nli && emb && judge && n > trajectories.length) {
      trajectories.push({ id: "T4-no-judge", detectorNames: [...ruleNames, nli, emb] });
    }
    if (nli && judge && n > trajectories.length) {
      trajectories.push({ id: "T5-no-emb", detectorNames: [...ruleNames, nli, judge] });
    }
    return trajectories.slice(0, n).filter((t) =>
      t.detectorNames.every((dn) => has(dn)),
    );
  }

  private getThresholds(surface: Surface): ThresholdConfig {
    return this.config.thresholds?.[surface] ?? DEFAULT_THRESHOLDS[surface];
  }

  /**
   * Aggregate per-category scores within a single trajectory.
   * For each category, multiple detectors may emit scores -- we take the MAX
   * probability weighted by severity.
   */
  private aggregateWithinTrajectory(scores: CategoryScore[]): CategoryScore[] {
    const byCategory = new Map<CorruptionCategory, CategoryScore[]>();
    for (const s of scores) {
      if (!byCategory.has(s.category)) byCategory.set(s.category, []);
      byCategory.get(s.category)!.push(s);
    }

    const out: CategoryScore[] = [];
    for (const cat of ALL_CATEGORIES) {
      const items = byCategory.get(cat) ?? [];
      if (items.length === 0) {
        out.push({ category: cat, probability: 0, severity: 1, evidence: [], source: "none" });
        continue;
      }
      // Soft-OR: 1 - prod(1 - p_i) so multiple weak signals reinforce, strong ones dominate
      let inv = 1;
      const evidence: string[] = [];
      let maxSeverity = 1;
      const sources = new Set<string>();
      for (const s of items) {
        inv *= 1 - s.probability;
        evidence.push(...s.evidence);
        maxSeverity = Math.max(maxSeverity, s.severity);
        sources.add(s.source);
      }
      out.push({
        category: cat,
        probability: 1 - inv,
        severity: maxSeverity,
        evidence,
        source: [...sources].join("+"),
      });
    }
    return out;
  }

  /**
   * Vote across trajectories. For each category, the final probability is
   * computed as a robust aggregate of trajectory probabilities:
   *   - if multiple trajectories disagree wildly: use the median (robust)
   *   - if only one trajectory has signal (others returned 0 because their
   *     detector mix doesn't cover this category): use the max
   * Severity is the MAX across trajectories.
   */
  private aggregateAcrossTrajectories(trajectories: Trajectory[]): CategoryScore[] {
    const out: CategoryScore[] = [];
    for (const cat of ALL_CATEGORIES) {
      const trajScores: CategoryScore[] = trajectories
        .map((t) => t.categoryScores.find((c) => c.category === cat))
        .filter((c): c is CategoryScore => Boolean(c));
      if (trajScores.length === 0) {
        out.push({ category: cat, probability: 0, severity: 1, evidence: [], source: "none" });
        continue;
      }
      const probs = trajScores.map((s) => s.probability);
      const nonZero = probs.filter((p) => p > 0.05);
      let finalProb: number;
      if (nonZero.length === 0) {
        finalProb = 0;
      } else if (nonZero.length === 1) {
        // Only one trajectory saw signal — trust it (don't dilute with zeros)
        finalProb = nonZero[0];
      } else {
        // Multiple trajectories agree — use median for robustness
        const sorted = [...nonZero].sort((a, b) => a - b);
        finalProb =
          sorted.length % 2 === 1
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      }
      const maxSeverity = Math.max(...trajScores.map((s) => s.severity));
      const allEvidence = trajScores.flatMap((s) => s.evidence);
      const evidence = [...new Set(allEvidence)];
      const sources = [...new Set(trajScores.map((s) => s.source))].join("|");
      out.push({
        category: cat,
        probability: finalProb,
        severity: maxSeverity,
        evidence,
        source: sources,
      });
    }
    return out;
  }

  /**
   * Compute overall risk from per-category scores using surface-specific weights.
   */
  private computeOverallRisk(
    categoryScores: CategoryScore[],
    surface: Surface,
  ): number {
    const cfg = this.getThresholds(surface);
    let weighted = 0;
    let totalWeight = 0;
    for (const s of categoryScores) {
      const weight = cfg.categoryWeights[s.category] ?? 1.0;
      // Risk contribution = probability * sqrt(severity / 5) — sqrt so severity 3 still counts
      const contribution = s.probability * Math.sqrt(s.severity / 5) * weight;
      weighted += contribution;
      totalWeight += weight;
    }
    const meanWeighted = weighted / Math.max(totalWeight, 1);
    // A single confident detector firing should be enough to warn.
    // Take the max probability across categories with reasonable severity.
    const maxSingle = Math.max(
      ...categoryScores.map((s) =>
        s.severity >= 3 ? s.probability : s.probability * 0.5,
      ),
    );
    return Math.min(1, Math.max(meanWeighted, maxSingle));
  }

  private decideAction(
    overallRisk: number,
    surface: Surface,
  ): "pass" | "warn" | "block" {
    const cfg = this.getThresholds(surface);
    if (overallRisk >= cfg.block) return "block";
    if (overallRisk >= cfg.warn) return "warn";
    return "pass";
  }

  private explain(scores: CategoryScore[], overall: number): string {
    const top = [...scores]
      .filter((s) => s.probability > 0.3)
      .sort((a, b) => b.probability * b.severity - a.probability * a.severity)
      .slice(0, 3);

    if (top.length === 0) return "No significant intent corruption detected.";

    const lines = top.map((s) => {
      const label = humanLabel(s.category);
      const pct = Math.round(s.probability * 100);
      const ev = s.evidence.slice(0, 2).join("; ");
      return `• ${label}: ${pct}% confidence${ev ? ` (${ev})` : ""}`;
    });
    return `Overall risk: ${Math.round(overall * 100)}%. Top concerns:\n${lines.join("\n")}`;
  }

  async run(
    req: ScoreRequest,
    userProfile?: UserStyleProfile,
  ): Promise<ScoreResponse> {
    const requestId = `sil_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const t0 = performance.now();

    const surface = req.surface as Surface;
    const plans = this.planTrajectories(req.parallelTrajectories ?? 3);

    const detectorOpts: DetectorOptions = {
      surface,
      userId: req.userId,
      userProfile,
      context: req.context,
      latencyBudgetMs: this.config.trajectoryBudgetMs ?? 800,
    };

    const detTrace: Record<string, string> = {};
    for (const d of this.config.detectors) detTrace[d.name] = d.name;

    const trajectoryResults: Trajectory[] = await Promise.all(
      plans.map(async (plan) => {
        const tStart = performance.now();
        const dets = plan.detectorNames
          .map((n) => this.config.detectors.find((d) => d.name === n))
          .filter((d): d is Detector => Boolean(d));

        // Run all detectors in this trajectory in parallel
        const raw = await Promise.all(
          dets.map((d) =>
            d.score(req.original, req.suggested, detectorOpts).catch((err) => {
              // Don't let one detector crash the whole trajectory
              console.error(`Detector ${d.name} failed:`, err);
              return [] as CategoryScore[];
            }),
          ),
        );
        const flat = raw.flat();
        const aggregated = this.aggregateWithinTrajectory(flat);
        const trajectoryRisk = this.computeOverallRisk(aggregated, surface);
        return {
          id: plan.id,
          detectorMix: plan.detectorNames,
          categoryScores: aggregated,
          trajectoryRisk,
          latencyMs: Math.round(performance.now() - tStart),
        };
      }),
    );

    const tDetection = performance.now();
    const finalScores = this.aggregateAcrossTrajectories(trajectoryResults);
    const overallRisk = this.computeOverallRisk(finalScores, surface);
    const action = this.decideAction(overallRisk, surface);
    const explanation = this.explain(finalScores, overallRisk);
    const tAggregation = performance.now();

    return {
      overallRisk,
      action,
      categoryScores: finalScores,
      trajectories: trajectoryResults,
      explanation,
      latency: {
        totalMs: Math.round(tAggregation - t0),
        intentEncodingMs: 0,
        detectionMs: Math.round(tDetection - t0),
        aggregationMs: Math.round(tAggregation - tDetection),
      },
      trace: {
        requestId,
        timestamp: Date.now(),
        surface,
        userId: req.userId,
        modelRouter: detTrace,
      },
    };
  }
}

function humanLabel(c: CorruptionCategory): string {
  const map: Record<CorruptionCategory, string> = {
    polarity_negation: "Polarity reversal (negation flip)",
    polarity_antonym: "Polarity reversal (antonym swap)",
    modal_shift: "Modal strength shift",
    commitment_distortion: "Commitment level distortion",
    quantifier_shift: "Quantifier shift",
    temporal_shift: "Temporal shift",
    subject_object_swap: "Subject/object swap",
    scope_error: "Negation/quantifier scope error",
    tone_shift: "Tone shift",
    hedging_shift: "Hedging shift",
    identity_corruption: "Identity/name corruption",
    intent_drift: "Intent drift",
  };
  return map[c];
}
