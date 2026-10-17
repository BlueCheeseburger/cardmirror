/**
 * Cross-Ex Practice: question generation, "3 more like this", and the trap
 * drill. Prompt building and reply parsing live here, free of any DOM, so
 * they test without a model.
 */

import { LlmError } from './llm.js';
import { callTier, parseJsonLoose } from './tiers.js';
import type { CardInfo } from './card-analysis.js';

export type DebateEvent = 'policy' | 'ld' | 'pf';
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

export const HIGHLIGHT_CAP = 40_000;
export const FULL_CAP = 60_000;
export const GUIDE_CAP = 8_000;
export const SHORT_HIGHLIGHT_WORDS = 120;
export const SHORT_DOC_WORDS = 400;
export const PRESS_CAP = 300;

const EVENT_GUIDES: Record<DebateEvent, string> = {
  policy:
    'Event: Policy debate (CX). Cross-examination is a tool for setting up arguments: ' +
    'expose missing warrants, force the debater to concede the limits of their evidence, ' +
    'pin down solvency mechanisms, and lock in concessions that later speeches use. ' +
    'Questions should be short, closed where a concession is the goal, and open where ' +
    'a rambling answer helps the questioner. Typical targets: plan text and solvency, ' +
    'internal links in disadvantages, counterplan competition, kritik links and alternatives.',
  ld:
    'Event: Lincoln-Douglas debate. Cross-examination probes the value, criterion and ' +
    'framework link between them, clarifies and then attacks the philosophical warrants, ' +
    'and exposes contradictions between the case’s framework and its contentions. ' +
    'Typical targets: how the criterion actually justifies the value, whether the ' +
    'author’s argument was about the moral theory at all, and whether the impacts ' +
    'function under the opponent’s own framework.',
  pf:
    'Event: Public Forum debate. Crossfire is brief and conversational; questions should ' +
    'be accessible to a lay judge. Probe the link chain from the card’s claim to the ' +
    'impact, how likely and how soon the impact happens, uniqueness, and the quality ' +
    'and date of the evidence.',
};

export function eventGuide(event: DebateEvent): string {
  return EVENT_GUIDES[event].slice(0, GUIDE_CAP);
}

const PLAIN_TEXT_RULE =
  'Output plain text only: no bold, no italics, no markdown. You may wrap key phrases in ‘single quotes’.';

export const CROSSEX_SYSTEM_PROMPT =
  'You are a cross-examination coach for competitive debate. You write the questions an ' +
  'OPPONENT would ask the debater about the cards in their file, and the answer that opponent ' +
  'would likely get.\n\n' +
  'Rules:\n' +
  '- Questions must target the HIGHLIGHTED/UNDERLINED text only: that is what is read aloud.\n' +
  '- The only exception: you may reference the small reference text if it directly and ' +
  'completely contradicts a claim in the highlighted text of the same card.\n' +
  '- Each question is 1-3 sentences, direct and pointed. No "can you explain..." filler.\n' +
  '- Expose missing warrants, weak internal links, unqualified authors, in-card contradictions, ' +
  'non-unique impacts and overclaims.\n' +
  '- When a question targets a card, name it by author and year (e.g. "Your Brady 25 evidence...") ' +
  'and set "card" to that card\'s number.\n' +
  '- "answer": what the debater would likely say, written in their voice, 2-3 sentences, no coaching.\n' +
  `- "press": ONE sentence addressed to the questioner, starting with a verb ("Push on...", ` +
  `"Make them defend..."), naming the best follow-up after that answer. At most ${PRESS_CAP} ` +
  'characters. Omit it if there is genuinely no good follow-up.\n' +
  `- ${PLAIN_TEXT_RULE}\n\n` +
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
  `${PLAIN_TEXT_RULE}\n\n` +
  'Reply with JSON only:\n' +
  '{"traps":[{"setup":"the setup question","wrongAnswer":"the tempting wrong answer",' +
  '"gotcha":"the devastating follow-up","ideal":"the ideal answer","lesson":"one-sentence lesson"}]}';

export const GRADE_SYSTEM_PROMPT =
  'You grade a debater\'s answer to a cross-examination trap. Verdicts: "avoided" (they sidestepped ' +
  'the trap; name exactly how), "fell" (they walked into it; spring the gotcha, say what went ' +
  'wrong and give the fix), "partial" (mostly safe but left an opening). Give the verdict and 2-3 ' +
  `sentences of feedback. ${PLAIN_TEXT_RULE}\n` +
  'Reply with JSON only: {"verdict":"avoided"|"fell"|"partial","feedback":"..."}';

// --- input assembly ---------------------------------------------------------

export interface CrossExInput {
  /** The prompt body sent to the model. */
  text: string;
  /** Cards that carried highlighted text, indexed as the model sees them. */
  cards: CardInfo[];
  highlightedChars: number;
  fullChars: number;
  /** Total highlighted words across the doc. */
  highlightedWords: number;
  /** Words in the whole doc body. */
  totalWords: number;
  /** True if the doc exceeds the size caps (needs the user's go-ahead to trim). */
  overCap: boolean;
}

const wc = (s: string): number => (s.trim() === '' ? 0 : s.trim().split(/\s+/u).length);

