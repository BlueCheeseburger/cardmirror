/**
 * Reading-position marker.
 *
 * A red "Marked h:mm" run you drop at the cursor (Verbatim's red-text
 * convention) to find your place when you stop mid-card. It's a normal
 * editing action — bound to a rebindable shortcut and usable any time —
 * but it shines in read mode, where the keyboard is otherwise locked: there
 * Space, Enter, or the bound shortcut all drop one (see `read-mode-plugin`).
 *
 * Triggering it again while the cursor is on an existing marker removes that
 * marker (toggle). The marker is plain red text (the `font_color` mark at
 * `FF0000`), so it round-trips to Word like any other colored run, and read
 * mode keeps red text visible so the marker shows in the mode that drops it.
 */

import { TextSelection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { closeHistory } from 'prosemirror-history';
import { schema } from '../schema/index.js';

/** Verbatim red — the marker's text color, and the signal read mode uses
 *  to keep the marker visible. Hex without `#` (OOXML / `font_color`). */
export const READING_MARKER_COLOR = 'FF0000';

/** Transaction meta flag marking a transaction as the reading-marker edit,
 *  so read mode's `filterTransaction` lets it through (the one edit read
 *  mode allows). */
export const READING_MARKER_META = 'readingMarker';

/** Meta flag on the undo/redo transactions read mode permits — those
 *  bounded to only reverse marker edits (see `read-mode-plugin`). Also
 *  passes `filterTransaction`. */
export const READ_MODE_UNDO_META = 'readModeUndo';

/** Meta flag on drag-move / dropzone / receive-pill insertions. These are
 *  position-validated by the drag controller, so read mode lets them through
 *  too — moving and shelf-inserting cards is safe even while reading. */
export const READ_MODE_DRAG_META = 'readModeDragEdit';

/** True when a `font_color` value is the reading-marker red. */
export function isReadingMarkerColor(color: string | undefined | null): boolean {
  return (color ?? '').toUpperCase() === READING_MARKER_COLOR;
}

/** Format the marker's clock time as `h:mm` (12-hour, no leading zero on the
 *  hour, no meridiem) — e.g. `7:32`. Exported for testing. */
export function formatMarkerTime(d: Date): string {
  let h = d.getHours() % 12;
  if (h === 0) h = 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** True when a text node is a reading-position marker run (red `font_color`). */
export function isMarkerText(node: { isText: boolean; marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[] }): boolean {
  return (
    node.isText &&
    node.marks.some(
      (m) => m.type.name === 'font_color' && isReadingMarkerColor(m.attrs['color'] as string),
    )
  );
}

/** If the cursor sits on (inside, or at either edge of) an existing
 *  reading-marker run, return that run's span — expanded over any adjacent
 *  marker text nodes. Otherwise null. Exported for testing. */
export function readingMarkerRunAt(state: EditorState): { from: number; to: number } | null {
  const $h = state.selection.$head;
  const parent = $h.parent;
  if (!parent.isTextblock) return null;
  const start = $h.start();
  const items: { from: number; to: number; marker: boolean }[] = [];
  parent.forEach((child, offset) => {
    items.push({ from: start + offset, to: start + offset + child.nodeSize, marker: isMarkerText(child) });
  });
  let idx = items.findIndex((it) => it.marker && $h.pos >= it.from && $h.pos <= it.to);
  if (idx < 0) return null;
  let from = items[idx]!.from;
  let to = items[idx]!.to;
  for (let i = idx - 1; i >= 0 && items[i]!.marker; i--) from = items[i]!.from;
  for (let i = idx + 1; i < items.length && items[i]!.marker; i++) to = items[i]!.to;
  return { from, to };
}

/** Build (don't dispatch) the transaction that inserts a red "Marked h:mm"
 *  marker at the cursor and places the caret after it. Returns null if the
 *  schema lacks `font_color`. Exported for testing. */
export function buildInsertReadingMarkerTransaction(
  state: EditorState,
  now: Date = new Date(),
): Transaction | null {
  const fontColor = schema.marks['font_color'];
  if (!fontColor) return null;
  const text = `Marked ${formatMarkerTime(now)}`;
  const node = schema.text(text, [fontColor.create({ color: READING_MARKER_COLOR })]);
  const pos = state.selection.head;
  const tr = state.tr.insert(pos, node);
  tr.setSelection(TextSelection.create(tr.doc, pos + node.nodeSize));
  // Don't let the (inclusive) red mark bleed into whatever's typed next.
  tr.removeStoredMark(fontColor);
  tr.setMeta(READING_MARKER_META, true);
  // Each marker is its own undo step — never grouped with a nearby edit
  // (which would make undo revert that edit too).
  closeHistory(tr);
  return tr.scrollIntoView();
}

/** Build the toggle transaction: remove the marker the cursor is on, or
 *  insert a new one at the cursor. Null only if `font_color` is missing.
 *  Exported for testing. */
export function buildToggleReadingMarkerTransaction(
  state: EditorState,
  now: Date = new Date(),
): Transaction | null {
  const run = readingMarkerRunAt(state);
  if (run) {
    const tr = state.tr.delete(run.from, run.to).setMeta(READING_MARKER_META, true);
    // Its own undo step (same reason as the insert path) — so undoing a
    // toggle-off reverses only that, never a nearby edit.
    closeHistory(tr);
    return tr.scrollIntoView();
  }
  return buildInsertReadingMarkerTransaction(state, now);
}

/** PM command form — toggle a reading-position marker at the cursor. Bound
 *  to the rebindable `toggleReadingMarker` ribbon command. */
export const toggleReadingMarkerCommand: Command = (state, dispatch) => {
  const tr = buildToggleReadingMarkerTransaction(state);
  if (!tr) return false;
  if (dispatch) dispatch(tr);
  return true;
};

/** View form — used by the read-mode keydown handler, where keymaps are
 *  dead but `handleDOMEvents` still fires. Programmatic dispatch isn't
 *  gated by `editable: false`, so this works while read mode is locked. */
export function toggleReadingMarker(view: EditorView, now: Date = new Date()): boolean {
  const tr = buildToggleReadingMarkerTransaction(view.state, now);
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

// ------------------------------------------------------------ whole cards

/** The doc-level cards that overlap any of `ranges`, with their positions. */
function cardsInRanges(
  doc: PMNode,
  ranges: readonly { from: number; to: number }[],
): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  doc.forEach((child, offset) => {
    if (child.type.name !== 'card') return;
    const end = offset + child.nodeSize;
    if (ranges.some((r) => offset < r.to && end > r.from)) out.push({ pos: offset, node: child });
  });
  return out;
}

function cardHasMarker(card: PMNode): boolean {
  let found = false;
  card.descendants((n) => {
    if (found) return false;
    if (isMarkerText(n)) found = true;
    return !found;
  });
  return found;
}

/** What a "mark the card(s)" action would do over `ranges`: `'mark'` while any
 *  card in them has no marker yet, `'unmark'` once every one has one, `null`
 *  when no card is in range. Exported for the outline's context menu. */
export function cardMarkAction(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): 'mark' | 'unmark' | null {
  const cards = cardsInRanges(state.doc, ranges);
  if (cards.length === 0) return null;
  return cards.every((c) => cardHasMarker(c.node)) ? 'unmark' : 'mark';
}

/** Build (don't dispatch) the transaction for a heading's "Mark card(s)" row:
 *  every card in `ranges` that has no reading marker gets a red "Marked h:mm"
 *  run at the end of its last body paragraph (a body paragraph is added when
 *  the card has none), which is what makes it a marked card for Save Marked
 *  Cards. When every card already has one, the markers are removed instead.
 *  One transaction, one undo step. Null when nothing is in range. */
export function buildMarkCardsTransaction(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  now: Date = new Date(),
): Transaction | null {
  const fontColor = schema.marks['font_color'];
  const cardBody = schema.nodes['card_body'];
  if (!fontColor || !cardBody) return null;
  const action = cardMarkAction(state, ranges);
  if (!action) return null;
  const cards = cardsInRanges(state.doc, ranges);
  const tr = state.tr;
  const markerNode = (): PMNode =>
    schema.text(`Marked ${formatMarkerTime(now)}`, [fontColor.create({ color: READING_MARKER_COLOR })]);
  // Back to front, so earlier positions stay valid as later cards change.
  for (const { pos, node } of [...cards].reverse()) {
    if (action === 'unmark') {
      const spans: { from: number; to: number }[] = [];
      node.descendants((n, p) => {
        if (isMarkerText(n)) spans.push({ from: pos + 1 + p, to: pos + 1 + p + n.nodeSize });
      });
      for (const sp of spans.reverse()) tr.delete(sp.from, sp.to);
      continue;
    }
    if (cardHasMarker(node)) continue;
    let target: { end: number } | null = null;
    let fallback: { end: number } | null = null;
    node.forEach((child, offset) => {
      const end = pos + 1 + offset + child.nodeSize - 1; // end of the child's content
      if (child.type.name === 'card_body') target = { end };
      else if (child.type.name === 'cite_paragraph') fallback = { end };
    });
    const at = (target ?? fallback) as { end: number } | null;
    if (at) tr.insert(at.end, markerNode());
    else tr.insert(pos + node.nodeSize - 1, cardBody.create(null, markerNode()));
  }
  if (!tr.docChanged) return null;
  tr.setMeta(READING_MARKER_META, true);
  closeHistory(tr);
  return tr;
}
