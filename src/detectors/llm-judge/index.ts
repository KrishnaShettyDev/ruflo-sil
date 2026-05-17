/**
 * LLM-Judge detector — catches subtle pragmatic shifts that rules and NLI miss.
 *
 * Used for: tone_shift, identity_corruption, intent_drift in conversational text.
 * Two backends:
 *   - OpenRouter (preferred): one API for many models, cheap routing.
 *   - Anthropic direct: kept for self-hosted setups.
 *
 * This is the *expensive* detector — only included in higher-budget trajectories
 * (parallel-thinking trajectory T3 by default).
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  CategoryScore,
  CorruptionCategory,
  Detector,
  DetectorOptions,
} from "../../types/index.js";

export interface LLMJudgeConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const JUDGE_SYSTEM_PROMPT = `You are SIL-Judge, an evaluator that detects intent corruption in AI-mediated text edits.

You evaluate whether an AI's suggested rewrite preserves the original author's INTENT — not just literal meaning, but pragmatic effect, tone, commitment level, and social positioning.

Output strict JSON only, no preamble. Schema:
{
  "tone_shift": {"probability": <0-1>, "severity": <1-5>, "evidence": "<short reason>"},
  "identity_corruption": {"probability": <0-1>, "severity": <1-5>, "evidence": "<short reason>"},
  "intent_drift": {"probability": <0-1>, "severity": <1-5>, "evidence": "<short reason>"}
}

Tone shift: calm <-> aggressive, caring <-> cold, casual <-> formal, friendly <-> distant.
Identity corruption: names misspelled or replaced (especially non-Anglo names like Ayaan -> Susan).
Intent drift: the suggested text is on a noticeably different topic or pragmatic axis.

Be conservative — only flag with probability > 0.5 when you are confident.`;

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

export interface JudgeBackend {
  complete(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string>;
}

/**
 * Persistent on-disk cache wrapper. Keyed on sha256(prompt + message + params).
 * After a full bench run, every subsequent threshold/trajectory ablation reads
 * judge results from disk in milliseconds instead of hitting OpenRouter.
 */
export class CachedJudgeBackend implements JudgeBackend {
  private cache = new Map<string, string>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly inner: JudgeBackend,
    private readonly cachePath: string,
  ) {
    if (existsSync(cachePath)) {
      try {
        const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
        this.cache = new Map(Object.entries(raw));
      } catch {
        // Corrupted cache file — start fresh; do not throw.
      }
    }
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    const key = createHash("sha256")
      .update(systemPrompt)
      .update("|")
      .update(userMessage)
      .update("|")
      .update(String(maxTokens))
      .update("|")
      .update(String(temperature))
      .digest("hex");

    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const result = await this.inner.complete(systemPrompt, userMessage, maxTokens, temperature);
    this.cache.set(key, result);
    this.persist();
    return result;
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.cache.size };
  }

  private persist(): void {
    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify(Object.fromEntries(this.cache)));
  }
}

// ---------------------------------------------------------------------------
// OpenRouter backend
// ---------------------------------------------------------------------------

export class OpenRouterBackend implements JudgeBackend {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://openrouter.ai/api/v1",
  ) {}

  async complete(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/plutaslab/ruflo-sil",
        "X-Title": "ruflo-sil",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error) {
      throw new Error(`OpenRouter error: ${data.error.message ?? "unknown"}`);
    }

    return data.choices?.[0]?.message?.content ?? "";
  }
}

// ---------------------------------------------------------------------------
// Anthropic direct backend (kept for compatibility)
// ---------------------------------------------------------------------------

export class AnthropicBackend implements JudgeBackend {
  private client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    return resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
  }
}

// ---------------------------------------------------------------------------
// LLM-Judge detector
// ---------------------------------------------------------------------------

export class LLMJudgeDetector implements Detector {
  readonly name = "llm-judge";
  readonly categories = [
    CorruptionCategory.TONE_SHIFT,
    CorruptionCategory.IDENTITY_CORRUPTION,
    CorruptionCategory.INTENT_DRIFT,
  ];

