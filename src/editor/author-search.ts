/**
 * Author search (`e a <name>` in Search Everything) — pure logic.
 *
 * Two lists come back for a name like "stein":
 *   - CARDS BY STEIN: cards whose cite names that author ("Stein 21",
 *     "Stein and Lee 23", "Stein et al. 23").
 *   - RESPONSES TO STEIN: headings in the user's files that name the author
 *     (`AT: Stein`, `Stein is a hack`, `Reject Stein`). They are found by the
 *     wording of the heading, not by understanding it: a heading that also
 *     holds an attack word (hack, biased, funded, reject, AT, …) ranks first
 *     and shows which word matched; a heading that only names the author
 *     comes after, as a plain mention. The author's own cards are never
 *     listed as responses to them.
 *
 * It reads the per-file records the tagline index keeps (`TaglineRecord`:
 * each card's author names, and every heading's level and text), so nothing is
 * parsed per query. DOM-free; shared by the file-index service and the tests.
 */

import type { TaglineFile } from './tagline-search.js';

/** The words that make a heading naming an author read as a response to them.
 *  Editable in Settings; a short all-caps word (AT, A2) is matched as written. */
export const DEFAULT_ATTACK_WORDS: readonly string[] = [
  'AT',
  'A2',
  'answer to',
  'hack',
  'biased',
  'bought',
  'funded',
  'unqualified',
  'no qualifications',
  'reject',
  'ignore',
  'discredit',
  'debunked',
  'retracted',
  'indict',
];

