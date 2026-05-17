/**
 * SIL — the top-level orchestrator. Construct with a config; call score().
 *
 * Three constructor paths:
 *   1. SIL.local()        — fully offline with mocks (for tests / CI / demos without API keys)
 *   2. SIL.hosted(keys)   — HuggingFace Inference API for NLI/embed, Claude for judge
 *   3. SIL.modal({...})   — Modal-hosted inference for production scale
 */

import {
  DEFAULT_THRESHOLDS,
  Detector,
  ScoreRequest,
  ScoreRequestSchema,
  ScoreResponse,
  Surface,
  ThresholdConfig,
  UserStyleProfile,
} from "../types/index.js";
import { PolarityDetector } from "../detectors/polarity/index.js";
import { ModalDetector } from "../detectors/modal/index.js";
import {
  CommitmentDetector,
  QuantifierDetector,
  TemporalDetector,
  HedgingDetector,
  SubjectSwapDetector,
} from "../detectors/lexical/index.js";
import {
  HFInferenceNLI,
  MockNLI,
  ModalNLI,
  NLIBackend,
  NLIDetector,
} from "../detectors/nli/index.js";
import {
  EmbeddingBackend,
  EmbeddingDetector,
  HFEmbedding,
  MockEmbedding,
} from "../detectors/embedding/index.js";
import {
  CachedJudgeBackend,
  JudgeBackend,
  LLMJudgeDetector,
  MockLLMJudge,
  OpenRouterBackend,
  AnthropicBackend,
} from "../detectors/llm-judge/index.js";
import { RiskAggregator } from "../scorers/aggregator.js";
import { Corrector } from "../scorers/corrector.js";
import {
  InMemoryProfileStore,
  ProfileService,
  ProfileStore,
} from "../knowledge/profile.js";

export interface SILConfig {
  detectors: Detector[];
  embedder?: EmbeddingBackend;
  profileStore?: ProfileStore;
  corrector?: Corrector;
  thresholds?: Partial<Record<Surface, ThresholdConfig>>;
  trajectoryBudgetMs?: number;
}

export interface HostedConfig {
  hfApiKey?: string;
  anthropicApiKey?: string;
  openrouterApiKey?: string;
  embeddingModel?: string;
  nliModel?: string;
  judgeModel?: string;
  enableJudge?: boolean;
  enableCorrector?: boolean;
  /** Persist LLM-judge responses to this path (e.g., ".cache/judge.json"). */
  judgeCachePath?: string;
  /** Replace all surface warn+block thresholds with this single value (for ablations). */
  thresholdOverride?: number;
}

export interface ModalConfig {
  nliEndpoint: string;
  nliToken: string;
  embedder: EmbeddingBackend;
  anthropicApiKey?: string;
  enableJudge?: boolean;
  enableCorrector?: boolean;
}

export class SIL {
  private aggregator: RiskAggregator;
  private profileService: ProfileService | null = null;
  private corrector: Corrector | null;
  private embedder: EmbeddingBackend | null;

  constructor(config: SILConfig) {
    this.aggregator = new RiskAggregator({
      detectors: config.detectors,
      thresholds: config.thresholds,
      trajectoryBudgetMs: config.trajectoryBudgetMs,
    });
    this.corrector = config.corrector ?? null;
    this.embedder = config.embedder ?? null;
    if (config.embedder && config.profileStore) {
      this.profileService = new ProfileService(config.profileStore, config.embedder);
    }
  }

  /**
   * Fully offline. Mocks for NLI/embedding/judge. Use for tests and offline demos.
   */
  static local(): SIL {
    const mockNLI = new MockNLI();
    const mockEmb = new MockEmbedding();
    const detectors: Detector[] = [
      new PolarityDetector(),
      new ModalDetector(),
      new CommitmentDetector(),
      new QuantifierDetector(),
      new TemporalDetector(),
      new HedgingDetector(),
      new SubjectSwapDetector(),
      new NLIDetector(mockNLI),
      new EmbeddingDetector(mockEmb),
      new MockLLMJudge(),
    ];
    return new SIL({
      detectors,
      embedder: mockEmb,
      profileStore: new InMemoryProfileStore(),
    });
  }

