/**
 * User Style Profile — per-user "specialized knowledge search" for SIL.
 *
 * Adapted from Genie's first technique: rich, user-specific context to ground
 * the risk-scoring decision. Stores:
 *   - rolling embedding of recent user-authored writing
 *   - characteristic token frequencies (contractions, slang, formality)
 *   - false-positive history per category (suppresses noisy warnings)
 *
 * Backend abstraction: in production this lives in ruflo's AgentDB; for
 * standalone API use we ship an in-memory + JSON-persisted fallback.
 */

import {
  CorruptionCategory,
  ALL_CATEGORIES,
  UserStyleProfile,
} from "../types/index.js";
import { EmbeddingBackend } from "../detectors/embedding/index.js";

export interface ProfileStore {
  get(userId: string): Promise<UserStyleProfile | null>;
  put(profile: UserStyleProfile): Promise<void>;
  delete(userId: string): Promise<void>;
}

/**
 * In-memory profile store with optional JSON persistence.
 * For ruflo deployment, swap this for an AgentDB-backed store.
 */
export class InMemoryProfileStore implements ProfileStore {
  private map = new Map<string, UserStyleProfile>();

  async get(userId: string) {
    return this.map.get(userId) ?? null;
  }

  async put(profile: UserStyleProfile) {
    this.map.set(profile.userId, profile);
  }

  async delete(userId: string) {
    this.map.delete(userId);
  }
}

/**
 * Profile builder/updater. Call updateFromSample() whenever the user authors
 * (or accepts unchanged) a piece of text, to keep the profile fresh.
 */
export class ProfileService {
  private static EMA_ALPHA = 0.1; // slow drift; ~10 samples to half-replace

  constructor(
    private store: ProfileStore,
    private embedder: EmbeddingBackend,
  ) {}

  async get(userId: string): Promise<UserStyleProfile | null> {
    return this.store.get(userId);
  }

  async updateFromSample(userId: string, sample: string): Promise<UserStyleProfile> {
    const existing = await this.store.get(userId);
    const newVec = await this.embedder.embed(sample);

    let styleVector = newVec;
    if (existing && existing.styleVector.length === newVec.length) {
      // EMA on the style vector
      styleVector = existing.styleVector.map(
        (x, i) => x * (1 - ProfileService.EMA_ALPHA) + newVec[i] * ProfileService.EMA_ALPHA,
      );
    }

    const tokens = sample
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 0);

    const characteristicTokens = new Set<string>(
      existing?.characteristicTokens ?? [],
    );
    // Track contractions and short-form usage specifically
    for (const tok of tokens) {
      if (tok.includes("'") || tok.endsWith("nt") || tok.endsWith("ll")) {
        characteristicTokens.add(tok);
      }
    }
    // Bound size to avoid unbounded growth
    if (characteristicTokens.size > 500) {
      const arr = [...characteristicTokens];
      characteristicTokens.clear();
      for (const t of arr.slice(-500)) characteristicTokens.add(t);
    }

    const profile: UserStyleProfile = {
      userId,
      styleVector,
      characteristicTokens,
      falsePositiveRates:
        existing?.falsePositiveRates ?? this.zeroFPRates(),
      sampleCount: (existing?.sampleCount ?? 0) + 1,
      updatedAt: Date.now(),
    };

    await this.store.put(profile);
    return profile;
  }

  /**
   * Record that a SIL warning was a false positive (user dismissed it).
   * This decays category trust so future warnings of that category for this
   * user are downweighted.
   */
  async recordFalsePositive(
    userId: string,
    category: CorruptionCategory,
  ): Promise<void> {
    const existing = await this.store.get(userId);
    if (!existing) return;
    const fpRates = { ...existing.falsePositiveRates };
    fpRates[category] = Math.min(0.9, (fpRates[category] ?? 0) + 0.05);
    await this.store.put({ ...existing, falsePositiveRates: fpRates });
  }

  async recordTruePositive(
    userId: string,
    category: CorruptionCategory,
  ): Promise<void> {
    const existing = await this.store.get(userId);
    if (!existing) return;
    const fpRates = { ...existing.falsePositiveRates };
    fpRates[category] = Math.max(0, (fpRates[category] ?? 0) - 0.02);
    await this.store.put({ ...existing, falsePositiveRates: fpRates });
  }

  private zeroFPRates(): Record<CorruptionCategory, number> {
    const out = {} as Record<CorruptionCategory, number>;
    for (const c of ALL_CATEGORIES) out[c] = 0;
    return out;
  }
}
