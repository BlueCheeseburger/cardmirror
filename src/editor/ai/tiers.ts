/**
 * Model tiers for the AI panels. A feature asks for a tier ("lite" for cheap
 * grading, "balanced" for generation and scoring) and this picks the model for
 * the active provider. OpenRouter has no tier map (the user names one model),
 * so every tier resolves to it.
 */

import { settings } from '../settings.js';
import { callLlm, activeApiKey, resolveAiModel, LlmError, type LlmReply, type LlmRequest } from './llm.js';

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

/** A `tier` call whose reply must parse. `parse` returns null for a reply it
 *  can't use. Gemini 2.5 and other reasoning models spend hidden thinking
 *  tokens from the same output budget, so a long input can leave the JSON
 *  cut off mid-list: when the reply stopped on the token limit, retry once
 *  with double the budget before giving up. */
export async function callTierParsed<T>(
  tier: AiTier,
  req: Omit<LlmRequest, 'apiKey' | 'model'>,
  parse: (text: string) => T | null,
): Promise<T> {
  let maxTokens = req.maxTokens ?? 8192;
  for (let attempt = 0; ; attempt++) {
    const reply = await callTier(tier, { ...req, maxTokens });
    const value = parse(reply.text);
    if (value !== null) return value;
    const truncated = reply.stopReason === 'max_tokens';
    if (truncated && attempt === 0) {
      maxTokens *= 2;
      continue;
    }
    throw new LlmError(
      truncated
        ? "The AI's reply was cut off before it finished. Try again, or raise Max output tokens " +
            'under Settings -> Comments & AI.'
        : "Couldn't read the AI's reply. Try again.",
      null,
      'parse',
    );
  }
}

/** The list under `key` in a model's JSON reply (`{"key":[...]}`, or a bare
 *  array). When the JSON doesn't parse whole (a reply cut off by the token
 *  limit), salvages every complete object in the list before the cut. */
export function parseJsonList(text: string, key: string): unknown[] {
  const json = parseJsonLoose(text);
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const v = (json as Record<string, unknown>)[key];
    return Array.isArray(v) ? v : [];
  }
  const at = text.search(new RegExp(`"${key}"\\s*:\\s*\\[`));
  const start = at >= 0 ? text.indexOf('[', at) : text.indexOf('[');
  if (start < 0) return [];
  const out: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(text.slice(objStart, i + 1)));
        } catch {
          /* a malformed item: skip it */
        }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return out;
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
