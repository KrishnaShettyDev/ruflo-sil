/**
 * SIL — Semantic Intent Layer
 * Core type definitions for the 12-category intent corruption taxonomy.
 */

import { z } from "zod";

// ============================================================================
// THE ICOR TAXONOMY — 12 categories of intent corruption
// ============================================================================

export const CorruptionCategory = {
  /** "I can take care of it" → "I can't take care of it" */
  POLARITY_NEGATION: "polarity_negation",
  /** "approve" → "reject"; "include" → "exclude" */
  POLARITY_ANTONYM: "polarity_antonym",
  /** "might" → "must"; "should not" → "should" */
  MODAL_SHIFT: "modal_shift",
  /** "I'll try" → "I will"; "maybe Thursday" → "Thursday" */
  COMMITMENT_DISTORTION: "commitment_distortion",
  /** "some users" → "all users"; "few errors" → "many errors" */
  QUANTIFIER_SHIFT: "quantifier_shift",
  /** "soon" → "now"; "by Friday" → "next Friday" */
  TEMPORAL_SHIFT: "temporal_shift",
  /** "I" → "we"; "I asked her" → "she asked me" */
  SUBJECT_OBJECT_SWAP: "subject_object_swap",
  /** "not all are required" → "all are not required" */
  SCOPE_ERROR: "scope_error",
  /** calm → aggressive; caring → cold; informal → formal */
  TONE_SHIFT: "tone_shift",
  /** "I think" → ∅; ∅ → "I think" */
  HEDGING_SHIFT: "hedging_shift",
  /** "Ayaan" → "Susan"; "DaShawn" → "dash away" */
  IDENTITY_CORRUPTION: "identity_corruption",
  /** Gradual homogenization across multi-turn AI mediation */
  INTENT_DRIFT: "intent_drift",
} as const;

export type CorruptionCategory =
  (typeof CorruptionCategory)[keyof typeof CorruptionCategory];

export const ALL_CATEGORIES: CorruptionCategory[] = Object.values(
  CorruptionCategory,
);

// ============================================================================
// SURFACES — where AI-mediated communication happens
// ============================================================================

export const Surface = {
  KEYBOARD: "keyboard",
  AUTOCOMPLETE: "autocomplete",
  EMAIL: "email",
  CHAT: "chat",
  CODE: "code",
  DOCUMENT: "document",
  TRANSLATION: "translation",
  AGENT_PIPELINE: "agent_pipeline",
} as const;

export type Surface = (typeof Surface)[keyof typeof Surface];

// ============================================================================
// REQUEST / RESPONSE SHAPES
// ============================================================================

export const ScoreRequestSchema = z.object({
  /** The original user-authored text whose intent must be preserved */
  original: z.string().min(1).max(8000),
  /** The AI-suggested replacement / rewrite */
  suggested: z.string().min(1).max(8000),
  /** Where the edit is happening — affects category weights and thresholds */
  surface: z.enum([
    "keyboard",
    "autocomplete",
    "email",
    "chat",
    "code",
    "document",
    "translation",
    "agent_pipeline",
  ]).optional().default("chat"),
  /** User identifier — used for per-user style profile retrieval */
  userId: z.string().optional(),
  /** Prior conversation turns for context-aware scoring */
  context: z.array(z.string()).optional(),
  /** Categories to evaluate; defaults to all 12 */
  categories: z
    .array(
      z.enum([
        "polarity_negation",
        "polarity_antonym",
        "modal_shift",
        "commitment_distortion",
        "quantifier_shift",
        "temporal_shift",
        "subject_object_swap",
        "scope_error",
        "tone_shift",
        "hedging_shift",
        "identity_corruption",
        "intent_drift",
      ]),
    )
    .optional(),
  /** Number of parallel-thinking trajectories. Genie-style sampling. */
  parallelTrajectories: z.number().int().min(1).max(8).optional().default(3),
  /** Set true to also generate a corrected suggestion if risk is high */
  generateCorrection: z.boolean().optional().default(false),
});

export type ScoreRequest = z.input<typeof ScoreRequestSchema>;
export type ScoreRequestParsed = z.output<typeof ScoreRequestSchema>;

/** Per-category risk score from a single detector */
export interface CategoryScore {
  category: CorruptionCategory;
  /** Probability that this category of corruption is present, [0, 1] */
  probability: number;
  /** Severity if present, [1, 5] */
  severity: number;
  /** Evidence — the tokens/phrases that triggered the detector */
  evidence: string[];
  /** Which detector produced this score */
  source: string;
}

/** Single trajectory through the detector ensemble */
export interface Trajectory {
  id: string;
  detectorMix: string[];
  categoryScores: CategoryScore[];
  /** Aggregated risk over all categories for this trajectory, [0, 1] */
  trajectoryRisk: number;
  /** Latency for this trajectory in ms */
  latencyMs: number;
}

