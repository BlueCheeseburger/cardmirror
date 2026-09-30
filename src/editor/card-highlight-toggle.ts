/**
 * Unhighlight Card / Rehighlight Card.
 *
 * Unhighlight strips every `highlight` mark from a card (or from a whole
 * outline section) in one undoable step and remembers what it stripped;
 * Rehighlight puts those highlights back, in their original colors, on
 * whatever text still sits where they were. The memory is a plugin field
 * whose positions are mapped through later edits, so a rehighlight still
 * lands right after the user has typed elsewhere in the card.
 *
 * The memory only lasts as long as the unhighlight is still in the undo
 * history. Each stash records the history depth right after the unhighlight
 * step (`undoDepth`). The plugin watches that depth after every
 * transaction, and the moment the history gets shorter than a stash's depth
 * — the unhighlight was undone, or the history was reset — the stash is
 * dropped for good (an undo already brings the highlighting back, and a
 * later edit must not be able to revive the stash). Nothing is saved with
 * the document, so closing and reopening it drops every stash.
 *
 * Only `highlight` marks are touched; background shading is left alone. A
 * rehighlight never overwrites a highlight that's on the text now.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Mark } from 'prosemirror-model';
import { undoDepth } from 'prosemirror-history';
import { schema } from '../schema/index.js';

export interface DocRange {
  from: number;
  to: number;
}

interface StashSpan extends DocRange {
  mark: Mark;
}

interface Stash {
  id: number;
  /** The highlights it removed, mapped through later edits. */
  spans: StashSpan[];
  /** `undoDepth` right after the unhighlight; null until the plugin has
   *  seen the settled state. */
  depth: number | null;
}

interface StashState {
  stashes: Stash[];
  nextId: number;
}

interface StashMeta {
  add?: { spans: StashSpan[] };
  depth?: { ids: number[]; value: number };
  /** Stashes whose unhighlight has left the undo history. */
  kill?: number[];
  /** Ranges a rehighlight just restored: taken out of the stashes. */
  restored?: DocRange[];
}

/** Old stashes fall off past this many, oldest first. */
const MAX_STASHES = 16;

export const cardHighlightKey = new PluginKey<StashState>('pmd-card-highlight-stash');

function mapRange(r: DocRange, tr: Transaction): DocRange | null {
  const from = tr.mapping.map(r.from, 1);
  const to = tr.mapping.map(r.to, -1);
  return to > from ? { from, to } : null;
}

/** `span` minus every range in `cut`. */
function subtract(span: StashSpan, cut: readonly DocRange[]): StashSpan[] {
  let pieces: StashSpan[] = [span];
  for (const c of cut) {
    const next: StashSpan[] = [];
    for (const p of pieces) {
      if (c.to <= p.from || c.from >= p.to) {
        next.push(p);
        continue;
      }
      if (c.from > p.from) next.push({ ...p, to: c.from });
      if (c.to < p.to) next.push({ ...p, from: c.to });
    }
    pieces = next;
  }
  return pieces;
}

export function cardHighlightPlugin(): Plugin<StashState> {
  return new Plugin<StashState>({
    key: cardHighlightKey,
    state: {
      init: () => ({ stashes: [], nextId: 1 }),
      apply(tr, value) {
        const meta = tr.getMeta(cardHighlightKey) as StashMeta | undefined;
        let { stashes, nextId } = value;
        if (tr.docChanged && stashes.length > 0) {
          stashes = stashes
            .map((s) => ({
              ...s,
              spans: s.spans
                .map((sp) => {
                  const r = mapRange(sp, tr);
                  return r ? { ...sp, ...r } : null;
                })
                .filter((sp): sp is StashSpan => sp !== null),
            }))
            .filter((s) => s.spans.length > 0);
        }
        if (meta?.kill) {
          const dead = meta.kill;
          stashes = stashes.filter((s) => !dead.includes(s.id));
        }
        if (meta?.restored) {
          const cut = meta.restored;
          stashes = stashes
            .map((s) => ({ ...s, spans: s.spans.flatMap((sp) => subtract(sp, cut)) }))
            .filter((s) => s.spans.length > 0);
        }
        if (meta?.depth) {
          const { ids, value: depth } = meta.depth;
          stashes = stashes.map((s) => (ids.includes(s.id) ? { ...s, depth } : s));
        }
        if (meta?.add && meta.add.spans.length > 0) {
          // Positions here are already in the new document's coordinates
          // (mark steps never move anything), so they aren't mapped.
          stashes = [...stashes, { id: nextId, spans: meta.add.spans, depth: null }];
          nextId += 1;
          if (stashes.length > MAX_STASHES) stashes = stashes.slice(stashes.length - MAX_STASHES);
        }
        return stashes === value.stashes && nextId === value.nextId ? value : { stashes, nextId };
      },
    },
    // Record the history depth once an unhighlight has settled into it, and
    // drop the stashes whose unhighlight has left it. Runs on the final
    // state, so it doesn't matter where the history plugin sits in the
    // plugin order.
    appendTransaction(_trs, _old, newState) {
      const st = cardHighlightKey.getState(newState);
      if (!st || st.stashes.length === 0) return null;
      const depth = undoDepth(newState);
      const pending = st.stashes.filter((s) => s.depth === null);
      const dead = st.stashes.filter((s) => s.depth !== null && depth < s.depth);
      if (pending.length === 0 && dead.length === 0) return null;
      const meta: StashMeta = {};
      if (pending.length > 0) meta.depth = { ids: pending.map((s) => s.id), value: depth };
      if (dead.length > 0) meta.kill = dead.map((s) => s.id);
      return newState.tr.setMeta(cardHighlightKey, meta).setMeta('addToHistory', false);
    },
  });
}