  constructor(
    private readonly backend: JudgeBackend,
    private readonly config: LLMJudgeConfig = {},
  ) {}

  /**
   * Convenience constructor: pick the backend automatically based on env vars.
   * Priority: OPENROUTER_API_KEY > ANTHROPIC_API_KEY.
   */
  static fromEnv(config: LLMJudgeConfig = {}): LLMJudgeDetector | null {
    const orKey = process.env.OPENROUTER_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (orKey) {
      const model = config.model ?? "anthropic/claude-haiku-4.5";
      return new LLMJudgeDetector(new OpenRouterBackend(orKey, model), config);
    }
    if (anthropicKey) {
      const model = config.model ?? "claude-haiku-4-5-20251001";
      return new LLMJudgeDetector(new AnthropicBackend(anthropicKey, model), config);
    }
    return null;
  }

  async score(
    original: string,
    suggested: string,
    options: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const userMessage = `ORIGINAL (user-authored):
"""${original}"""

SUGGESTED (AI rewrite):
"""${suggested}"""

Surface: ${options.surface}
${options.context?.length ? `Prior turns: ${options.context.slice(-3).join(" | ")}` : ""}

Evaluate. Return JSON only.`;

    let text: string;
    try {
      text = await this.backend.complete(
        JUDGE_SYSTEM_PROMPT,
        userMessage,
        this.config.maxTokens ?? 400,
        this.config.temperature ?? 0,
      );
    } catch (err) {
      console.error(`[llm-judge] backend failed: ${(err as Error).message}`);
      return this.zeroScores();
    }

    let parsed: Record<string, { probability: number; severity?: number; evidence?: string }>;
    try {
      const cleaned = text.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return this.zeroScores();
    }

    const out: CategoryScore[] = [];
    for (const cat of this.categories) {
      const v = parsed[cat];
      if (v && typeof v.probability === "number") {
        out.push({
          category: cat,
          probability: Math.max(0, Math.min(1, v.probability)),
          severity: Math.max(1, Math.min(5, Math.round(v.severity ?? 3))),
          evidence: [v.evidence ?? "llm-judge"],
          source: this.name,
        });
      } else {
        out.push(this.zeroScore(cat));
      }
    }
    return out;
  }

  private zeroScore(c: CorruptionCategory): CategoryScore {
    return {
      category: c,
      probability: 0,
      severity: 1,
      evidence: [],
      source: this.name,
    };
  }

  private zeroScores(): CategoryScore[] {
    return this.categories.map((c) => this.zeroScore(c));
  }
}

/**
 * Mock LLM judge for offline tests.
 */
export class MockLLMJudge implements Detector {
  readonly name = "llm-judge-mock";
  readonly categories = [
    CorruptionCategory.TONE_SHIFT,
    CorruptionCategory.IDENTITY_CORRUPTION,
    CorruptionCategory.INTENT_DRIFT,
  ];

  async score(
    original: string,
    suggested: string,
    _opts: DetectorOptions,
  ): Promise<CategoryScore[]> {
    const oExcl = (original.match(/!/g) ?? []).length;
    const sExcl = (suggested.match(/!/g) ?? []).length;
    const exclDelta = Math.abs(oExcl - sExcl);
    const toneProb = exclDelta >= 2 ? 0.7 : exclDelta === 1 ? 0.3 : 0;

    return [
      {
        category: CorruptionCategory.TONE_SHIFT,
        probability: toneProb,
        severity: 3,
        evidence: [`excl_delta=${exclDelta}`],
        source: this.name,
      },
      {
        category: CorruptionCategory.IDENTITY_CORRUPTION,
        probability: 0,
        severity: 1,
        evidence: [],
        source: this.name,
      },
      {
        category: CorruptionCategory.INTENT_DRIFT,
        probability: 0,
        severity: 1,
        evidence: [],
        source: this.name,
      },
    ];
  }
}
