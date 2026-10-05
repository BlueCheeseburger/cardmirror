/**
 * Exact steps for a partner's edits.
 *
 * The binding renders a remote batch by materializing the new document from
 * Loro and replacing ONE span of the old document: first difference to last.
 * That is exact for a single keystroke and wrong for everything else. A batch
 * holding an edit in card 1 and an edit in card 9 reports cards 1–9 replaced,
 * so every position in between (a caret, a comment anchor, a drag in
 * progress, an undo step) is told its content was deleted. And a document
 * comparison cannot tell WHICH of two equal characters went: deleting
 * " SECOND" from "one SECOND two" is rendered as deleting "SECOND ".
 *
 * This builds the transaction from what actually changed instead:
 *
 *   - Children are aligned by Loro container identity, so an untouched
 *     sibling is never part of a step, however many of its neighbours moved,
 *     appeared or vanished. A node present on both sides is descended into;
 *     only what differs inside it is touched.
 *   - Inside a text block, Loro's own text delta from the event says exactly
 *     which characters were inserted and deleted. Each becomes its own
 *     replace at the exact offset.
 *   - A change of marks or of node attributes is a mark / markup step, which
 *     moves no positions at all.
 *
 * It is a decomposition of the same result, never a different one: the
 * transaction's document is compared against the materialized one, and on
 * any mismatch (or any step the schema refuses) the builder returns null and
 * the binding falls back to its bounded replace. Correctness never depends
 * on this file; precision does.
 *
 * Installed as `globalThis.__CM_REMOTE_STEPS__`, which the patched binding
 * calls from its remote render (the same seam style as `__CM_MOVABLE_LIST__`).
 */

