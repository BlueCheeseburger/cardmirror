/**
 * Card-tagline search (`q` my cards in Search Everything) — pure logic.
 *
 * `f` searches the files already in the file index; `q` goes one level
 * down and searches the taglines of the cards INSIDE those files. The
 * desktop's file-index service keeps a persisted per-file list of taglines
 * (built in the background, refreshed when a file's mtime changes); this
 * module is the shared part: pulling taglines out of a parsed doc, and
 * ranking them against a query with the same matcher the rest of the
 * palette uses.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { collectHeadings } from './headings.js';
import { matchTier, tokenizeQuery } from './file-search.js';
import { authorsFromCite } from './author-search.js';

/** Taglines of one file, in document order. `tags[i]` is the i-th card tag
 *  of the file (empty string for an untitled tag, so the index doubles as
 *  the card's ordinal); `cites[i]` is that card's cite text ('' if none). */
export interface TaglineRecord {
  tags: string[];
  cites: string[];
  /** Author surnames of each card (`authorsFromCite`), index-aligned with `tags`.
   *  Absent in a record indexed before author search existed. */
  authors?: string[][];
  /** Every heading in the file, in outline order (pocket, hat, block, tag and
   *  analytic): its level, its text, and the ordinal of the card it heads
   *  (-1 when it heads no card). Index-aligned arrays, to keep the stored file small. */
  heads?: { l: number[]; t: string[]; c: number[] };
}

/** Every card tag in `doc`, in order, with its cite. Analytics are not cards
 *  and are left out. */
export function extractTaglines(doc: PMNode): TaglineRecord {
  const tags: string[] = [];
  const cites: string[] = [];
  const authors: string[][] = [];
  const heads = { l: [] as number[], t: [] as string[], c: [] as number[] };
  for (const entry of collectHeadings(doc)) {
    const text = entry.text.trim();
    let cardOrd = -1;
    if (entry.type === 'tag') {
      cardOrd = tags.length;
      tags.push(text);
      cites.push((entry.cite ?? '').trim());
      authors.push(authorsFromCite(entry.cite ?? ''));
    }
    heads.l.push(entry.level);
    heads.t.push(text.slice(0, MAX_HEAD_CHARS));
    heads.c.push(cardOrd);
  }
  return { tags, cites, authors, heads };
}

/** A heading's text is kept to this many characters in the index. */
export const MAX_HEAD_CHARS = 240;

/** The `index`-th heading of `doc` (outline order, the same order the index
 *  stored), with the entry the caller needs to compute its range. Falls back to
 *  the first heading with the same text when the file changed since it was
 *  indexed. Null when the heading is gone. */
export function findHeadingEntry(
  doc: PMNode,
  index: number,
  text: string,
): ReturnType<typeof collectHeadings>[number] | null {
  const entries = collectHeadings(doc);
  const same = (e: { text: string }): boolean => e.text.trim().slice(0, MAX_HEAD_CHARS) === text;
  const at = entries[index];
  if (at && same(at)) return at;
  return entries.find(same) ?? null;
}

/** One indexed file as the search sees it. `lower`/`citeLower` are filled
 *  lazily on first search and kept, so a keystroke doesn't re-lowercase the
 *  whole corpus. */
export interface TaglineFile {
  path: string;
  relPath: string;
  name: string;
  mtimeMs: number;
  record: TaglineRecord;
  lower?: string[];
  citeLower?: string[];
}

export interface TaglineRow {
  path: string;
  relPath: string;
  name: string;
  mtimeMs: number;
  /** Which card in the file (0-based, document order among card tags). */
  ord: number;
  text: string;
  cite: string;
  /** How many OTHER indexed files hold this same tagline and cite. */
  alsoIn: number;
}

export interface TaglineSearchResult {
  rows: TaglineRow[];
  total: number;
}

/** Rank `files`' taglines against `query` — order-independent multi-word AND
 *  match on the tagline, with the card's cite as the weaker second field.
 *  Identical taglines across files (a card copied between camp files) show
 *  once, from the newest file, with a count of the rest. An empty query
 *  returns nothing: there is no "browse everything" view for taglines. */
export function searchTaglines(
  files: readonly TaglineFile[],
  query: string,
  limit: number,
): TaglineSearchResult {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return { rows: [], total: 0 };
  const q = tokens.join(' ');
  const t0 = tokens[0]!;
  interface Hit {
    file: TaglineFile;
    ord: number;
    tier: number;
    key: string;
    also: number;
  }
  const best = new Map<string, Hit>();
  for (const file of files) {
    const rec = file.record;
    const lower = (file.lower ??= rec.tags.map((t) => t.toLowerCase()));
    const citeLower = (file.citeLower ??= rec.cites.map((c) => c.toLowerCase()));
    for (let i = 0; i < lower.length; i++) {
      const text = lower[i]!;
      if (text === '') continue;
      const tier = matchTier(text, citeLower[i]!, tokens, q, t0);
      if (tier === null) continue;
      const key = `${text}\u0000${citeLower[i]}`;
      const prev = best.get(key);
      if (!prev) {
        best.set(key, { file, ord: i, tier, key, also: 0 });
      } else {
        prev.also++;
        if (file.mtimeMs > prev.file.mtimeMs) {
          prev.file = file;
          prev.ord = i;
        }
      }
    }
  }
  const hits = [...best.values()].sort(
    (a, b) =>
      a.tier - b.tier ||
      b.file.mtimeMs - a.file.mtimeMs ||
      a.file.name.localeCompare(b.file.name) ||
      a.ord - b.ord,
  );
  const rows = hits.slice(0, Math.max(0, limit)).map(
    (h): TaglineRow => ({
      path: h.file.path,
      relPath: h.file.relPath,
      name: h.file.name,
      mtimeMs: h.file.mtimeMs,
      ord: h.ord,
      text: h.file.record.tags[h.ord]!,
      cite: h.file.record.cites[h.ord]!,
      alsoIn: h.also,
    }),
  );
  return { rows, total: hits.length };
}

/** The `ord`-th card tag of `doc`, with the heading entry the caller needs to
 *  compute the card's range. Falls back to the first tag with the same text
 *  when the file changed since it was indexed and the ordinal no longer lines
 *  up. Null when the tagline is gone from the file. */
export function findTaglineEntry(
  doc: PMNode,
  ord: number,
  text: string,
): ReturnType<typeof collectHeadings>[number] | null {
  const tags = collectHeadings(doc).filter((e) => e.type === 'tag');
  const at = tags[ord];
  if (at && at.text.trim() === text) return at;
  return tags.find((e) => e.text.trim() === text) ?? null;
}