  /**
   * Hosted SIL using HuggingFace Inference API + Anthropic.
   * Costs: HF free tier (~rate-limited), Claude Haiku ~$0.0001/score.
   */
  static hosted(cfg: HostedConfig): SIL {
    if (!cfg.hfApiKey) throw new Error("hfApiKey required for hosted SIL");
    const nli = new HFInferenceNLI(cfg.hfApiKey, cfg.nliModel);
    const emb = new HFEmbedding(cfg.hfApiKey, cfg.embeddingModel);

    const detectors: Detector[] = [
      new PolarityDetector(),
      new ModalDetector(),
      new CommitmentDetector(),
      new QuantifierDetector(),
      new TemporalDetector(),
      new HedgingDetector(),
      new SubjectSwapDetector(),
      new NLIDetector(nli),
      new EmbeddingDetector(emb),
    ];
    // Pick LLM backend: OpenRouter > Anthropic direct
    let judgeBackend: JudgeBackend | null =
      cfg.openrouterApiKey
        ? new OpenRouterBackend(
            cfg.openrouterApiKey,
            cfg.judgeModel ?? "anthropic/claude-haiku-4.5",
          )
        : cfg.anthropicApiKey
          ? new AnthropicBackend(
              cfg.anthropicApiKey,
              cfg.judgeModel ?? "claude-haiku-4-5-20251001",
            )
          : null;

    if (judgeBackend && cfg.judgeCachePath) {
      judgeBackend = new CachedJudgeBackend(judgeBackend, cfg.judgeCachePath);
    }

    if (cfg.enableJudge && judgeBackend) {
      detectors.push(new LLMJudgeDetector(judgeBackend));
    }

    const corrector =
      cfg.enableCorrector && (cfg.openrouterApiKey || cfg.anthropicApiKey)
        ? Corrector.fromEnvOrKeys({
            openrouterApiKey: cfg.openrouterApiKey,
            anthropicApiKey: cfg.anthropicApiKey,
          })
        : undefined;

    let thresholds: Partial<Record<Surface, ThresholdConfig>> | undefined;
    if (cfg.thresholdOverride !== undefined) {
      const t = cfg.thresholdOverride;
      thresholds = {};
      for (const surface of Object.keys(DEFAULT_THRESHOLDS) as Surface[]) {
        thresholds[surface] = {
          ...DEFAULT_THRESHOLDS[surface],
          warn: t,
          block: t,
        };
      }
    }

    return new SIL({
      detectors,
      embedder: emb,
      profileStore: new InMemoryProfileStore(),
      corrector: corrector ?? undefined,
      thresholds,
    });
  }

  /**
   * Production: Modal-hosted DeBERTa NLI for low latency.
   */
  static modal(cfg: ModalConfig): SIL {
    const nli = new ModalNLI(cfg.nliEndpoint, cfg.nliToken);

    const detectors: Detector[] = [
      new PolarityDetector(),
      new ModalDetector(),
      new CommitmentDetector(),
      new QuantifierDetector(),
      new TemporalDetector(),
      new HedgingDetector(),
      new SubjectSwapDetector(),
      new NLIDetector(nli),
      new EmbeddingDetector(cfg.embedder),
    ];
    if (cfg.enableJudge && cfg.anthropicApiKey) {
      detectors.push(
        new LLMJudgeDetector(
          new AnthropicBackend(cfg.anthropicApiKey, "claude-haiku-4-5-20251001"),
        ),
      );
    }

    const corrector =
      cfg.enableCorrector && cfg.anthropicApiKey
        ? new Corrector(cfg.anthropicApiKey)
        : undefined;

    return new SIL({
      detectors,
      embedder: cfg.embedder,
      profileStore: new InMemoryProfileStore(),
      corrector,
    });
  }

  /**
   * Score a single (original, suggested) pair.
   */
  async score(req: ScoreRequest): Promise<ScoreResponse> {
    const parsed = ScoreRequestSchema.parse(req);
    const profile =
      parsed.userId && this.profileService
        ? (await this.profileService.get(parsed.userId)) ?? undefined
        : undefined;

    const response = await this.aggregator.run(parsed, profile);

    // If correction was requested and the action is block-tier, generate one
    if (
      parsed.generateCorrection &&
      response.action !== "pass" &&
      this.corrector
    ) {
      const tCorr = performance.now();
      try {
        const correction = await this.corrector.correct(
          parsed.original,
          parsed.suggested,
          response.categoryScores,
        );
        response.correction = correction.corrected;
        response.latency.correctionMs = Math.round(
          performance.now() - tCorr,
        );
      } catch (err) {
        response.explanation += "\n(correction failed)";
      }
    }

    return response;
  }

  /**
   * Update the per-user style profile from a sample of their writing.
   */
  async updateUserProfile(
    userId: string,
    sample: string,
  ): Promise<UserStyleProfile | null> {
    if (!this.profileService) return null;
    return this.profileService.updateFromSample(userId, sample);
  }

  async getUserProfile(userId: string): Promise<UserStyleProfile | null> {
    if (!this.profileService) return null;
    return this.profileService.get(userId);
  }
}
