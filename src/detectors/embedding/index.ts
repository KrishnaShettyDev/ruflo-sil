/**
 * Embedding detector — semantic similarity drift.
 *
 * Backbone: bi-encoder sentence embeddings. Catches gross topic shift but is
 * KNOWN to be polarity-blind ("I can do it" vs "I can't do it" often have
 * cosine > 0.9). We use it explicitly to flag the *intent_drift* category
 * (topic departure across multi-turn AI mediation) and as a cheap pre-filter
 * for the more expensive NLI cross-encoder.
 */

import {
  CategoryScore,
  CorruptionCategory,
  Detector,
  DetectorOptions,
} from "../../types/index.js";

export interface EmbeddingBackend {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aMag += a[i] * a[i];
    bMag += b[i] * b[i];
  }
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag) + 1e-12);
}

export class HFEmbedding implements EmbeddingBackend {
  constructor(
    private readonly apiKey: string,
    private readonly model = "BAAI/bge-m3",
    private readonly baseUrl = "https://router.huggingface.co/hf-inference/models",
  ) {}

  async embed(text: string) {
    const res = await fetch(`${this.baseUrl}/${this.model}/pipeline/feature-extraction`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: text,
        options: { wait_for_model: true },
      }),
    });
    if (!res.ok) throw new Error(`HF embed error ${res.status}`);
    const data = (await res.json()) as number[] | number[][];
    return Array.isArray(data[0]) ? (data[0] as number[]) : (data as number[]);
  }

  async embedBatch(texts: string[]) {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/**
 * Deterministic mock embedding for offline tests.
 * Uses a simple character-frequency vector so tests produce stable signal
 * without requiring API keys.
 */
export class MockEmbedding implements EmbeddingBackend {
  private dim = 64;

  async embed(text: string) {
    const v = new Array(this.dim).fill(0);
    for (const ch of text.toLowerCase()) {
      const code = ch.charCodeAt(0);
      v[code % this.dim] += 1;
    }
    // L2 normalize
    let mag = 0;
    for (const x of v) mag += x * x;
    mag = Math.sqrt(mag) + 1e-12;
    return v.map((x) => x / mag);
  }

  async embedBatch(texts: string[]) {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

export class EmbeddingDetector implements Detector {
  readonly name = "embedding-bge-m3";
  readonly categories = [CorruptionCategory.INTENT_DRIFT];

  constructor(private readonly backend: EmbeddingBackend) {}

  async score(
    original: string,
    suggested: string,
    _options: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const [a, b] = await this.backend.embedBatch([original, suggested]);
    const sim = cosine(a, b);
    // High similarity = low drift. Translate to probability.
    // sim 0.95+ => almost certainly same topic
    // sim < 0.6 => likely different topic / drift
    let probability = 0;
    if (sim < 0.6) probability = 0.7 + (0.6 - sim) * 0.5;
    else if (sim < 0.8) probability = 0.3;
    else probability = 0;
    probability = Math.min(1, probability);

    return [
      {
        category: CorruptionCategory.INTENT_DRIFT,
        probability,
        severity: 3,
        evidence: [`cosine=${sim.toFixed(4)}`],
        source: this.name,
      },
    ];
  }
}
