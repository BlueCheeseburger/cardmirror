/**
 * Cross-Ex Practice: question generation, "3 more like this", and the trap
 * drill. Prompt building and reply parsing live here, free of any DOM, so
 * they test without a model.
 */

import { callTierParsed, parseJsonList, parseJsonLoose } from './tiers.js';
import type { Node as PMNode } from 'prosemirror-model';
import { collectCrossExItems, type CardInfo } from './card-analysis.js';

export type Side = 'aff' | 'neg';

export interface CrossExQuestion {
  id: string;
  /** null when the doc has no real Aff/Neg split. */
  side: Side | null;
  question: string;
  /** Index into the card list the question targets, if any. */
  card: number | null;
  /** Tag of the targeted card, kept so the cite stays clickable after reload. */
  cardTag?: string;
  /** Short cite label for the clickable chip. */
  cardLabel?: string;
  /** The opponent's likely answer, in their voice. */
  answer: string;
  /** One sentence follow-up to run next; absent when there is none. */
  press?: string;
}

export interface TrapQuestion {
  setup: string;
  wrongAnswer: string;
  gotcha: string;
  ideal: string;
  lesson: string;
}

export type TrapVerdict = 'avoided' | 'fell' | 'partial';

/** Most characters of document text sent in one prompt. */
export const HIGHLIGHT_CAP = 40_000;
/** Cites go in whole up to this (some carry long qualifications). */
export const CITE_CAP = 1_000;
export const SHORT_DOC_WORDS = 400;
export const PRESS_CAP = 300;

/** Emphasis only: the panel renders **bold** and *italic* and shows any
 *  other Markdown literally. */
export const EMPHASIS_RULE =
  'Formatting: you may use **bold** and *italic* inside the text strings for emphasis, sparingly. ' +
  'No other formatting: no headings, lists, links, code or other Markdown.';

export const CROSSEX_SYSTEM_PROMPT =
  'You are a cross-examination coach for competitive debate. You write the questions an ' +
  'OPPONENT would ask the debater about the cards in their file, and the answer that opponent ' +
  'would likely get.\n\n' +
  'Rules:\n' +
  '- The file is given in order. POCKET, HAT and BLOCK lines are its headings: they show which ' +
  'argument everything under them belongs to. [Analytic] and [Text] entries are arguments the ' +
  'debater wrote or will say themselves (analytics, overviews, framing). Each [Card] has its tag, ' +
  'its full cite and, when present, its HIGHLIGHTED text, which is what is read aloud. You are not ' +
  'given the unhighlighted card text.\n' +
  '- Questions can target any of it: headings, tags, analytics, written arguments and highlighted ' +
  'card text. Set "card" only when a question is about a specific [Card].\n' +
  '- Each question is 1-3 sentences, direct and pointed. No "can you explain..." filler.\n' +
  '- Expose missing warrants, weak internal links, unqualified authors, in-card contradictions, ' +
  'non-unique impacts and overclaims.\n' +
  '- When a question targets a card, name it by author and year (e.g. "Your Brady 25 evidence...") ' +
  'and set "card" to that card\'s number.\n' +
  '- "answer": what the debater would likely say, written in their voice, 2-3 sentences, no coaching.\n' +
  `- "press": ONE sentence addressed to the questioner, starting with a verb ("Push on...", ` +
  `"Make them defend..."), naming the best follow-up after that answer. At most ${PRESS_CAP} ` +
  'characters. Omit it if there is genuinely no good follow-up.\n' +
  `- ${EMPHASIS_RULE}\n\n` +
  'Decide whether the file is Aff, Neg or both from speech labels (1AC/2AC/1AR/2AR are Aff; ' +
  '1NC/2NC/1NR/2NR are Neg), argument type (plan, advantages and solvency are Aff; DAs, CPs, Ks, ' +
  'T and AT:/A2: blocks are Neg) and tag, pocket and file names. If it is one-sided or unclear, ' +
  'use side "none" for every question.\n\n' +
  'Write 3 to 6 questions in total, split across the sides you find in proportion to how much ' +
  'highlighted content each side has (a thin side gets fewer questions, possibly none).\n\n' +
  'Reply with JSON only, no prose:\n' +
  '{"questions":[{"side":"aff"|"neg"|"none","card":<number or null>,"question":"...",' +
  '"answer":"...","press":"..."}]}';

export const MORE_LIKE_THIS_SYSTEM_PROMPT =
  CROSSEX_SYSTEM_PROMPT.split('Decide whether')[0]! +
  'You are given one seed question. Write exactly THREE new questions on the same line of ' +
  'attack with fresh angles. Never repeat or paraphrase the seed.\n\n' +
  'Reply with JSON only, no prose:\n' +
  '{"questions":[{"card":<number or null>,"question":"...","answer":"...","press":"..."}]}';