export type Action = "pass" | "warn" | "block";

export interface ScoreResponse {
  /** Final risk across all categories after parallel-thinking aggregation, [0, 1] */
  overallRisk: number;
  /** Recommended action based on thresholds */
  action: Action;
  /** Per-category aggregated scores after voting across trajectories */
  categoryScores: CategoryScore[];
  /** Each parallel trajectory's individual result */
  trajectories: Trajectory[];
  /** Human-readable explanation of the top risks */
  explanation: string;
  /** AI-generated correction that preserves user intent (if requested) */
  correction?: string;
  /** Latency breakdown */
  latency: {
    totalMs: number;
    intentEncodingMs: number;
    detectionMs: number;
    aggregationMs: number;
    correctionMs?: number;
  };
  /** Trace metadata for observability */
  trace: {
    requestId: string;
    timestamp: number;
    surface: Surface;
    userId?: string;
    modelRouter: Record<string, string>;
  };
}

// ============================================================================
// USER STYLE PROFILE — Genie-style "specialized knowledge search"
// ============================================================================

export interface UserStyleProfile {
  userId: string;
  /** Mean embedding of recent user writings */
  styleVector: number[];
  /** Tokens the user uses with high frequency (e.g. "won't" vs "will not") */
  characteristicTokens: Set<string>;
  /** Per-category historical false-positive rate, to suppress noisy warnings */
  falsePositiveRates: Record<CorruptionCategory, number>;
  /** How many writing samples this profile is built from */
  sampleCount: number;
  /** Last updated unix ms */
  updatedAt: number;
}

// ============================================================================
// DETECTOR INTERFACE — what every detector implements
// ============================================================================

export interface Detector {
  readonly name: string;
  readonly categories: CorruptionCategory[];
  /**
   * Score one (original, suggested) pair against this detector's categories.
   * MUST complete within latencyBudgetMs or throw.
   */
  score(
    original: string,
    suggested: string,
    options: DetectorOptions,
  ): Promise<CategoryScore[]>;
}

export interface DetectorOptions {
  surface: Surface;
  userId?: string;
  userProfile?: UserStyleProfile;
  context?: string[];
  latencyBudgetMs: number;
  signal?: AbortSignal;
}

// ============================================================================
// THRESHOLD CONFIG — per-surface, per-category
// ============================================================================

export interface ThresholdConfig {
  /** Below this risk: pass through silently */
  warn: number;
  /** Above this risk: block / require user confirmation */
  block: number;
  /** Per-category weight in overall risk aggregation */
  categoryWeights: Partial<Record<CorruptionCategory, number>>;
}

export const DEFAULT_THRESHOLDS: Record<Surface, ThresholdConfig> = {
  keyboard: {
    warn: 0.4,
    block: 0.75,
    categoryWeights: {
      polarity_negation: 1.5,
      polarity_antonym: 1.5,
      subject_object_swap: 1.3,
      identity_corruption: 1.5,
    },
  },
  autocomplete: {
    warn: 0.4,
    block: 0.75,
    categoryWeights: {
      polarity_negation: 1.5,
      polarity_antonym: 1.5,
    },
  },
  email: {
    warn: 0.35,
    block: 0.7,
    categoryWeights: {
      commitment_distortion: 1.4,
      tone_shift: 1.2,
      polarity_negation: 1.5,
    },
  },
  chat: {
    warn: 0.5,
    block: 0.8,
    categoryWeights: {},
  },
  code: {
    warn: 0.3,
    block: 0.65,
    categoryWeights: {
      polarity_antonym: 1.6,
      scope_error: 1.5,
      quantifier_shift: 1.3,
    },
  },
  document: {
    warn: 0.35,
    block: 0.7,
    categoryWeights: {
      commitment_distortion: 1.3,
      modal_shift: 1.3,
    },
  },
  translation: {
    warn: 0.3,
    block: 0.65,
    categoryWeights: {
      polarity_negation: 1.6,
      scope_error: 1.5,
      modal_shift: 1.4,
    },
  },
  agent_pipeline: {
    warn: 0.3,
    block: 0.65,
    categoryWeights: {
      intent_drift: 1.5,
      tone_shift: 1.3,
      commitment_distortion: 1.4,
    },
  },
};

// ============================================================================
// CASCADE — for recursive semantic drift analysis (paper Section 7)
// ============================================================================

export interface PipelineHop {
  hopIndex: number;
  agentId: string;
  input: string;
  output: string;
  risk?: ScoreResponse;
}

export interface CascadeReport {
  pipelineId: string;
  hops: PipelineHop[];
  /** Drift from hop 0 input to hop N output */
  cumulativeDrift: number;
  /** Per-category drift across the whole pipeline */
  driftByCategory: Record<CorruptionCategory, number>;
  /** Whether drift compounds linearly, exponentially, or saturates */
  driftPattern: "linear" | "exponential" | "saturating" | "noisy";
}
