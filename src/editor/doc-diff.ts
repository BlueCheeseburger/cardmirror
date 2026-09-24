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

/** A run of one line's text, marked `changed` when a word-level diff
 *  against its paired line found it on only this side. */
export interface DiffSegment {
  text: string;
  changed: boolean;
}

/** One side of a paired diff row. `blank` means the other side has a
 *  line here and this side doesn't (an unmatched add or remove).
 *  `segments` is set only on a remove/add pair similar enough to be one
 *  edited line; joining them gives back `text`. */
export interface DiffCell {
  type: DiffLineType | 'blank';
  text: string;
  segments?: DiffSegment[];
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
 * (a "changed" region) is aligned by `alignRegion` — edited lines face
 * each other with word-level `segments`, everything else zips
 * position-for-position with the shorter side padded by `blank` cells,
 * the same alignment a GitHub-style split diff shows.
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
    rows.push(...alignRegion(removes, adds));
  }
  return rows;
}

/** Word-bag Dice similarity at or above which a removed and an added
 *  line count as one edited line rather than two unrelated ones. */
const PAIR_SIMILARITY = 0.5;
/** A changed region with more remove×add candidate pairs than this is
 *  zipped positionally without word-level pairing — a wholesale rewrite
 *  gains nothing from the search and would pay for every pair. */
const MAX_REGION_PAIRS = 10_000;
/** Token-LCS table cap for one line pair (after prefix/suffix trim);
 *  beyond it the differing middle is marked changed as a whole. */
const MAX_WORD_CELLS = 250_000;

/** Words (letters/digits, with inner apostrophes), single punctuation
 *  marks, and whitespace runs — joining the tokens gives back the line. */