export const TRAP_SYSTEM_PROMPT =
  'You are a cross-examination coach. Write EXACTLY THREE trap questions an opponent could ask ' +
  'about the debater\'s cards. A trap is a setup question that looks innocent, where a careless ' +
  'answer walks the debater into a devastating follow-up.\n\n' +
  'Traps may probe logic, warrants and internal links. They must NOT ask the debater to quote or ' +
  'recall card wording: the debater cannot see the card during the drill.\n' +
  'Good: "Does your card say X is already happening or just that it might happen?"\n' +
  'Bad: "What specific evidence in that card supports that claim?"\n\n' +
  `${EMPHASIS_RULE}\n\n` +
  'Reply with JSON only:\n' +
  '{"traps":[{"setup":"the setup question","wrongAnswer":"the tempting wrong answer",' +
  '"gotcha":"the devastating follow-up","ideal":"the ideal answer","lesson":"one-sentence lesson"}]}';

export const GRADE_SYSTEM_PROMPT =
  'You grade a debater\'s answer to a cross-examination trap. Verdicts: "avoided" (they sidestepped ' +
  'the trap; name exactly how), "fell" (they walked into it; spring the gotcha, say what went ' +
  'wrong and give the fix), "partial" (mostly safe but left an opening). Give the verdict and 2-3 ' +
  `sentences of feedback. ${EMPHASIS_RULE}\n` +
  'Reply with JSON only: {"verdict":"avoided"|"fell"|"partial","feedback":"..."}';

// --- input assembly ---------------------------------------------------------

export interface CrossExInput {
  /** The prompt body sent to the model. */
  text: string;
  /** Cards in the prompt, indexed as the model sees them ([Card n]). */
  cards: CardInfo[];
  /** Characters of document text in the prompt before any trimming. */
  chars: number;
  /** Words in the whole document. */
  totalWords: number;
  /** True if the text exceeds the cap (needs the user's go-ahead to trim). */
  overCap: boolean;
}

const wc = (s: string): number => (s.trim() === '' ? 0 : s.trim().split(/\s+/u).length);

/** Build the model input from the whole document, in order: pocket / hat /
 *  block headings, analytics, loose text, and every card's tag and full cite
 *  with its highlighted text when it has any. Unhighlighted card text is
 *  never sent. `trim` cuts the whole thing to the cap. */
export function buildCrossExInput(doc: PMNode, trim: boolean): CrossExInput {
  const items = collectCrossExItems(doc);
  const lines: string[] = [];
  const kept: CardInfo[] = [];
  let totalWords = 0;
  for (const it of items) {
    if (it.kind === 'heading') {
      lines.push(`${it.label}: ${it.text}`);
      totalWords += wc(it.text);
    } else if (it.kind === 'analytic') {
      lines.push(`[Analytic]\n${it.text}\n`);
      totalWords += wc(it.text);
    } else if (it.kind === 'text') {
      lines.push(`[Text]\n${it.text}\n`);
      totalWords += wc(it.text);
    } else {
      const c = it.card;
      const n = kept.length;
      kept.push(c);
      totalWords += wc(c.tag) + c.bodyWords;
      lines.push(
        `[Card ${n}]\nTAG: ${c.tag}\nCITE: ${c.cite.slice(0, CITE_CAP)}\n` +
          (c.highlightText.trim() ? `HIGHLIGHTED: ${c.highlightText}\n` : ''),
      );
    }
  }
  let text = lines.join('\n');
  const chars = text.length;
  const overCap = chars > HIGHLIGHT_CAP;
  if (trim && overCap) text = text.slice(0, HIGHLIGHT_CAP);
  return { text, cards: kept, chars, totalWords, overCap };
}

/** The amber notice for a doc too short to give good questions, or null. */
export function shortDocNotice(input: CrossExInput): string | null {
  if (input.totalWords < SHORT_DOC_WORDS) {
    const pages = Math.max(1, Math.round(input.totalWords / 500));
    return `This document is short (about ${input.totalWords} words, roughly ${pages} page${pages === 1 ? '' : 's'}): expect few or shallow questions.`;
  }
  return null;
}

// --- parsing ----------------------------------------------------------------

let qSeq = 0;
const newId = (): string => `q${Date.now().toString(36)}${(qSeq++).toString(36)}`;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function parseQuestions(
  text: string,
  cardCount: number,
  forcedSide?: Side | null,
): CrossExQuestion[] {
  const list = parseJsonList(text, 'questions');
  const out: CrossExQuestion[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const question = str(r['question']);
    if (!question) continue;
    const answer = str(r['answer']);
    const sideRaw = str(r['side']).toLowerCase();
    const side: Side | null =
      forcedSide !== undefined
        ? forcedSide
        : sideRaw === 'aff' || sideRaw === 'neg'
          ? sideRaw
          : null;
    const cardNum = typeof r['card'] === 'number' ? Math.trunc(r['card']) : null;
    const card = cardNum !== null && cardNum >= 0 && cardNum < cardCount ? cardNum : null;
    let press = str(r['press']);
    if (press.length > PRESS_CAP) press = press.slice(0, PRESS_CAP - 1).trimEnd() + '…';
    out.push({ id: newId(), side, question, card, answer, ...(press ? { press } : {}) });
  }
  return out;
}

