/**
 * Card Credibility: score each card from its tag and cite alone (the model
 * never reads the card body). Batched, cached per document, and a skipped
 * card is left out rather than faked as 0/Weak.
 */

import { callTier, parseJsonLoose } from './tiers.js';
import type { CardInfo } from './card-analysis.js';

export type CredVerdict = 'Strong' | 'Solid' | 'Shaky' | 'Weak';

export interface CredScore {
  /** Tag position at scoring time is unstable; the tag text is the key. */
  tag: string;
  overall: number;
  verdict: CredVerdict;
  author: number;
  recency: number;
  source: number;
  claimFit: number;
  reason: string;
  press: string;
}

export const BATCH_SIZE = 40;
export const TAG_CAP = 300;
export const CITE_CAP = 600;

export function verdictFor(score: number): CredVerdict {
  return score >= 8 ? 'Strong' : score >= 6 ? 'Solid' : score >= 4 ? 'Shaky' : 'Weak';
}

/** Cards eligible for scoring: those with cite text under the tag. */
export function scorableCards(cards: readonly CardInfo[]): CardInfo[] {
  return cards.filter((c) => c.tag.trim() !== '' && c.cite.trim() !== '');
}

export function credibilitySystemPrompt(today: Date): string {
  const date = today.toISOString().slice(0, 10);
  return (
    `You score the credibility of debate evidence from ONLY the tag (the claim) and the cite. ` +
    `You never see the card body. Today's date is ${date}; judge recency against the current year. ` +
    `Judge only what the cite actually says. Never invent credentials, dates or sources.\n\n` +
    `For each card give four sub-scores (0-10) and an overall score (0-10):\n` +
    `- author: expertise relative to THIS claim. 10 = PhD/senior practitioner in the exact field; ` +
    `6 = tangentially related credentialed expert; 4 = journalist or expert outside their specialty; ` +
    `2 = generalist; 0 = anonymous/no credentials. If only an organization is listed use its ` +
    `reputation: RAND, CBO, CRS, GAO, IPCC 8-9; Brookings, CSIS, CFR 6-7; Heritage, CATO, CAP, AEI 4-5; ` +
    `media outlets 3-4.\n` +
    `- recency, weighted by how fast the topic decays. Fast (geopolitics, military, economics, ` +
    `polling): 2024 = 10, 2022 = 6, 2020 = 3, pre-2019 = 1. Medium (policy, legislation, public health): ` +
    `2022 = 8, pre-2016 = 2. Slow (theory, social science, history): within 10 years = 8 or more. ` +
    `No date in the cite = 0.\n` +
    `- source: peer-reviewed 9-10; government reports 8-9; established think tanks 7-8; partisan ` +
    `think tanks and major newspapers 5-6; op-eds 3-4; blogs/unknown 1-2; no source in the cite 0.\n` +
    `- claimFit: does the cite plausibly support what the tag claims? 10 directly proves it; 7 related ` +
    `but slightly overextended; 4 tag claims more than the source likely supports; 1 obvious mismatch. ` +
    `Judge from how bold the tag is against what the cite says about the source's scope.\n` +
    `- reason: 12 words or fewer, the single most important credibility factor, good or bad.\n` +
    `- press: 15 words or fewer, the sharpest cross-ex attack on this card's credibility.\n\n` +
    `Plain text only. Reply with JSON only, one entry per card you can score, using the card's ` +
    `number as "i":\n` +
    `{"cards":[{"i":0,"overall":7,"author":8,"recency":6,"source":7,"claimFit":7,` +
    `"reason":"...","press":"..."}]}`
  );
}

export function buildBatchPrompt(batch: readonly CardInfo[]): string {
  return batch
    .map(
      (c, i) =>
        `[${i}] TAG: ${c.tag.slice(0, TAG_CAP)}\n    CITE: ${c.cite.slice(0, CITE_CAP)}`,
    )
    .join('\n');
}

const clamp10 = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : null;

export function parseBatch(text: string, batch: readonly CardInfo[]): CredScore[] {
  const json = parseJsonLoose(text) as { cards?: unknown } | unknown[] | null;
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { cards?: unknown }).cards)
      ? (json as { cards: unknown[] }).cards
      : [];
  const out: CredScore[] = [];
  const seen = new Set<number>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const i = typeof r['i'] === 'number' ? Math.trunc(r['i']) : -1;
    const card = batch[i];
    if (!card || seen.has(i)) continue;
    const author = clamp10(r['author']);
    const recency = clamp10(r['recency']);
    const source = clamp10(r['source']);
    const claimFit = clamp10(r['claimFit']);
    if (author === null || recency === null || source === null || claimFit === null) continue;
    const overall =
      clamp10(r['overall']) ?? Math.round((author + recency + source + claimFit) / 4);
    seen.add(i);
    out.push({
      tag: card.tag,
      overall,
      verdict: verdictFor(overall),
      author,
      recency,
      source,
      claimFit,
      reason: typeof r['reason'] === 'string' ? r['reason'].trim() : '',
      press: typeof r['press'] === 'string' ? r['press'].trim() : '',
    });
  }
  return out;
}

export function averageScore(scores: readonly CredScore[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((a, s) => a + s.overall, 0) / scores.length;
}

export interface ScoreRun {
  scores: CredScore[];
  total: number;
}

/** Score every card in batches of 40. A failed batch counts its cards as
 *  skipped; if every batch fails the first error is rethrown. */
export async function scoreCards(
  cards: readonly CardInfo[],
  onProgress?: (done: number, total: number) => void,
): Promise<ScoreRun> {
  const system = credibilitySystemPrompt(new Date());
  const scores: CredScore[] = [];
  let firstError: unknown = null;
  let failedBatches = 0;
  let batches = 0;
  for (let at = 0; at < cards.length; at += BATCH_SIZE) {
    const batch = cards.slice(at, at + BATCH_SIZE);
    batches++;
    try {
      const reply = await callTier('balanced', {
        maxTokens: 8192,
        system,
        messages: [{ role: 'user', content: buildBatchPrompt(batch) }],
      });
      scores.push(...parseBatch(reply.text, batch));
    } catch (err) {
      failedBatches++;
      firstError ??= err;
    }
    onProgress?.(Math.min(at + BATCH_SIZE, cards.length), cards.length);
  }
  if (failedBatches === batches && firstError) throw firstError;
  return { scores, total: cards.length };
}
