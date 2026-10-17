/**
 * Per-document persistence for the AI panels: Cross-Ex questions and traps,
 * Credibility scores (with the fingerprint they were computed for) and
 * dismissed highlight warnings. All localStorage, keyed by the doc's id, and
 * every access is wrapped: a blocked or full store just means nothing is
 * remembered.
 */

import type { CrossExQuestion, DebateEvent, TrapQuestion } from './crossex.js';
import type { CredScore } from './credibility.js';

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
}

const K_CROSSEX = 'pmd-ai-crossex:';
const K_CRED = 'pmd-ai-cred:';
const K_DISMISS = 'pmd-ai-hl-dismiss:';
const K_EVENT = 'pmd-ai-event';

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

export const loadCred = (docKey: string): CredState | null => read<CredState>(K_CRED + docKey);
export const saveCred = (docKey: string, s: CredState | null): void => write(K_CRED + docKey, s);

export function dismissedWarnings(docKey: string): Set<string> {
  return new Set(read<string[]>(K_DISMISS + docKey) ?? []);
}

export function dismissWarning(docKey: string, tag: string): void {
  const set = dismissedWarnings(docKey);
  set.add(tag);
  write(K_DISMISS + docKey, [...set]);
  try {
    window.dispatchEvent(new CustomEvent('pmd-ai-hl-dismiss'));
  } catch {
    /* non-DOM host */
  }
}

export function loadEvent(): DebateEvent {
  try {
    const v = localStorage.getItem(K_EVENT);
    if (v === 'policy' || v === 'ld' || v === 'pf') return v;
  } catch {
    /* default below */
  }
  return 'policy';
}

export function saveEvent(e: DebateEvent): void {
  try {
    localStorage.setItem(K_EVENT, e);
  } catch {
    /* ignore */
  }
}