/** Aff/Neg headers only when the questions really split both ways. */
export function hasSideSplit(qs: readonly CrossExQuestion[]): boolean {
  return qs.some((q) => q.side === 'aff') && qs.some((q) => q.side === 'neg');
}

export function parseTraps(text: string): TrapQuestion[] {
  const list = parseJsonList(text, 'traps');
  const out: TrapQuestion[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const t: TrapQuestion = {
      setup: str(r['setup']),
      wrongAnswer: str(r['wrongAnswer']),
      gotcha: str(r['gotcha']),
      ideal: str(r['ideal']),
      lesson: str(r['lesson']),
    };
    if (t.setup && t.ideal) out.push(t);
  }
  return out.slice(0, 3);
}

export function parseGrade(text: string): { verdict: TrapVerdict; feedback: string } | null {
  const j = parseJsonLoose(text) as Record<string, unknown> | null;
  if (!j || typeof j !== 'object') return null;
  const v = str(j['verdict']).toLowerCase();
  const verdict: TrapVerdict | null =
    v === 'avoided' ? 'avoided' : v === 'fell' ? 'fell' : v.startsWith('partial') ? 'partial' : null;
  const feedback = str(j['feedback']);
  return verdict && feedback ? { verdict, feedback } : null;
}

// --- model calls ------------------------------------------------------------

/** Fill `cardTag` / `cardLabel` from the card index the model returned. */
export function attachCards(
  qs: CrossExQuestion[],
  cards: readonly CardInfo[],
): CrossExQuestion[] {
  for (const q of qs) {
    const c = q.card !== null ? cards[q.card] : undefined;
    if (c) {
      q.cardTag = c.tag;
      q.cardLabel = (c.cite || c.tag).slice(0, 48).trim();
    }
  }
  return qs;
}

const nonEmpty = <T>(list: T[]): T[] | null => (list.length > 0 ? list : null);

/** An `onText` that re-parses the streamed reply and reports the complete
 *  items so far, only when there are more than last time. */
function partialItems<T>(parse: (text: string) => T[], report?: (items: T[]) => void): ((t: string) => void) | undefined {
  if (!report) return undefined;
  let seen = 0;
  return (text) => {
    const items = parse(text);
    if (items.length > seen) {
      seen = items.length;
      report(items);
    }
  };
}

export async function generateQuestions(
  input: CrossExInput,
  onPartial?: (qs: CrossExQuestion[]) => void,
): Promise<CrossExQuestion[]> {
  const qs = await callTierParsed(
    'balanced',
    {
      maxTokens: 8192,
      system: CROSSEX_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: input.text }],
      onText: partialItems(
        (t) => attachCards(parseQuestions(t, input.cards.length), input.cards).slice(0, 6),
        onPartial,
      ),
    },
    (text) => nonEmpty(parseQuestions(text, input.cards.length)),
  );
  return attachCards(qs, input.cards).slice(0, 6);
}

export async function generateMoreLikeThis(
  seed: CrossExQuestion,
  input: CrossExInput,
  onPartial?: (qs: CrossExQuestion[]) => void,
): Promise<CrossExQuestion[]> {
  const qs = await callTierParsed(
    'balanced',
    {
      maxTokens: 8192,
      system: MORE_LIKE_THIS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${input.text}\n\nSEED QUESTION: ${seed.question}\n(Seed answer: ${seed.answer})`,
        },
      ],
      onText: partialItems(
        (t) =>
          attachCards(
            parseQuestions(t, input.cards.length, seed.side)
              .filter((q) => q.question !== seed.question)
              .slice(0, 3),
            input.cards,
          ),
        onPartial,
      ),
    },
    (text) =>
      nonEmpty(
        parseQuestions(text, input.cards.length, seed.side).filter((q) => q.question !== seed.question),
      ),
  );
  return attachCards(qs.slice(0, 3), input.cards);
}

export async function generateTraps(
  input: CrossExInput,
  questions: readonly CrossExQuestion[],
  onPartial?: (traps: TrapQuestion[]) => void,
): Promise<TrapQuestion[]> {
  const asked = questions.map((q) => `- ${q.question}`).join('\n');
  return callTierParsed(
    'balanced',
    {
      maxTokens: 8192,
      system: TRAP_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${input.text}\n\nQUESTIONS ALREADY GENERATED (build the traps around the same cards):\n${asked}`,
        },
      ],
      onText: partialItems(parseTraps, onPartial),
    },
    (text) => nonEmpty(parseTraps(text)),
  );
}

export async function gradeTrap(
  trap: TrapQuestion,
  answer: string,
): Promise<{ verdict: TrapVerdict; feedback: string }> {
  return callTierParsed(
    'lite',
    {
      maxTokens: 2048,
      system: GRADE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `SETUP QUESTION: ${trap.setup}\nTEMPTING WRONG ANSWER: ${trap.wrongAnswer}\n` +
            `GOTCHA FOLLOW-UP: ${trap.gotcha}\nIDEAL ANSWER: ${trap.ideal}\n\n` +
            `DEBATER'S ANSWER: ${answer}`,
        },
      ],
    },
    parseGrade,
  );
}
