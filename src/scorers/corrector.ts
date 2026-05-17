/**
 * Corrector — when SIL flags high risk, propose an alternative suggestion
 * that preserves the original intent.
 *
 * Backends: OpenRouter (preferred) or Anthropic direct.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CategoryScore, CorruptionCategory } from "../types/index.js";

const CORRECTOR_SYSTEM = `You are SIL-Corrector. Given a user's original text and an AI rewrite that has corrupted the user's intent in specific ways, produce a CORRECTED version that:

1. Preserves the AI rewrite's improvements (grammar, clarity, structure)
2. RESTORES the corrupted intent on the flagged axes (polarity, commitment, tone, etc.)
3. Makes the MINIMUM edits necessary

Return strict JSON only:
{
  "corrected": "<the corrected text>",
  "edits_made": ["<short description of each restoration>"],
  "confidence": <0-1>
}`;

const CATEGORY_HUMAN: Record<CorruptionCategory, string> = {
  polarity_negation: "polarity reversal (a negation was inserted or removed)",
  polarity_antonym: "polarity reversal (a word was swapped for its antonym)",
  modal_shift: "modal strength change (e.g., 'might' became 'must')",
  commitment_distortion: "commitment level change (e.g., 'I'll try' became 'I will')",
  quantifier_shift: "quantifier shift (e.g., 'some' became 'all')",
  temporal_shift: "temporal shift (e.g., 'soon' became 'now')",
  subject_object_swap: "subject or object pronoun was changed",
  scope_error: "negation or quantifier scope error",
  tone_shift: "tone or register shift (e.g., calm became aggressive)",
  hedging_shift: "hedging marker was added or removed",
  identity_corruption: "a name or identity was mangled",
  intent_drift: "the AI rewrite drifted to a different topic or pragmatic axis",
};

export interface CorrectionResult {
  corrected: string;
  editsMade: string[];
  confidence: number;
}

interface CorrectorBackend {
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}

class OpenRouterCorrectorBackend implements CorrectorBackend {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://openrouter.ai/api/v1",
  ) {}

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
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
        max_tokens: 600,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter corrector error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content ?? "";
  }
}

class AnthropicCorrectorBackend implements CorrectorBackend {
  private client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: 600,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    return resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
  }
}

export class Corrector {
  private backend: CorrectorBackend;

  constructor(
    backendOrApiKey: CorrectorBackend | string,
    model?: string,
  ) {
    if (typeof backendOrApiKey === "string") {
      // Legacy: passed an Anthropic API key directly
      this.backend = new AnthropicCorrectorBackend(
        backendOrApiKey,
        model ?? "claude-haiku-4-5-20251001",
      );
    } else {
      this.backend = backendOrApiKey;
    }
  }

  /**
   * Convenience constructor: pick backend from env vars.
   * Priority: OPENROUTER_API_KEY > ANTHROPIC_API_KEY.
   */
  static fromEnv(model?: string): Corrector | null {
    return Corrector.fromEnvOrKeys({
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      model,
    });
  }

  /**
   * Pick a backend from explicit keys (used by SIL.hosted).
   */
  static fromEnvOrKeys(opts: {
    openrouterApiKey?: string;
    anthropicApiKey?: string;
    model?: string;
  }): Corrector | null {
    if (opts.openrouterApiKey) {
      return new Corrector(
        new OpenRouterCorrectorBackend(
          opts.openrouterApiKey,
          opts.model ?? "anthropic/claude-haiku-4.5",
        ),
      );
    }
    if (opts.anthropicApiKey) {
      return new Corrector(opts.anthropicApiKey, opts.model);
    }
    return null;
  }

  async correct(
    original: string,
    suggested: string,
    flaggedCategories: CategoryScore[],
  ): Promise<CorrectionResult> {
    const flagged = flaggedCategories
      .filter((c) => c.probability > 0.4)
      .sort((a, b) => b.probability - a.probability);

    const flagList = flagged
      .map((f) => `- ${CATEGORY_HUMAN[f.category]} (confidence ${Math.round(f.probability * 100)}%)`)
      .join("\n");

    const user = `ORIGINAL (user-authored):
"""${original}"""

AI REWRITE (corrupted):
"""${suggested}"""

CORRUPTIONS DETECTED:
${flagList || "- (none above threshold)"}

Produce the corrected version. JSON only.`;

    let text: string;
    try {
      text = await this.backend.complete(CORRECTOR_SYSTEM, user);
    } catch (err) {
      return {
        corrected: original,
        editsMade: [`backend failed: ${(err as Error).message}`],
        confidence: 0.1,
      };
    }

    try {
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned) as {
        corrected?: string;
        edits_made?: string[];
        confidence?: number;
      };
      return {
        corrected: parsed.corrected ?? original,
        editsMade: parsed.edits_made ?? [],
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      };
    } catch {
      return {
        corrected: original,
        editsMade: ["correction parse failed — returning original"],
        confidence: 0.1,
      };
    }
  }
}