/** The settings string ("AT, A2, hack, …") as a list. */
export function parseAttackWords(setting: string): string[] {
  return setting
    .split(/[,\n;]/u)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Letters only, lowercase, accents dropped (1:1 in length for the common
 *  Latin letters, which is all the matching needs). */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** The author surnames a cite names, folded: "Stein 21" → ["stein"];
 *  "Stein and Lee 23" → ["stein", "lee"]; "Stein et al. 23" → ["stein"];
 *  "O'Brien '19" → ["o'brien"]; "de la Cruz 21" → ["de la cruz"]. A cite with no
 *  year is read whole; an organisation ("Bloomberg News 21") is one author. */
export function authorsFromCite(cite: string): string[] {
  let s = cite.trim();
  if (!s) return [];
  // Everything from the first year-looking number on (21, '21, 2021) is not a name.
  s = s.replace(/[\s,(\[]+['’‘]?\d{2,4}\b.*$/u, '');
  s = s.replace(/\bet\.?\s*al\.?/giu, '');
  const out: string[] = [];
  for (const part of s.split(/\s*(?:,|&|\+|;|\band\b)\s*/iu)) {
    const name = fold(part)
      .replace(/[^\p{L}\p{N}'’\s-]/gu, '')
      .replace(/’/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (name.length >= 2 && !out.includes(name)) out.push(name);
  }
  return out;
}

export interface AuthorQuery {
  /** The name as typed, folded ("de la cruz"). */
  name: string;
  /** Its words. */
  words: string[];
  /** Two-digit year when one was typed ("21" from "stein 21" or "stein 2021"), else null. */
  year: string | null;
}

/** "stein", "stein 21", "de la cruz '19" → name + optional year; null when no name. */
export function parseAuthorQuery(raw: string): AuthorQuery | null {
  const tokens = fold(raw).split(/\s+/u).filter(Boolean);
  let year: string | null = null;
  const last = tokens[tokens.length - 1];
  const m = last?.match(/^['’]?(\d{2}|\d{4})$/u);
  if (m) {
    year = m[1]!.slice(-2);
    tokens.pop();
  }
  const words = tokens.map((t) => t.replace(/[^\p{L}\p{N}'’-]/gu, '').replace(/’/g, "'")).filter(Boolean);
  if (words.length === 0) return null;
  return { name: words.join(' '), words, year };
}

function authorMatches(authors: readonly string[], q: AuthorQuery): boolean {
  for (const a of authors) {
    const have = a.split(' ');
    if (q.words.every((w) => have.includes(w))) return true;
  }
  return false;
}

/** The two-digit year a cite carries, or null. */
function citeYear(cite: string): string | null {
  const m = cite.match(/(?:^|[^\d])['’]?(\d{4}|\d{2})(?!\d)/u);
  return m ? m[1]!.slice(-2) : null;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The attack words found in `text` (as the list spells them). Whole words
 *  only; a short all-caps entry like AT / A2 must match as written, so "look at
 *  him" is not an AT. */
export function attackWordsIn(text: string, words: readonly string[]): string[] {
  const found: string[] = [];
  for (const w of words) {
    const strict = w.length <= 2 && w === w.toUpperCase();
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, strict ? 'u' : 'iu');
    if (re.test(text) && !found.includes(w)) found.push(w);
  }
  return found;
}

/** One row of the answer. `idx` is the card's ordinal among the file's card
 *  tags for a "by" row, or the heading's index among all the file's headings
 *  for a response / mention row. */
export interface AuthorRow {
  path: string;
  relPath: string;
  name: string;
  mtimeMs: number;
  role: 'by' | 'response' | 'mention';
  idx: number;
  /** Outline level of the heading (1 pocket … 3 block, 4 tag / analytic). */
  level: number;
  text: string;
  cite: string;
  /** The attack words the heading holds (responses only). */
  matched: string[];
  /** How many other indexed files hold this same card / heading. */
  alsoIn: number;
}

export interface AuthorResult {
  by: AuthorRow[];
  responses: AuthorRow[];
  mentions: AuthorRow[];
  totalBy: number;
  totalResponses: number;
  totalMentions: number;
}

export function emptyAuthorResult(): AuthorResult {
  return { by: [], responses: [], mentions: [], totalBy: 0, totalResponses: 0, totalMentions: 0 };
}

/** The author's cards and the headings that answer them, over `files`. */
export function searchAuthors(
  files: readonly TaglineFile[],
  rawQuery: string,
  opts: { attackWords: readonly string[]; limit: number },
): AuthorResult {
  const q = parseAuthorQuery(rawQuery);
  if (!q) return emptyAuthorResult();
  const nameRe = new RegExp(
    `(?<![\\p{L}\\p{N}])${q.words.map(escapeRe).join('\\s+')}(?:['’]s|s['’]|['’])?(?![\\p{L}\\p{N}])`,
    'iu',
  );
  const yearAfterName = new RegExp(
    `(?<![\\p{L}\\p{N}])${q.words.map(escapeRe).join('\\s+')}\\s*['’]?(\\d{4}|\\d{2})(?!\\d)`,
    'iu',
  );
  interface Hit {
    file: TaglineFile;
    row: Omit<AuthorRow, 'path' | 'relPath' | 'name' | 'mtimeMs' | 'alsoIn'>;
    also: number;
  }
  const by = new Map<string, Hit>();
  const about = new Map<string, Hit>();

  const keep = (into: Map<string, Hit>, key: string, file: TaglineFile, row: Hit['row']): void => {
    const prev = into.get(key);
    if (!prev) {
      into.set(key, { file, row, also: 0 });
      return;
    }
    prev.also++;
    if (file.mtimeMs > prev.file.mtimeMs) {
      prev.file = file;
      prev.row = row;
    }
  };

  for (const file of files) {
    const rec = file.record;
    const authors = rec.authors;
    const heads = rec.heads;
    if (!authors || !heads) continue; // indexed before author data existed: waits for its re-index
    const own = new Set<number>(); // card ordinals by this author
    for (let i = 0; i < authors.length; i++) {
      if (!authorMatches(authors[i]!, q)) continue;
      if (q.year !== null && citeYear(rec.cites[i] ?? '') !== q.year) continue;
      own.add(i);
      const text = rec.tags[i] ?? '';
      if (text === '') continue;
      keep(by, `${text.toLowerCase()}\u0000${(rec.cites[i] ?? '').toLowerCase()}`, file, {
        role: 'by',
        idx: i,
        level: 4,
        text,
        cite: rec.cites[i] ?? '',
        matched: [],
      });
    }
    for (let h = 0; h < heads.t.length; h++) {
      const text = heads.t[h]!;
      if (text === '' || !nameRe.test(fold(text))) continue;
      const cardOrd = heads.c[h]!;
      if (cardOrd >= 0 && authorMatches(authors[cardOrd] ?? [], q)) continue; // their own card
      if (q.year !== null) {
        const near = fold(text).match(yearAfterName);
        if (near && near[1]!.slice(-2) !== q.year) continue; // a different year of the same surname
      }
      const matched = attackWordsIn(text, opts.attackWords);
      keep(about, `${text.toLowerCase()}\u0000${heads.l[h]}`, file, {
        role: matched.length > 0 ? 'response' : 'mention',
        idx: h,
        level: heads.l[h]!,
        text,
        cite: cardOrd >= 0 ? (rec.cites[cardOrd] ?? '') : '',
        matched,
      });
    }
  }

  const toRow = (h: Hit): AuthorRow => ({
    path: h.file.path,
    relPath: h.file.relPath,
    name: h.file.name,
    mtimeMs: h.file.mtimeMs,
    alsoIn: h.also,
    ...h.row,
  });
  const newest = (a: Hit, b: Hit): number =>
    b.file.mtimeMs - a.file.mtimeMs || a.file.name.localeCompare(b.file.name) || a.row.idx - b.row.idx;
  const byHits = [...by.values()].sort(newest);
  const aboutHits = [...about.values()];
  const responses = aboutHits
    .filter((h) => h.row.role === 'response')
    .sort((a, b) => b.row.matched.length - a.row.matched.length || newest(a, b));
  const mentions = aboutHits.filter((h) => h.row.role === 'mention').sort(newest);
  const cap = Math.max(0, opts.limit);
  return {
    by: byHits.slice(0, cap).map(toRow),
    responses: responses.slice(0, cap).map(toRow),
    mentions: mentions.slice(0, cap).map(toRow),
    totalBy: byHits.length,
    totalResponses: responses.length,
    totalMentions: mentions.length,
  };
}
