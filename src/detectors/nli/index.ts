/**
 * NLI (Natural Language Inference) detector — the contradiction-detection backbone.
 *
 * Wraps a DeBERTa-v3-large-MNLI cross-encoder. Default backend is HuggingFace
 * Inference API (free tier, no GPU required). Can be swapped for:
 *   - Modal-hosted vLLM
 *   - Local ONNX Runtime
 *   - Replicate / Together API
 *
 * The detector runs NLI in BOTH directions (U->S and S->U) and treats high
 * contradiction in either direction as evidence of intent corruption.
 * It also computes bidirectional entailment as a paraphrase confidence signal.
 */

import {
  CategoryScore,
  CorruptionCategory,
  Detector,
  DetectorOptions,
} from "../../types/index.js";

export interface NLIBackend {
  /**
   * Returns probabilities [entailment, neutral, contradiction] for premise->hypothesis.
   */
  classify(premise: string, hypothesis: string): Promise<{
    entailment: number;
    neutral: number;
    contradiction: number;
  }>;
}

/**
 * HuggingFace Inference API backend.
 * Model: MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli
 * Free tier: rate-limited but workable for prototyping.
 */
export class HFInferenceNLI implements NLIBackend {
  constructor(
    private readonly apiKey: string,
    private readonly model = "MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli",
    private readonly baseUrl = "https://router.huggingface.co/hf-inference/models",
  ) {}

  async classify(premise: string, hypothesis: string) {
    const url = `${this.baseUrl}/${this.model}/pipeline/text-classification`;
    // HF API expects `{premise}</s>{hypothesis}` for cross-encoder NLI.
    // For most MNLI checkpoints it's a single string with the separator.
    const inputs = `${premise}</s></s>${hypothesis}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs, options: { wait_for_model: true } }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HF NLI API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as Array<{ label: string; score: number }>;
    // HF returns array of {label, score}. Label values: ENTAILMENT, NEUTRAL, CONTRADICTION
    const result = { entailment: 0, neutral: 0, contradiction: 0 };
    const flat = Array.isArray(data[0]) ? (data[0] as any) : data;
    for (const item of flat) {
      const label = (item as any).label?.toUpperCase() ?? "";
      const score = (item as any).score ?? 0;
      if (label === "ENTAILMENT") result.entailment = score;
      else if (label === "NEUTRAL") result.neutral = score;
      else if (label === "CONTRADICTION") result.contradiction = score;
    }
    return result;
  }
}

/**
 * Modal-hosted vLLM backend. Spin up a Modal function serving DeBERTa-NLI
 * for production traffic. Free tier: $30/month credits.
 */
export class ModalNLI implements NLIBackend {
  constructor(private readonly endpoint: string, private readonly token: string) {}

  async classify(premise: string, hypothesis: string) {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ premise, hypothesis }),
    });
    if (!res.ok) throw new Error(`Modal NLI error ${res.status}`);
    return (await res.json()) as {
      entailment: number;
      neutral: number;
      contradiction: number;
    };
  }
}

/**
 * Mock backend for testing without API access.
 * Uses a tiny heuristic so tests still produce signal.
 */
export class MockNLI implements NLIBackend {
  async classify(premise: string, hypothesis: string) {
    // crude: if a negation cue appears in one but not the other, return contradiction
    const negationRe = /\b(not|n't|never|cannot|cant|wont|isnt|arent|dont)\b/i;
    const pNeg = negationRe.test(premise);
    const hNeg = negationRe.test(hypothesis);
    if (pNeg !== hNeg) {
      return { entailment: 0.05, neutral: 0.1, contradiction: 0.85 };
    }
    // simple Jaccard for entailment signal
    const pt = new Set(premise.toLowerCase().split(/\W+/).filter(Boolean));
    const ht = new Set(hypothesis.toLowerCase().split(/\W+/).filter(Boolean));
    const inter = [...pt].filter((t) => ht.has(t)).length;
    const union = new Set([...pt, ...ht]).size;
    const jaccard = union === 0 ? 0 : inter / union;
    if (jaccard > 0.7) {
      return { entailment: 0.8, neutral: 0.15, contradiction: 0.05 };
    }
    return { entailment: 0.3, neutral: 0.55, contradiction: 0.15 };
  }
}

// ----------------------------------------------------------------------------
// NLI Detector
// ----------------------------------------------------------------------------

export class NLIDetector implements Detector {
  readonly name = "nli-deberta-v3";
  readonly categories: CorruptionCategory[] = [
    CorruptionCategory.POLARITY_NEGATION,
    CorruptionCategory.SCOPE_ERROR,
    CorruptionCategory.INTENT_DRIFT,
  ];

  constructor(private readonly backend: NLIBackend) {}

  async score(
    original: string,
    suggested: string,
    options: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const [forward, backward] = await Promise.all([
      this.backend.classify(original, suggested),
      this.backend.classify(suggested, original),
    ]);

    // Take the max contradiction in either direction as the polarity-reversal signal
    const contradictionRisk = Math.max(forward.contradiction, backward.contradiction);

    // Bidirectional entailment indicates semantic equivalence
    const bidirEntailment = Math.min(forward.entailment, backward.entailment);

    // Asymmetric entailment (one direction entails, the other doesn't) hints at scope or
    // intent shift — original entails suggested but not vice-versa => suggested is *more general*
    const entailmentAsymmetry = Math.abs(forward.entailment - backward.entailment);

    const polarityScore: CategoryScore = {
      category: CorruptionCategory.POLARITY_NEGATION,
      probability: contradictionRisk,
      severity: contradictionRisk > 0.7 ? 5 : 4,
      evidence: [
        `contradiction(orig->sugg)=${forward.contradiction.toFixed(3)}`,
        `contradiction(sugg->orig)=${backward.contradiction.toFixed(3)}`,
        `bidir_entailment=${bidirEntailment.toFixed(3)}`,
      ],
      source: this.name,
    };

    const scopeScore: CategoryScore = {
      category: CorruptionCategory.SCOPE_ERROR,
      probability: Math.min(1, entailmentAsymmetry * 1.5),
      severity: 4,
      evidence: [
        `forward_entail=${forward.entailment.toFixed(3)}`,
        `backward_entail=${backward.entailment.toFixed(3)}`,
        `asymmetry=${entailmentAsymmetry.toFixed(3)}`,
      ],
      source: this.name,
    };

    // Intent drift: low entailment in both directions + low contradiction = different topic
    const driftProbability =
      bidirEntailment < 0.3 && contradictionRisk < 0.3
        ? 1 - bidirEntailment - contradictionRisk
        : 0;
    const driftScore: CategoryScore = {
      category: CorruptionCategory.INTENT_DRIFT,
      probability: Math.max(0, driftProbability),
      severity: 3,
      evidence: [`drift_signal=${driftProbability.toFixed(3)}`],
      source: this.name,
    };

    return [polarityScore, scopeScore, driftScore];
  }
}
