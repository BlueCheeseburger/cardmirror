/**
 * Per-document persistence for the AI panels: Cross-Ex questions and traps,
 * Credibility scores (with the fingerprint they were computed for and the
 * exchanges that produced them) and deeper-analysis conversations. All
 * localStorage, keyed by the doc's id, and every access is wrapped: a blocked
 * or full store just means nothing is remembered.
 */

import type { CrossExQuestion, TrapQuestion } from './crossex.js';
import { normalizeScore, type CredScore, type ScoreBatch } from './credibility.js';

export interface CrossExState {
  questions: CrossExQuestion[];
  traps: TrapQuestion[] | null;
  /** When the questions were generated (ms epoch). */
  at: number;
}

export interface CredState {
  fingerprint: string;
  scores: CredScore[];
  total: number;
  at: number;
  /** The scoring calls behind `scores` (absent on older saves). */
  batches?: ScoreBatch[];
}

/** One message in a deeper-analysis conversation. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** What the conversation shows instead of `content` (the opening question
   *  carries the card text, which is already on screen). */
  display?: string;
}

const K_CROSSEX = 'pmd-ai-crossex:';
const K_CRED = 'pmd-ai-cred:';
const K_CHAT = 'pmd-ai-cred-chat:';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or blocked storage: not remembered */
  }
}

export const loadCrossEx = (docKey: string): CrossExState | null =>
  read<CrossExState>(K_CROSSEX + docKey);
export const saveCrossEx = (docKey: string, s: CrossExState | null): void =>
  write(K_CROSSEX + docKey, s);

export function loadCred(docKey: string): CredState | null {
  const s = read<CredState>(K_CRED + docKey);
  if (!s || !Array.isArray(s.scores)) return null;
  return { ...s, scores: s.scores.map(normalizeScore) };
}
export const saveCred = (docKey: string, s: CredState | null): void => write(K_CRED + docKey, s);

/** Short stable hash of a card's tag, for the conversation key. */
function tagKey(tag: string): string {
  let h = 5381;
  for (let i = 0; i < tag.length; i++) h = ((h << 5) + h + tag.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const loadChat = (docKey: string, tag: string): ChatTurn[] =>
  read<ChatTurn[]>(`${K_CHAT}${docKey}:${tagKey(tag)}`) ?? [];
export const saveChat = (docKey: string, tag: string, turns: ChatTurn[] | null): void =>
  write(`${K_CHAT}${docKey}:${tagKey(tag)}`, turns && turns.length > 0 ? turns : null);