import { Fragment, Mark, Slice, type Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { LoroMap, LoroText, type ContainerID, type LoroDoc, type LoroEventBatch } from 'loro-crdt';

/** One Loro text delta op (retain / insert / delete, UTF-16 units). */
interface TextDeltaOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

export interface RemoteStepInput {
  /** A new transaction on the current (old) document, each call. Steps
   *  cannot be taken back, so every attempt starts from its own. */
  fresh: () => Transaction;
  /** The document Loro now materializes to. */
  next: PMNode;
  /** Loro container id of a node the binding has synced or rendered. */
  keyOf: (node: PMNode) => ContainerID | undefined;
  doc: LoroDoc;
  event: LoroEventBatch;
}

/** Counters for tests and field diagnostics. `exact` = a render built
 *  entirely from aligned steps; `fallback` = handed back to the binding's
 *  bounded replace; `deltaBlocks` / `diffBlocks` = text blocks patched from
 *  Loro's delta vs from a text comparison. */
export const remoteStepStats = { exact: 0, fallback: 0, deltaBlocks: 0, diffBlocks: 0 };

interface Ctx {
  tr: Transaction;
  keyOf: (node: PMNode) => ContainerID | undefined;
  /** Text delta for a text block's container id, when the block is one
   *  Loro text whose list of children this batch did not touch. */
  deltaFor: (blockKey: ContainerID) => TextDeltaOp[] | null;
  /** Second attempt: ignore Loro's deltas, compare text instead. */
  noDelta: boolean;
}

const CHILDREN_KEY = 'children';

function makeDeltaLookup(doc: LoroDoc, event: LoroEventBatch): Ctx['deltaFor'] {
  const textDiffs = new Map<ContainerID, TextDeltaOp[]>();
  const touchedLists = new Set<ContainerID>();
  for (const e of event.events) {
    if (e.diff.type === 'text') textDiffs.set(e.target, e.diff.diff as TextDeltaOp[]);
    else if (e.diff.type === 'list') touchedLists.add(e.target);
  }
  return (blockKey) => {
    if (textDiffs.size === 0) return null;
    try {
      const obj = doc.getContainerById(blockKey);
      if (!(obj instanceof LoroMap)) return null;
      const children = obj.get(CHILDREN_KEY) as { id?: ContainerID; length?: number; get?: (i: number) => unknown } | undefined;
      if (!children || typeof children.get !== 'function' || children.length !== 1) return null;
      if (children.id && touchedLists.has(children.id)) return null;
      const only = children.get(0);
      if (!(only instanceof LoroText)) return null;
      return textDiffs.get(only.id) ?? null;
    } catch {
      return null;
    }
  };
}

/** The remote batch as exact steps. Returns the transaction, or null when
 *  the result could not be reproduced exactly (the caller falls back). */
export function buildRemoteSteps(input: RemoteStepInput): Transaction | null {
  const first = input.fresh();
  const prev = first.doc;
  if (prev.content.eq(input.next.content)) return first;
  // Root markup (doc attrs) has no step this builder emits.
  if (!prev.sameMarkup(input.next)) return fallback();
  const deltaFor = makeDeltaLookup(input.doc, input.event);
  // First with Loro's text deltas; if that does not reproduce the document
  // (a block out of step with Loro), again comparing text instead.
  for (const noDelta of [false, true]) {
    const tr = noDelta ? input.fresh() : first;
    const saved = { ...remoteStepStats };
    try {
      patchChildren({ tr, keyOf: input.keyOf, deltaFor, noDelta }, prev, input.next, 0);
      if (tr.doc.content.eq(input.next.content)) {
        remoteStepStats.exact++;
        return tr;
      }
    } catch {
      /* a step the schema refused — try the next strategy */
    }
    Object.assign(remoteStepStats, saved);
  }
  return fallback();
}

function fallback(): null {
  remoteStepStats.fallback++;
  return null;
}

// ── Block-level children ───────────────────────────────────────────────

/** Patch `oldParent`'s children into `newParent`'s. `start` is the position
 *  of the first child. Works RIGHT TO LEFT, applying as it goes: everything
 *  left of the step being applied is still the old document, so old
 *  positions stay valid with no remapping. */
function patchChildren(ctx: Ctx, oldParent: PMNode, newParent: PMNode, start: number): void {
  const oldKids: PMNode[] = [];
  const newKids: PMNode[] = [];
  oldParent.forEach((n) => oldKids.push(n));
  newParent.forEach((n) => newKids.push(n));

  // Common prefix / suffix of UNCHANGED children: the usual case is one
  // changed child in thousands, and identity makes this a pointer walk.
  let lo = 0;
  const maxLo = Math.min(oldKids.length, newKids.length);
  while (lo < maxLo && oldKids[lo] === newKids[lo]) lo++;
  let oldHi = oldKids.length;
  let newHi = newKids.length;
  while (oldHi > lo && newHi > lo && oldKids[oldHi - 1] === newKids[newHi - 1]) {
    oldHi--;
    newHi--;
  }
  if (lo === oldHi && lo === newHi) return;

  // Anchors: pairs (old index, new index) of the same container, in an
  // order both sides agree on. Keys are unique among siblings, so a common
  // subsequence is an increasing subsequence of new indices.
  const newIndexOf = new Map<ContainerID, number>();
  for (let j = lo; j < newHi; j++) {
    const k = ctx.keyOf(newKids[j]!);
    if (k !== undefined) newIndexOf.set(k, j);
  }
  const candOld: number[] = [];
  const candNew: number[] = [];
  const seen = new Set<number>();
  for (let i = lo; i < oldHi; i++) {
    const k = ctx.keyOf(oldKids[i]!);
    if (k === undefined) continue;
    const j = newIndexOf.get(k);
    // A duplicated key on the old side would pair one new child twice.
    if (j === undefined || seen.has(j)) continue;
    seen.add(j);
    candOld.push(i);
    candNew.push(j);
  }
  const keep = heaviestIncreasing(
    candNew,
    candOld.map((i) => oldKids[i]!.nodeSize),
    newKids.length,
  );
  const anchors: Array<[number, number]> = keep.map((c) => [candOld[c]!, candNew[c]!]);

  // Offsets of the old children, so a run's position is a lookup.
  const oldPos: number[] = new Array(oldKids.length + 1);
  let p = start;
  for (let i = 0; i < oldKids.length; i++) {
    oldPos[i] = p;
    p += oldKids[i]!.nodeSize;
  }
  oldPos[oldKids.length] = p;

  // Right to left: the run after the last anchor, the anchor, the run
  // before it, ...
  let oEnd = oldHi;
  let nEnd = newHi;
  for (let a = anchors.length - 1; a >= -1; a--) {
    const oAnchor = a >= 0 ? anchors[a]![0] : lo - 1;
    const nAnchor = a >= 0 ? anchors[a]![1] : lo - 1;
    replaceRun(ctx, oldPos[oAnchor + 1]!, oldPos[oEnd]!, newKids.slice(nAnchor + 1, nEnd));
    if (a >= 0) patchNode(ctx, oldKids[oAnchor]!, newKids[nAnchor]!, oldPos[oAnchor]!);
    oEnd = oAnchor;
    nEnd = nAnchor;
  }
}

/** Replace the old run `[from, to)` of whole children with `nodes`. */
function replaceRun(ctx: Ctx, from: number, to: number, nodes: PMNode[]): void {
  if (from === to && nodes.length === 0) return;
  ctx.tr.replace(from, to, new Slice(Fragment.fromArray(nodes), 0, 0));
}

/** Patch one node that exists on both sides. `pos` is the node's position. */
function patchNode(ctx: Ctx, o: PMNode, n: PMNode, pos: number): void {
  if (o === n || o.eq(n)) return;
  const sameShape = o.isTextblock === n.isTextblock && o.isLeaf === n.isLeaf && !o.isText && !n.isText;
  if (!sameShape || o.isLeaf) {
    ctx.tr.replaceWith(pos, pos + o.nodeSize, n);
    return;
  }
  if (o.isTextblock) patchInline(ctx, o, n, pos);
  else patchChildren(ctx, o, n, pos + 1);
  // After the content: the new type may only admit the new children.
  if (!o.sameMarkup(n)) ctx.tr.setNodeMarkup(pos, n.type, n.attrs, n.marks);
}

/** Indices of the HEAVIEST strictly increasing subsequence of `xs` (`xs`
 *  distinct, each < `bound`). When siblings changed order, some of them must
 *  be rendered as removed-and-reinserted; weighting by size keeps the most
 *  document — the most positions — in place. O(k log k) with a prefix-max
 *  tree, since k is the whole sibling list when a card crosses a long file. */
function heaviestIncreasing(xs: number[], weights: number[], bound: number): number[] {
  const best = new Float64Array(bound + 1); // tree over values: best weight
  const bestAt = new Int32Array(bound + 1).fill(-1); // ...and which index holds it
  const prev = new Int32Array(xs.length).fill(-1);
  let top = -1;
  let topWeight = -1;
  for (let i = 0; i < xs.length; i++) {
    // Best chain ending on a value below xs[i].
    let w = 0;
    let from = -1;
    for (let t = xs[i]!; t > 0; t -= t & -t) {
      if (best[t]! > w) {
        w = best[t]!;
        from = bestAt[t]!;
      }
    }
    w += weights[i]!;
    prev[i] = from;
    for (let t = xs[i]! + 1; t <= bound; t += t & -t) {
      if (best[t]! < w) {
        best[t] = w;
        bestAt[t] = i;
      }
    }
    if (w > topWeight) {
      topWeight = w;
      top = i;
    }
  }
  const out: number[] = [];
  for (let i = top; i >= 0; i = prev[i]!) out.push(i);
  return out.reverse();
}

// ── Inline content ─────────────────────────────────────────────────────

function allText(node: PMNode): boolean {
  let ok = true;
  node.forEach((c) => {
    if (!c.isText) ok = false;
  });
  return ok;
}

interface TextEdit {
  /** Offset in the old text. */
  at: number;
  del: number;
  /** Offset in the new text of what is inserted. */
  insAt: number;
  ins: number;
}

/** Loro's delta as edits, or null when it does not take the old text to the
 *  new one (the block was not in step with Loro; compare text instead). */
function editsFromDelta(delta: TextDeltaOp[], oldText: string, newText: string): TextEdit[] | null {
  const edits: TextEdit[] = [];
  let o = 0;
  let n = 0;
  let cur: TextEdit | null = null;
  let built = '';
  for (const op of delta) {
    if (op.retain != null) {
      built += oldText.slice(o, o + op.retain);
      o += op.retain;
      n += op.retain;
      cur = null;
    } else if (op.insert != null) {
      const len = op.insert.length;
      if (cur && cur.at + cur.del === o) cur.ins += len;
      else edits.push((cur = { at: o, del: 0, insAt: n, ins: len }));
      built += op.insert;
      n += len;
    } else if (op.delete != null) {
      if (cur && cur.at + cur.del === o) cur.del += op.delete;
      else edits.push((cur = { at: o, del: op.delete, insAt: n, ins: 0 }));
      o += op.delete;
    }
  }
  if (o > oldText.length) return null;
  built += oldText.slice(o);
  return built === newText ? edits : null;
}

/** One edit from a text comparison: the differing middle. Used when there
 *  is no usable delta; ambiguous between equal characters, but bounded to
 *  this one block. */
function editsFromCompare(oldText: string, newText: string): TextEdit[] {
  if (oldText === newText) return [];
  const max = Math.min(oldText.length, newText.length);
  let pre = 0;
  while (pre < max && oldText.charCodeAt(pre) === newText.charCodeAt(pre)) pre++;
  let suf = 0;
  while (
    suf < max - pre &&
    oldText.charCodeAt(oldText.length - 1 - suf) === newText.charCodeAt(newText.length - 1 - suf)
  )
    suf++;
  return [{ at: pre, del: oldText.length - pre - suf, insAt: pre, ins: newText.length - pre - suf }];
}

/** Patch a text block's inline content. `pos` is the block's position. */
function patchInline(ctx: Ctx, o: PMNode, n: PMNode, pos: number): void {
  const start = pos + 1;
  const { tr } = ctx;
  if (!allText(o) || !allText(n)) {
    // Inline atoms in play: one bounded replace inside this block.
    if (!o.content.eq(n.content)) replaceDiffering(tr, o.content, n.content, start);
    return;
  }
  const oldText = o.textContent;
  const newText = n.textContent;
  let edits: TextEdit[] | null = null;
  if (!ctx.noDelta) {
    const key = ctx.keyOf(n) ?? ctx.keyOf(o);
    const delta = key !== undefined ? ctx.deltaFor(key) : null;
    if (delta) edits = editsFromDelta(delta, oldText, newText);
    if (edits) remoteStepStats.deltaBlocks++;
  }
  if (!edits) {
    edits = editsFromCompare(oldText, newText);
    if (edits.length > 0) remoteStepStats.diffBlocks++;
  }
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i]!;
    if (e.del === 0 && e.ins === 0) continue;
    tr.replace(start + e.at, start + e.at + e.del, n.slice(e.insAt, e.insAt + e.ins));
  }
  reconcileMarks(tr, pos, n);
}