const TOKEN_RE = /\s+|[\p{L}\p{N}_]+(?:['\u2019][\p{L}\p{N}_]+)*|[^\s\p{L}\p{N}_]/gu;

function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

function wordBag(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const tok of tokenize(text)) {
    if (/^\s/.test(tok)) continue;
    const key = tok.toLowerCase();
    bag.set(key, (bag.get(key) ?? 0) + 1);
  }
  return bag;
}

function bagSize(bag: Map<string, number>): number {
  let n = 0;
  for (const c of bag.values()) n += c;
  return n;
}

/** Dice coefficient over the two lines' word multisets, 0..1. */
function similarity(a: Map<string, number>, aSize: number, b: Map<string, number>, bSize: number): number {
  if (aSize === 0 || bSize === 0) return 0;
  let shared = 0;
  for (const [word, count] of a) {
    const other = b.get(word);
    if (other) shared += Math.min(count, other);
  }
  return (2 * shared) / (aSize + bSize);
}

/** Lay out one changed region. Finds the in-order set of remove/add
 *  pairs (each at least `PAIR_SIMILARITY`) with the greatest total
 *  similarity; each pair gets its own row with word-level segments, and
 *  the unpaired lines between pairs zip positionally as before. */
function alignRegion(removes: readonly string[], adds: readonly string[]): DiffRow[] {
  const r = removes.length;
  const a = adds.length;
  if (r === 0 || a === 0 || r * a > MAX_REGION_PAIRS) return zipUnpaired(removes, adds);

  const bagsR = removes.map(wordBag);
  const bagsA = adds.map(wordBag);
  const sizesR = bagsR.map(bagSize);
  const sizesA = bagsA.map(bagSize);
  const sim = new Float64Array(r * a);
  for (let x = 0; x < r; x++) {
    for (let y = 0; y < a; y++) sim[x * a + y] = similarity(bagsR[x]!, sizesR[x]!, bagsA[y]!, sizesA[y]!);
  }

  // best[x][y]: greatest total similarity pairing removes[x..] with adds[y..].
  const w = a + 1;
  const best = new Float64Array((r + 1) * w);
  for (let x = r - 1; x >= 0; x--) {
    for (let y = a - 1; y >= 0; y--) {
      let v = Math.max(best[(x + 1) * w + y]!, best[x * w + y + 1]!);
      const s = sim[x * a + y]!;
      if (s >= PAIR_SIMILARITY) v = Math.max(v, s + best[(x + 1) * w + y + 1]!);
      best[x * w + y] = v;
    }
  }

  const rows: DiffRow[] = [];
  let x = 0;
  let y = 0;
  let fromX = 0;
  let fromY = 0;
  while (x < r && y < a) {
    const s = sim[x * a + y]!;
    if (s >= PAIR_SIMILARITY && best[x * w + y] === s + best[(x + 1) * w + y + 1]!) {
      rows.push(...zipUnpaired(removes.slice(fromX, x), adds.slice(fromY, y)));
      const { left, right } = wordDiff(removes[x]!, adds[y]!);
      rows.push({
        left: { type: 'remove', text: removes[x]!, segments: left },
        right: { type: 'add', text: adds[y]!, segments: right },
      });
      x++;
      y++;
      fromX = x;
      fromY = y;
    } else if (best[x * w + y] === best[(x + 1) * w + y]!) {
      x++;
    } else {
      y++;
    }
  }
  rows.push(...zipUnpaired(removes.slice(fromX), adds.slice(fromY)));
  return rows;
}

function zipUnpaired(removes: readonly string[], adds: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const max = Math.max(removes.length, adds.length);
  for (let k = 0; k < max; k++) {
    rows.push({
      left: k < removes.length ? { type: 'remove', text: removes[k]! } : { type: 'blank', text: '' },
      right: k < adds.length ? { type: 'add', text: adds[k]! } : { type: 'blank', text: '' },
    });
  }
  return rows;
}

/**
 * Word-level diff of one edited line: an LCS over tokens (words,
 * punctuation, whitespace), returning each side's text as runs marked
 * `changed` where the token is only on that side. A space between two
 * changed words is folded into the change so "old words" reads as one
 * highlighted run, not two.
 */
export function wordDiff(a: string, b: string): { left: DiffSegment[]; right: DiffSegment[] } {
  const ta = tokenize(a);
  const tb = tokenize(b);
  let start = 0;
  const minLen = Math.min(ta.length, tb.length);
  while (start < minLen && ta[start] === tb[start]) start++;
  let end = 0;
  while (end < minLen - start && ta[ta.length - 1 - end] === tb[tb.length - 1 - end]) end++;

  const midA = ta.slice(start, ta.length - end);
  const midB = tb.slice(start, tb.length - end);
  const keepA = new Array<boolean>(midA.length).fill(false);
  const keepB = new Array<boolean>(midB.length).fill(false);
  if (midA.length * midB.length <= MAX_WORD_CELLS) {
    const n = midA.length;
    const m = midB.length;
    const dp: Uint32Array[] = new Array(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i]![j] = midA[i] === midB[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        keepA[i++] = true;
        keepB[j++] = true;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        i++;
      } else {
        j++;
      }
    }
  }
  const flagsA = [...new Array<boolean>(start).fill(false), ...keepA.map((k) => !k), ...new Array<boolean>(end).fill(false)];
  const flagsB = [...new Array<boolean>(start).fill(false), ...keepB.map((k) => !k), ...new Array<boolean>(end).fill(false)];
  return { left: toSegments(ta, flagsA), right: toSegments(tb, flagsB) };
}

function toSegments(tokens: readonly string[], changed: boolean[]): DiffSegment[] {
  const isSpace = (k: number): boolean => /^\s+$/.test(tokens[k]!);
  // Whitespace at the edge of a changed run isn't part of the edit.
  for (let k = 0; k < tokens.length; k++) {
    if (changed[k] && isSpace(k) && !(changed[k - 1] && changed[k + 1])) changed[k] = false;
  }
  for (let k = 1; k < tokens.length - 1; k++) {
    if (!changed[k] && changed[k - 1] && changed[k + 1] && isSpace(k)) changed[k] = true;
  }
  const out: DiffSegment[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const last = out[out.length - 1];
    if (last && last.changed === changed[k]) last.text += tokens[k]!;
    else out.push({ text: tokens[k]!, changed: changed[k]! });
  }
  return out;
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
