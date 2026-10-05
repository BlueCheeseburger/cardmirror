/**
 * Card-tagline search (`f c <words>` in Search Everything) — pure logic.
 *
 * `f` searches the files already in the file index; `f c` goes one level
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

/** Taglines of one file, in document order. `tags[i]` is the i-th card tag
 *  of the file (empty string for an untitled tag, so the index doubles as
 *  the card's ordinal); `cites[i]` is that card's cite text ('' if none). */
export interface TaglineRecord {
  tags: string[];
  cites: string[];
}

/** Every card tag in `doc`, in order, with its cite. Analytics are not cards
 *  and are left out. */
export function extractTaglines(doc: PMNode): TaglineRecord {
  const tags: string[] = [];
  const cites: string[] = [];
  for (const entry of collectHeadings(doc)) {
    if (entry.type !== 'tag') continue;
    tags.push(entry.text.trim());
    cites.push((entry.cite ?? '').trim());
  }
  return { tags, cites };
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