/** Bring the marks of the block at `pos` (text already equal) to `n`'s,
 *  with mark steps — which move no positions. */
function reconcileMarks(tr: Transaction, pos: number, n: PMNode): void {
  const cur = tr.doc.nodeAt(pos);
  if (!cur || cur.content.eq(n.content)) return;
  if (cur.textContent !== n.textContent) return; // the final check will reject it
  const start = pos + 1;
  // Segment boundaries of both sides.
  const cuts = new Set<number>([0, cur.content.size]);
  let off = 0;
  cur.forEach((c) => cuts.add((off += c.nodeSize)));
  off = 0;
  n.forEach((c) => cuts.add((off += c.nodeSize)));
  const marksAt = (node: PMNode, at: number): readonly Mark[] => node.resolve(at).nodeAfter?.marks ?? Mark.none;
  const sorted = [...cuts].sort((a, b) => a - b);
  // Collect first (reading `cur`), then apply: mark steps keep offsets.
  const ops: Array<{ from: number; to: number; remove: Mark[]; add: Mark[] }> = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const was = marksAt(cur, a);
    const want = marksAt(n, a);
    if (Mark.sameSet(was, want)) continue;
    ops.push({
      from: start + a,
      to: start + b,
      remove: was.filter((m) => !want.some((w) => w.eq(m))),
      add: want.filter((w) => !was.some((m) => m.eq(w))),
    });
  }
  for (const op of ops) {
    for (const m of op.remove) tr.removeMark(op.from, op.to, m);
    for (const m of op.add) tr.addMark(op.from, op.to, m);
  }
  // Mark ORDER within a set is schema rank, so equal sets are equal nodes;
  // anything left over (an excluded mark the add dropped) fails the final
  // document comparison and the render falls back.
}

/** One replace over the differing span of two fragments at `start`. */
function replaceDiffering(tr: Transaction, a: Fragment, b: Fragment, start: number): void {
  const from = a.findDiffStart(b);
  if (from == null) return;
  let { a: endA, b: endB } = a.findDiffEnd(b)!;
  const overlap = from - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  tr.replace(start + from, start + endA, new Slice(b.cut(from, endB), 0, 0));
}

// ── Seam ───────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __CM_REMOTE_STEPS__: ((input: RemoteStepInput) => Transaction | null) | undefined;
}

/** Hand the builder to the binding. Idempotent. */
export function installRemoteStepBuilder(): void {
  globalThis.__CM_REMOTE_STEPS__ = buildRemoteSteps;
}
