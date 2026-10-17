/**
 * Model tiers for the AI panels. A feature asks for a tier ("lite" for cheap
 * grading, "balanced" for generation and scoring) and this picks the model for
 * the active provider. OpenRouter has no tier map (the user names one model),
 * so every tier resolves to it.
 */

import { settings } from '../settings.js';
import { callLlm, activeApiKey, resolveAiModel, type LlmReply, type LlmRequest } from './llm.js';

export type AiTier = 'lite' | 'balanced';

export const ANTHROPIC_LITE_MODEL = 'claude-haiku-4-5';
export const GEMINI_LITE_MODEL = 'gemini-2.5-flash-lite';
export const GEMINI_BALANCED_MODEL = 'gemini-2.5-flash';

/** The model for `tier` under the active provider. `balanced` never lands on
 *  a "lite" model: a Gemini Flash Lite override is bumped up to Flash. */
export function modelForTier(tier: AiTier): string {
  const provider = settings.get('aiProvider');
  if (provider === 'openrouter') return resolveAiModel();
  if (provider === 'gemini') {
    if (tier === 'lite') return GEMINI_LITE_MODEL;
    const m = resolveAiModel();
    return /flash-lite/i.test(m) ? GEMINI_BALANCED_MODEL : m;
  }
  if (tier === 'lite') return ANTHROPIC_LITE_MODEL;
  const m = resolveAiModel();
  return /haiku/i.test(m) ? resolveAiModel() : m;
}

/** One model call on `tier`, with the active provider's key. */
export function callTier(
  tier: AiTier,
  req: Omit<LlmRequest, 'apiKey' | 'model'>,
): Promise<LlmReply> {
  return callLlm({ ...req, apiKey: activeApiKey(), model: modelForTier(tier) });
}

/** Pull the first JSON value out of a model reply, tolerating code fences and
 *  prose around it. Returns null when nothing parses. */
export function parseJsonLoose(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const whole = tryParse(stripped);
  if (whole !== undefined) return whole;
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const a = stripped.indexOf(open);
    const b = stripped.lastIndexOf(close);
    if (a >= 0 && b > a) {
      const v = tryParse(stripped.slice(a, b + 1));
      if (v !== undefined) return v;
    }
  }
  return null;
}
