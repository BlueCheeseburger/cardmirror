/**
 * Card Credibility: score each card from its tag and cite alone (the model
 * never reads the card body). Batched, cached per document, and a skipped
 * card is left out rather than faked as 0/Weak.
 */

import { callTierParsed, parseJsonList } from './tiers.js';
import { EMPHASIS_RULE } from './crossex.js';
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
  /** Does the cite plausibly support what the tag claims ("tag fit"). */
  tagFit: number;
  reason: string;
  /** Cross-ex attack; only for Shaky or Weak cards (overall below 6). */
  press: string;
  /** Which scoring batch (see `ScoreRun.batches`) and which card number in
   *  it, so a deeper analysis can replay the exact exchange. Absent on
   *  scores saved before this was recorded. */
  batch?: number;
  index?: number;
}

/** One scoring call as it went to and came back from the model. */
export interface ScoreBatch {
  prompt: string;
  reply: string;
}

export const BATCH_SIZE = 40;
export const TAG_CAP = 300;
export const CITE_CAP = 600;

/** Overall scores below this are Shaky or Weak and get a cross-ex press. */
export const PRESS_BELOW = 6;

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
    `- recency: age only matters when something relevant has changed since the piece was written. ` +
    `Lower the score only for the factors that have plausibly changed since then (new laws or ` +
    `policies, new data, an economy, conflict, technology or political situation that has moved on). ` +
    `An old card making a theoretical or philosophical argument that still holds is fine and scores ` +
    `high. But an old theoretical argument built on conditions that no longer hold is not recent ` +
    `(theory about the economy that rests on the 1990s economy scores low). Fast-moving topics ` +
    `(geopolitics, military, the economy, polling, legislation in progress) date quickly; theory, ` +
    `history and settled social science barely date at all. No date in the cite = 0.\n` +
    `- source: peer-reviewed 9-10; government reports 8-9; established think tanks 7-8; partisan ` +
    `think tanks and major newspapers 5-6; op-eds 3-4; blogs/unknown 1-2; no source in the cite 0.\n` +
    `- tagFit: does the cite plausibly support what the tag claims? 10 directly proves it; 7 related ` +
    `but slightly overextended; 4 tag claims more than the source likely supports; 1 obvious mismatch. ` +
    `Judge from how bold the tag is against what the cite says about the source's scope.\n` +
    `- reason: 20 words or fewer, the most important credibility factors, good or bad.\n` +
    `- press: only when overall is below ${PRESS_BELOW} (Shaky or Weak): 15 words or fewer, the ` +
    `sharpest cross-ex attack on this card's credibility. For overall ${PRESS_BELOW} or higher, ` +
    `use an empty string.\n\n` +
    `${EMPHASIS_RULE} Reply with JSON only, one entry per card you can score, using the card's ` +
    `number as "i":\n` +
    `{"cards":[{"i":0,"overall":5,"author":6,"recency":4,"source":6,"tagFit":5,` +
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

export function parseBatch(text: string, batch: readonly CardInfo[], batchNo?: number): CredScore[] {
  const list = parseJsonList(text, 'cards');
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
    const tagFit = clamp10(r['tagFit'] ?? r['claimFit']);
    if (author === null || recency === null || source === null || tagFit === null) continue;
    const overall =
      clamp10(r['overall']) ?? Math.round((author + recency + source + tagFit) / 4);
    seen.add(i);
    out.push({
      tag: card.tag,
      overall,
      verdict: verdictFor(overall),
      author,
      recency,
      source,
      tagFit,
      reason: typeof r['reason'] === 'string' ? r['reason'].trim() : '',
      press: overall < PRESS_BELOW && typeof r['press'] === 'string' ? r['press'].trim() : '',
      ...(batchNo !== undefined ? { batch: batchNo, index: i } : {}),
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
  /** Every successful scoring call, indexed by `CredScore.batch`. */
  batches: ScoreBatch[];
}

/** A score saved by an older version: `claimFit` became `tagFit`, and the
 *  press is dropped from cards scoring Solid or Strong. */
export function normalizeScore(raw: CredScore & { claimFit?: number }): CredScore {
  const tagFit = typeof raw.tagFit === 'number' ? raw.tagFit : (raw.claimFit ?? 0);
  const { claimFit: _old, ...rest } = raw;
  return { ...rest, tagFit, press: raw.overall < PRESS_BELOW ? raw.press : '' };
}

/** Score every card in batches of 40. A failed batch counts its cards as
 *  skipped; if every batch fails the first error is rethrown. */
export async function scoreCards(
  cards: readonly CardInfo[],
  onProgress?: (done: number, total: number) => void,
  /** Every score so far, as each one streams in. */
  onScores?: (scores: CredScore[]) => void,
): Promise<ScoreRun> {
  const system = credibilitySystemPrompt(new Date());
  const scores: CredScore[] = [];
  const done: ScoreBatch[] = [];
  let firstError: unknown = null;
  let failedBatches = 0;
  let batches = 0;
  for (let at = 0; at < cards.length; at += BATCH_SIZE) {
    const batch = cards.slice(at, at + BATCH_SIZE);
    batches++;
    const prompt = buildBatchPrompt(batch);
    try {
      const batchNo = done.length;
      const parsed = await callTierParsed(
        'balanced',
        {
          maxTokens: 8192,
          system,
          messages: [{ role: 'user', content: prompt }],
          onText: onScores
            ? (() => {
                let seen = 0;
                return (text: string): void => {
                  const partial = parseBatch(text, batch, batchNo);
                  if (partial.length > seen) {
                    seen = partial.length;
                    onScores([...scores, ...partial]);
                  }
                };
              })()
            : undefined,
        },
        (text) => {
          const s = parseBatch(text, batch, batchNo);
          return s.length > 0 ? { s, text } : null;
        },
      );
      done.push({ prompt, reply: parsed.text });
      scores.push(...parsed.s);
    } catch (err) {
      failedBatches++;
      firstError ??= err;
    }
    onProgress?.(Math.min(at + BATCH_SIZE, cards.length), cards.length);
  }
  if (failedBatches === batches && firstError) throw firstError;
  return { scores, total: cards.length, batches: done };
}
