/**
 * Document diff — the pure core behind "Compare documents" (home screen).
 *
 * Two ProseMirror docs flatten to line lists (`extractDiffLines`), then a
 * Myers line diff (`diffLines`) produces the add/remove/equal
 * sequence a unified diff shows, or `toDiffRows` pairs it up for a
 * side-by-side view — the same two ways `git diff` / GitHub render a code
 * diff, applied to a document's text instead of source lines.
 *
 * DOM-free and Electron-free on purpose: `doc-diff-ui.ts` is the only
 * caller that touches the DOM or a file picker, so this module is cheap
 * to unit test directly against hand-built docs.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { collectHeadings } from './headings.js';

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
 * Line diff, Myers' O(ND) algorithm in its linear-space form (the middle
 * snake, then recurse on each half). Time grows with N times D, the number
 * of differing lines, and memory with N alone, so two big documents compare
 * without a size limit: two versions of one document are near-instant and
 * even two unrelated ones finish in a few seconds. Returns the edit
 * sequence in document order: within a stretch between matched lines, the
 * `remove`s come first and the `add`s after, which is the "changed" region
 * `toDiffRows` pairs up.
 *
 * Lines are first mapped to integer ids, the shared prefix and suffix are
 * trimmed, and lines that occur on only one side are set aside (they can't
 * be part of any common subsequence), so the search runs on far fewer lines
 * than the documents have.
 */
export function diffLines(a: readonly string[], b: readonly string[]): DiffLine[] {
  const aLen = a.length;
  const bLen = b.length;
  let start = 0;
  const minLen = Math.min(aLen, bLen);
  while (start < minLen && a[start] === b[start]) start++;
  let end = 0;
  while (end < minLen - start && a[aLen - 1 - end] === b[bLen - 1 - end]) end++;

  const midA = a.slice(start, aLen - end);
  const midB = b.slice(start, bLen - end);

  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ type: 'equal', text: a[k]! });
  diffMiddle(midA, midB, out);
  for (let k = 0; k < end; k++) out.push({ type: 'equal', text: a[aLen - end + k]! });
  return out;
}

/** Diff what's left after `diffLines` trims the shared prefix/suffix:
 *  find the matched line pairs, then emit removes/adds around them. */
function diffMiddle(a: readonly string[], b: readonly string[], out: DiffLine[]): void {
  const ids = new Map<string, number>();
  const idOf = (text: string): number => {
    let id = ids.get(text);
    if (id === undefined) {
      id = ids.size;
      ids.set(text, id);
    }
    return id;
  };
  const idsA = Int32Array.from(a, idOf);
  const idsB = Int32Array.from(b, idOf);

  // Only lines present on both sides can match; search over those alone.
  const inA = new Uint8Array(ids.size);
  const inB = new Uint8Array(ids.size);
  for (const id of idsA) inA[id] = 1;
  for (const id of idsB) inB[id] = 1;
  const keepA: number[] = [];
  const keepB: number[] = [];
  for (let i = 0; i < idsA.length; i++) if (inB[idsA[i]!]) keepA.push(i);
  for (let j = 0; j < idsB.length; j++) if (inA[idsB[j]!]) keepB.push(j);

  const fa = Int32Array.from(keepA, (i) => idsA[i]!);
  const fb = Int32Array.from(keepB, (j) => idsB[j]!);
  const matchA: number[] = [];
  const matchB: number[] = [];
  myersMatches(fa, fb, matchA, matchB);

  let i = 0;
  let j = 0;
  const flush = (toI: number, toJ: number) => {
    while (i < toI) out.push({ type: 'remove', text: a[i++]! });
    while (j < toJ) out.push({ type: 'add', text: b[j++]! });
  };
  for (let m = 0; m < matchA.length; m++) {
    const mi = keepA[matchA[m]!]!;
    const mj = keepB[matchB[m]!]!;
    flush(mi, mj);
    out.push({ type: 'equal', text: a[i]! });
    i++;
    j++;
  }
  flush(a.length, b.length);
}

/** Append to `matchA`/`matchB` the index pairs of one longest common
 *  subsequence of `a` and `b`, in order. */
