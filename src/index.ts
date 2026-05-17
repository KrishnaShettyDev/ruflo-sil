/**
 * @plutaslab/ruflo-sil — Semantic Intent Layer for ruflo.
 *
 * Public API:
 *   import { SIL, CascadeAnalyzer } from "@plutaslab/ruflo-sil";
 *
 *   const sil = SIL.hosted({ hfApiKey: ..., anthropicApiKey: ... });
 *   const result = await sil.score({
 *     original: "I can take care of it",
 *     suggested: "I can't take care of it",
 *     surface: "chat",
 *   });
 *   console.log(result.action);            // "block"
 *   console.log(result.overallRisk);       // ~0.85
 *   console.log(result.explanation);
 */

export { SIL } from "./core/sil.js";
export { CascadeAnalyzer } from "./scorers/cascade.js";
export { Corrector } from "./scorers/corrector.js";
export { RiskAggregator } from "./scorers/aggregator.js";
export { ProfileService, InMemoryProfileStore } from "./knowledge/profile.js";

export * from "./types/index.js";

export { PolarityDetector } from "./detectors/polarity/index.js";
export { ModalDetector } from "./detectors/modal/index.js";
export {
  CommitmentDetector,
  QuantifierDetector,
  TemporalDetector,
  HedgingDetector,
  SubjectSwapDetector,
} from "./detectors/lexical/index.js";
export {
  NLIDetector,
  HFInferenceNLI,
  ModalNLI,
  MockNLI,
} from "./detectors/nli/index.js";
export {
  EmbeddingDetector,
  HFEmbedding,
  MockEmbedding,
} from "./detectors/embedding/index.js";
export {
  LLMJudgeDetector,
  MockLLMJudge,
} from "./detectors/llm-judge/index.js";

export { preEditHook } from "./hooks/pre-edit.js";
export { startMcpServer } from "./mcp/server.js";
export { startApiServer, buildServer } from "./api/server.js";
