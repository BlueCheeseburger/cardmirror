/**
 * Which headings are starred in the outline, as a list of heading ids, so a
 * .docx can carry the stars in its metadata (a `docProps/custom.xml` property,
 * the same place the document id lives). A .cmir needs none of this: the
 * `starred` attr is saved with the nodes themselves.
 *
 * The ids ride in one or more string properties (`cmirStarred`, `cmirStarred2`,
 * ...), each kept short because Word's own Properties dialog limits a text
 * value to 255 characters and a long value is not worth risking.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';

export const STARRED_PROP = 'cmirStarred';
/** Longest value written into one property. */
export const STARRED_CHUNK_CHARS = 240;

/** The property name for chunk `i` (0-based): cmirStarred, cmirStarred2, ... */
export function starredPropName(i: number): string {
  return i === 0 ? STARRED_PROP : `${STARRED_PROP}${i + 1}`;
}

/** Heading ids of every starred node, in document order. */
export function collectStarredIds(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.attrs['starred'] === true && typeof node.attrs['id'] === 'string' && node.attrs['id']) {
      out.push(node.attrs['id'] as string);
    }
    return true;
  });
  return out;
}

/** Split ids into comma-joined chunks no longer than STARRED_CHUNK_CHARS (an
 *  id is never split across chunks). */
export function chunkStarredIds(ids: readonly string[]): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const id of ids) {
    if (cur && cur.length + 1 + id.length > STARRED_CHUNK_CHARS) {
      chunks.push(cur);
      cur = id;
    } else {
      cur = cur ? `${cur},${id}` : id;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Ids from the chunk values read back, in order. */
export function parseStarredChunks(chunks: readonly (string | null)[]): string[] {
  const out: string[] = [];
  for (const c of chunks) {
    if (!c) continue;
    for (const id of c.split(',')) if (id.trim()) out.push(id.trim());
  }
  return out;
}

/** The doc with `starred` set on every heading whose id is listed. Ids that no
 *  longer match a heading are ignored. Returns the same doc when nothing
 *  changes. */
export function applyStarredIds(doc: PMNode, ids: Iterable<string>): PMNode {
  const want = new Set(ids);
  if (want.size === 0) return doc;
  const tr = new Transform(doc);
  doc.descendants((node, pos) => {
    const id = node.attrs['id'];
    if (typeof id === 'string' && want.has(id) && 'starred' in node.attrs && node.attrs['starred'] !== true) {
      tr.setNodeAttribute(pos, 'starred', true);
    }
    return true;
  });
  return tr.docChanged ? tr.doc : doc;
}
