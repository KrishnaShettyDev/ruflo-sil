/**
 * Ruflo pre-edit hook.
 *
 * Fires whenever a ruflo agent (or Claude Code itself) is about to apply an
 * edit to user-authored text. Calls SIL inline. If risk is high, blocks the
 * edit and returns the SIL explanation back to the host LLM so it can either
 * try again or surface a warning to the user.
 *
 * Hook contract (matches ruflo's hook system):
 *   - input:  { userText: string, suggestedEdit: string, surface?: string, userId?: string }
 *   - output: { allow: boolean, reason?: string, correction?: string, risk?: number }
 */

import { SIL } from "../core/sil.js";

interface PreEditInput {
  userText: string;
  suggestedEdit: string;
  surface?: string;
  userId?: string;
  contextTurns?: string[];
}

interface PreEditOutput {
  allow: boolean;
  reason?: string;
  correction?: string;
  risk?: number;
  silTraceId?: string;
}

let _silInstance: SIL | null = null;

function getSil(): SIL {
  if (_silInstance) return _silInstance;
  if (process.env.HF_API_KEY) {
    _silInstance = SIL.hosted({
      hfApiKey: process.env.HF_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
      enableJudge: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY),
      enableCorrector: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY),
    });
  } else {
    _silInstance = SIL.local();
  }
  return _silInstance;
}

export async function preEditHook(input: PreEditInput): Promise<PreEditOutput> {
  const sil = getSil();
  const surface = (input.surface ?? "chat") as any;

  const result = await sil.score({
    original: input.userText,
    suggested: input.suggestedEdit,
    surface,
    userId: input.userId,
    context: input.contextTurns,
    generateCorrection: true,
  });

  if (result.action === "block") {
    return {
      allow: false,
      reason: result.explanation,
      correction: result.correction,
      risk: result.overallRisk,
      silTraceId: result.trace.requestId,
    };
  }

  if (result.action === "warn") {
    return {
      allow: true,
      reason: result.explanation,
      risk: result.overallRisk,
      silTraceId: result.trace.requestId,
    };
  }

  return {
    allow: true,
    risk: result.overallRisk,
    silTraceId: result.trace.requestId,
  };
}

export default preEditHook;