function myersMatches(a: Int32Array, b: Int32Array, matchA: number[], matchB: number[]): void {
  if (a.length === 0 || b.length === 0) return;
  const size = a.length + b.length + 3;
  const vf = new Int32Array(size);
  const vb = new Int32Array(size);
  const off = (size - 1) >> 1;

  const solve = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    let suffix = 0;
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
      matchA.push(aLo++);
      matchB.push(bLo++);
    }
    while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
      aHi--;
      bHi--;
      suffix++;
    }
    if (aLo < aHi && bLo < bHi) {
      const n = aHi - aLo;
      const m = bHi - bLo;
      const [x, y, u, v] = middleSnake(aLo, n, bLo, m);
      solve(aLo, aLo + x, bLo, bLo + y);
      for (let t = 0; t < u - x; t++) {
        matchA.push(aLo + x + t);
        matchB.push(bLo + y + t);
      }
      solve(aLo + u, aHi, bLo + v, bHi);
    }
    for (let t = 0; t < suffix; t++) {
      matchA.push(aHi + t);
      matchB.push(bHi + t);
    }
  };

  /** Myers' middle snake for a[aLo..aLo+n) vs b[bLo..bLo+m): walks forward
   *  and backward edit paths until they meet, returning the snake's start
   *  and end as offsets from (aLo, bLo). */
  const middleSnake = (aLo: number, n: number, bLo: number, m: number): [number, number, number, number] => {
    const delta = n - m;
    const odd = (delta & 1) !== 0;
    const maxD = (n + m + 1) >> 1;
    vf[off + 1] = 0;
    vb[off + 1] = 0;
    for (let d = 0; d <= maxD; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && vf[off + k - 1]! < vf[off + k + 1]!) ? vf[off + k + 1]! : vf[off + k - 1]! + 1;
        let y = x - k;
        const sx = x;
        const sy = y;
        while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
          x++;
          y++;
        }
        vf[off + k] = x;
        const kr = delta - k;
        if (odd && kr >= -(d - 1) && kr <= d - 1 && x + vb[off + kr]! >= n) return [sx, sy, x, y];
      }
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && vb[off + k - 1]! < vb[off + k + 1]!) ? vb[off + k + 1]! : vb[off + k - 1]! + 1;
        let y = x - k;
        const sx = x;
        const sy = y;
        while (x < n && y < m && a[aLo + n - 1 - x] === b[bLo + m - 1 - y]) {
          x++;
          y++;
        }
        vb[off + k] = x;
        const kf = delta - k;
        if (!odd && kf >= -d && kf <= d && x + vf[off + kf]! >= n) return [n - x, m - y, n - sx, m - sy];
      }
    }
    // Unreachable: the paths always meet by maxD.
    return [0, 0, 0, 0];
  };

  solve(0, a.length, 0, b.length);
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


/** How one line (or a whole outline section) differs on its own side.
 *  `partial` is "some of it": an edited line that shares words with its
 *  pair, or a section holding both changed and unchanged lines. */
export type LineMark = 'equal' | 'add' | 'remove' | 'partial';
export type OutlineDiff = 'add' | 'remove' | 'partial';

/** The mark for one side of a diff row; null for the blank filler cell. */
export function cellMark(cell: DiffCell): LineMark | null {
  if (cell.type === 'blank') return null;
  if (cell.type === 'equal') return 'equal';
  const segs = cell.segments;
  if (segs && segs.some((s) => s.changed) && segs.some((s) => !s.changed && s.text.trim() !== '')) {
    return 'partial';
  }
  return cell.type;
}

/**
 * Colour for each outline (navigation panel) entry of one side's document:
 * `add` (the whole section is new), `remove` (the whole section is gone),
 * `partial` (part of it differs, part doesn't), absent (identical). A
 * heading's section runs to the next heading of the same or a higher level,
 * so a block whose cards were edited reads `partial` even when its own title
 * is unchanged. `marksByText` holds, per trimmed line text, the mark of each
 * occurrence in document order (a repeated line is told apart by its place).
 * Keyed by the heading's document position, which is what the panel's rows
 * carry as `data-pos`.
 */
export function outlineDiffStatuses(
  doc: PMNode,
  marksByText: ReadonlyMap<string, readonly LineMark[]>,
): Map<number, OutlineDiff> {
  const lines: { pos: number; mark: LineMark }[] = [];
  const seen = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent.trim();
    if (text !== '') {
      const occurrence = seen.get(text) ?? 0;
      seen.set(text, occurrence + 1);
      lines.push({ pos, mark: marksByText.get(text)?.[occurrence] ?? 'equal' });
    }
    return false;
  });
  const entries = collectHeadings(doc, { skipCite: true });
  const out = new Map<number, OutlineDiff>();
  entries.forEach((entry, i) => {
    let end = doc.content.size;
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j]!.level <= entry.level) {
        end = entries[j]!.pos;
        break;
      }
    }
    let status: OutlineDiff | 'equal' | null = null;
    for (const line of lines) {
      if (line.pos < entry.pos || line.pos >= end) continue;
      if (status === null) status = line.mark;
      else if (status !== line.mark) status = 'partial';
      if (status === 'partial') break;
    }
    if (status && status !== 'equal') out.set(entry.pos, status);
  });
  return out;
}