/** Build the model input from the doc's cards. `trim` cuts to the caps. */
export function buildCrossExInput(allCards: readonly CardInfo[], trim: boolean): CrossExInput {
  const cards = allCards.filter((c) => c.readText.trim() !== '');
  let highlightedChars = 0;
  let fullChars = 0;
  let highlightedWords = 0;
  let totalWords = 0;
  for (const c of allCards) totalWords += c.bodyWords;
  for (const c of cards) {
    highlightedChars += c.readText.length;
    fullChars += c.readText.length + c.smallText.length;
    highlightedWords += wc(c.readText);
  }
  const overCap = highlightedChars > HIGHLIGHT_CAP || fullChars > FULL_CAP;
  let hlBudget = trim ? HIGHLIGHT_CAP : Infinity;
  let fullBudget = trim ? FULL_CAP : Infinity;
  const parts: string[] = [];
  const kept: CardInfo[] = [];
  for (const c of cards) {
    if (hlBudget <= 0 || fullBudget <= 0) break;
    const read = c.readText.slice(0, hlBudget);
    hlBudget -= read.length;
    fullBudget -= read.length;
    const small = fullBudget > 0 ? c.smallText.slice(0, Math.min(fullBudget, 1500)) : '';
    fullBudget -= small.length;
    const n = kept.length;
    kept.push(c);
    parts.push(
      `[Card ${n}]\nTAG: ${c.tag}\nCITE: ${c.cite.slice(0, 300)}\n` +
        `HIGHLIGHTED (read aloud): ${read}\n` +
        (small ? `SMALL (reference only): ${small}\n` : ''),
    );
  }
  return {
    text: parts.join('\n'),
    cards: kept,
    highlightedChars,
    fullChars,
    highlightedWords,
    totalWords,
    overCap,
  };
}

/** The amber notice for a doc too short to give good questions, or null. */
export function shortDocNotice(input: CrossExInput): string | null {
  if (input.totalWords < SHORT_DOC_WORDS) {
    const pages = Math.max(1, Math.round(input.totalWords / 500));
    return `This document is short (about ${input.totalWords} words, roughly ${pages} page${pages === 1 ? '' : 's'}): expect few or shallow questions.`;
  }
  if (input.highlightedWords < SHORT_HIGHLIGHT_WORDS) {
    return `Only about ${input.highlightedWords} highlighted words: expect few or shallow questions.`;
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
  const json = parseJsonLoose(text) as { questions?: unknown } | unknown[] | null;
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { questions?: unknown }).questions)
      ? ((json as { questions: unknown[] }).questions)
      : [];
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
  const json = parseJsonLoose(text) as { traps?: unknown } | unknown[] | null;
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { traps?: unknown }).traps)
      ? (json as { traps: unknown[] }).traps
      : [];
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

function systemWithGuide(base: string, event: DebateEvent): string {
  return `${base}\n\n${eventGuide(event)}`;
}

function parseFail(): LlmError {
  return new LlmError("Couldn't read the AI's reply. Try again.", null, 'parse');
}

export async function generateQuestions(
  input: CrossExInput,
  event: DebateEvent,
): Promise<CrossExQuestion[]> {
  const reply = await callTier('balanced', {
    maxTokens: 4096,
    system: systemWithGuide(CROSSEX_SYSTEM_PROMPT, event),
    messages: [{ role: 'user', content: input.text }],
  });
  const qs = parseQuestions(reply.text, input.cards.length);
  if (qs.length === 0) throw parseFail();
  return attachCards(qs, input.cards).slice(0, 6);
}

export async function generateMoreLikeThis(
  seed: CrossExQuestion,
  input: CrossExInput,
  event: DebateEvent,
): Promise<CrossExQuestion[]> {
  const reply = await callTier('balanced', {
    maxTokens: 3072,
    system: systemWithGuide(MORE_LIKE_THIS_SYSTEM_PROMPT, event),
    messages: [
      {
        role: 'user',
        content: `${input.text}\n\nSEED QUESTION: ${seed.question}\n(Seed answer: ${seed.answer})`,
      },
    ],
  });
  const qs = parseQuestions(reply.text, input.cards.length, seed.side);
  if (qs.length === 0) throw parseFail();
  return attachCards(
    qs.filter((q) => q.question !== seed.question).slice(0, 3),
    input.cards,
  );
}

export async function generateTraps(
  input: CrossExInput,
  questions: readonly CrossExQuestion[],
  event: DebateEvent,
): Promise<TrapQuestion[]> {
  const asked = questions.map((q) => `- ${q.question}`).join('\n');
  const reply = await callTier('balanced', {
    maxTokens: 3072,
    system: systemWithGuide(TRAP_SYSTEM_PROMPT, event),
    messages: [
      {
        role: 'user',
        content: `${input.text}\n\nQUESTIONS ALREADY GENERATED (build the traps around the same cards):\n${asked}`,
      },
    ],
  });
  const traps = parseTraps(reply.text);
  if (traps.length === 0) throw parseFail();
  return traps;
}

export async function gradeTrap(
  trap: TrapQuestion,
  answer: string,
): Promise<{ verdict: TrapVerdict; feedback: string }> {
  const reply = await callTier('lite', {
    maxTokens: 800,
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
  });
  const g = parseGrade(reply.text);
  if (!g) throw parseFail();
  return g;
}
