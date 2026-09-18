/**
 * Document diff — the pure core behind "Compare documents" (home screen).
 *
 * Two ProseMirror docs flatten to line lists (`extractDiffLines`), then a
 * classic LCS line diff (`diffLines`) produces the add/remove/equal
 * sequence a unified diff shows, or `toDiffRows` pairs it up for a
 * side-by-side view — the same two ways `git diff` / GitHub render a code
 * diff, applied to a document's text instead of source lines.
 *
 * DOM-free and Electron-free on purpose: `doc-diff-ui.ts` is the only
 * caller that touches the DOM or a file picker, so this module is cheap
 * to unit test directly against hand-built docs.
 */

import type { Node as PMNode } from 'prosemirror-model';

export type DiffLineType = 'equal' | 'add' | 'remove';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/** One side of a paired diff row. `blank` means the other side has a
 *  line here and this side doesn't (an unmatched add or remove). */
export interface DiffCell {
  type: DiffLineType | 'blank';
  text: string;
}

export interface DiffRow {
  left: DiffCell;
  right: DiffCell;
}

/** Top-level card-like containers — a blank line is inserted before each
 *  (after the first) so the flattened transcript keeps a whiff of the
 *  document's own structure, the way blank lines between functions do
 *  in a code diff. */
const CARD_LIKE = new Set(['card', 'analytic_unit']);

/**
 * Flatten a document to one line of plain text per leaf textblock (tag,
 * cite, body, undertag, heading paragraphs — whatever the schema nests
 * text in), in document order. Marks/formatting are dropped: this is a
 * TEXT diff, not a rich-text one. Empty textblocks contribute nothing
 * (no stray blank lines from e.g. an empty pocket).
 */
export function extractDiffLines(doc: PMNode): string[] {
  const lines: string[] = [];
  let sawCard = false;
  doc.descendants((node) => {
    if (CARD_LIKE.has(node.type.name)) {
      if (sawCard) lines.push('');
      sawCard = true;
      return true;
    }
    if (!node.isTextblock) return true; // a container — descend
    const text = node.textContent.trim();
    if (text) lines.push(text);
    return false; // don't re-descend into a textblock's own inline content
  });
  return lines;
}

/**
 * Line diff via the standard LCS dynamic-programming table — O(n·m)
 * time and space, which is fine at the line counts a document's worth
 * of paragraphs produces. Returns the edit sequence in document order:
 * a run of `remove`s immediately followed by a run of `add`s is a
 * "changed" region; either alone is a pure deletion/insertion.
 *
 * The common prefix and suffix are stripped before the DP table is
 * built — always safe for LCS (a shared prefix/suffix is trivially
 * part of it) and, for two versions of what's mostly the SAME
 * document, often collapses the O(n·m) table down to just the
 * differing middle instead of the whole document. What's left after
 * trimming is still capped (`MAX_DIFF_CELLS`): the table is a
 * Uint32Array per remaining line of `a`, and an untrimmed compare of
 * two genuinely huge, wildly different backfiles could otherwise try
 * to allocate hundreds of MB. Throws `DiffTooLargeError` rather than
 * let that allocation happen.
 */
export function diffLines(a: readonly string[], b: readonly string[]): DiffLine[] {
  let start = 0;
  const aLen = a.length;
  const bLen = b.length;
  const minLen = Math.min(aLen, bLen);
  while (start < minLen && a[start] === b[start]) start++;
  let end = 0;
  while (end < minLen - start && a[aLen - 1 - end] === b[bLen - 1 - end]) end++;

  const midA = a.slice(start, aLen - end);
  const midB = b.slice(start, bLen - end);
  if (midA.length * midB.length > MAX_DIFF_CELLS) {
    throw new DiffTooLargeError(midA.length, midB.length);
  }

  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ type: 'equal', text: a[k]! });
  out.push(...diffMiddle(midA, midB));
  for (let k = 0; k < end; k++) out.push({ type: 'equal', text: a[aLen - end + k]! });
  return out;
}

/** Cells (n·m) the LCS table is allowed to reach after prefix/suffix
 *  trimming — generous (comfortably covers thousands of DIFFERING
 *  lines) while keeping the table's peak allocation in the tens of
 *  MB, not hundreds. */
const MAX_DIFF_CELLS = 25_000_000;

export class DiffTooLargeError extends Error {
  constructor(
    readonly linesA: number,
    readonly linesB: number,
  ) {
    super(`These documents differ over too much text to diff (${linesA}×${linesB} differing lines).`);
    this.name = 'DiffTooLargeError';
  }
}

/** The actual LCS dynamic-programming diff, over whatever's left after
 *  `diffLines` trims the shared prefix/suffix. */
function diffMiddle(a: readonly string[], b: readonly string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    const dpI = dp[i]!;
    const dpI1 = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      dpI[j] = a[i] === b[j] ? dpI1[j + 1]! + 1 : Math.max(dpI1[j]!, dpI[j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'equal', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'remove', text: a[i]! });
      i++;
    } else {
      out.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ type: 'remove', text: a[i++]! });
  while (j < m) out.push({ type: 'add', text: b[j++]! });
  return out;
}

/**
 * Pair a diff sequence into side-by-side rows: an `equal` line occupies
 * both columns on one row; a run of consecutive `remove`/`add` lines
 * (a "changed" region) zips removes against adds position-for-position,
 * padding the shorter side with `blank` cells — the same alignment a
 * GitHub-style split diff shows.
 */
export function toDiffRows(lines: readonly DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.type === 'equal') {
      rows.push({ left: { type: 'equal', text: line.text }, right: { type: 'equal', text: line.text } });
      i++;
      continue;
    }
    const removes: string[] = [];
    const adds: string[] = [];
    while (i < lines.length && lines[i]!.type !== 'equal') {
      const l = lines[i]!;
      if (l.type === 'remove') removes.push(l.text);
      else adds.push(l.text);
      i++;
    }
    const max = Math.max(removes.length, adds.length);
    for (let k = 0; k < max; k++) {
      rows.push({
        left: k < removes.length ? { type: 'remove', text: removes[k]! } : { type: 'blank', text: '' },
        right: k < adds.length ? { type: 'add', text: adds[k]! } : { type: 'blank', text: '' },
      });
    }
  }
  return rows;
}

export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
}

export function summarize(lines: readonly DiffLine[]): DiffSummary {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of lines) {
    if (line.type === 'add') added++;
    else if (line.type === 'remove') removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}

/** Convenience: extract + diff two docs in one call. */
export function diffDocs(a: PMNode, b: PMNode): DiffLine[] {
  return diffLines(extractDiffLines(a), extractDiffLines(b));
}