/** Stashes whose unhighlight is still in the undo history. */
function liveStashes(state: EditorState): Stash[] {
  const st = cardHighlightKey.getState(state);
  if (!st) return [];
  const depth = undoDepth(state);
  return st.stashes.filter((s) => s.depth !== null && depth >= s.depth);
}

/** Merge overlapping / touching ranges, in document order. */
function normalize(ranges: readonly DocRange[]): DocRange[] {
  const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
  const out: DocRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ from: r.from, to: r.to });
  }
  return out;
}

/** Every highlighted text run inside `ranges`, clipped to them. */
function highlightedRuns(state: EditorState, ranges: readonly DocRange[]): StashSpan[] {
  const highlight = schema.marks['highlight']!;
  const runs: StashSpan[] = [];
  for (const r of ranges) {
    state.doc.nodesBetween(r.from, r.to, (node, pos) => {
      if (!node.isText) return true;
      const mark = node.marks.find((m) => m.type === highlight);
      if (!mark) return true;
      const from = Math.max(r.from, pos);
      const to = Math.min(r.to, pos + node.nodeSize);
      if (to > from) runs.push({ from, to, mark });
      return true;
    });
  }
  return runs;
}

/** Stashed spans a rehighlight over `ranges` would put back: clipped to
 *  the ranges, and only where the text has no highlight now. */
function restorableSpans(state: EditorState, ranges: readonly DocRange[]): StashSpan[] {
  const highlight = schema.marks['highlight']!;
  const out: StashSpan[] = [];
  for (const stash of liveStashes(state)) {
    for (const sp of stash.spans) {
      for (const r of ranges) {
        const from = Math.max(sp.from, r.from);
        const to = Math.min(sp.to, r.to);
        if (to <= from) continue;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText) return true;
          if (node.marks.some((m) => m.type === highlight)) return true;
          const a = Math.max(from, pos);
          const b = Math.min(to, pos + node.nodeSize);
          if (b > a) out.push({ from: a, to: b, mark: sp.mark });
          return true;
        });
      }
    }
  }
  return out;
}

/** What a menu should offer for `ranges`: Unhighlight while any text there
 *  is highlighted, Rehighlight when nothing is but a still-undoable
 *  unhighlight left highlights to put back, otherwise nothing. */
export function cardHighlightAction(
  state: EditorState,
  ranges: readonly DocRange[],
): 'unhighlight' | 'rehighlight' | null {
  const scope = normalize(ranges);
  if (scope.length === 0) return null;
  if (highlightedRuns(state, scope).length > 0) return 'unhighlight';
  return restorableSpans(state, scope).length > 0 ? 'rehighlight' : null;
}

/** Strip every highlight in `ranges` and remember what was there. False
 *  (no transaction) when nothing in them is highlighted. */
export function unhighlightRanges(ranges: readonly DocRange[]): Command {
  return (state, dispatch) => {
    const scope = normalize(ranges);
    const runs = highlightedRuns(state, scope);
    if (runs.length === 0) return false;
    if (!dispatch) return true;
    const highlight = schema.marks['highlight']!;
    const tr = state.tr;
    for (const r of scope) tr.removeMark(r.from, r.to, highlight);
    const meta: StashMeta = { add: { spans: runs } };
    tr.setMeta(cardHighlightKey, meta);
    dispatch(tr);
    return true;
  };
}

/** Put back what the last unhighlights removed inside `ranges`. False when
 *  there is nothing to restore (no live stash, or it's all highlighted). */
export function rehighlightRanges(ranges: readonly DocRange[]): Command {
  return (state, dispatch) => {
    const scope = normalize(ranges);
    const spans = restorableSpans(state, scope);
    if (spans.length === 0) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    for (const sp of spans) tr.addMark(sp.from, sp.to, sp.mark);
    const meta: StashMeta = { restored: scope };
    tr.setMeta(cardHighlightKey, meta);
    dispatch(tr);
    return true;
  };
}

/** The card / analytic-unit containers the selection touches — the scope
 *  of the Card-menu and ribbon commands. Empty when outside any card. */
export function cardRangesForSelection(state: EditorState): DocRange[] {
  const { from, to } = state.selection;
  const ranges: DocRange[] = [];
  const $from = state.doc.resolve(from);
  for (let d = $from.depth; d >= 1; d--) {
    const name = $from.node(d).type.name;
    if (name === 'card' || name === 'analytic_unit') {
      ranges.push({ from: $from.before(d), to: $from.after(d) });
      break;
    }
  }
  if (to > from) {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === 'card' || node.type.name === 'analytic_unit') {
        ranges.push({ from: pos, to: pos + node.nodeSize });
        return false;
      }
      return true;
    });
  }
  return normalize(ranges);
}

/** Ribbon command: strip the highlighting from the card(s) at the selection. */
export function unhighlightCard(): Command {
  return (state, dispatch) => unhighlightRanges(cardRangesForSelection(state))(state, dispatch);
}

/** Ribbon command: put back highlighting Unhighlight Card removed. */
export function rehighlightCard(): Command {
  return (state, dispatch) => rehighlightRanges(cardRangesForSelection(state))(state, dispatch);
}
