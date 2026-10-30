/**
 * Keep your place across Reload From Disk.
 *
 * Reload swaps the open document for a fresh read of the file, which builds a
 * new editor view at the top of the page with the caret at the start. This
 * saves where you were (the caret or selection, and the line you were
 * reading) before the swap and puts you back after it. The file may differ
 * from what you had open (another device saved it, or your unsaved edits are
 * being discarded), so each saved position is mapped across the difference
 * between the two documents; one that fell inside the changed stretch lands at
 * its start.
 */
import { Mark, type Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { nearestScroller } from './precise-scroll.js';
import { captureViewportAnchor, restoreViewportAnchor, type ViewportAnchor } from './scroll-anchor.js';

export interface ReloadPosition {
  /** The document being replaced, for mapping the positions below. */
  docBefore: PMNode;
  anchor: number;
  head: number;
  /** The line being read and its screen height; null at the very top of the
   *  document, or when nothing can be measured (a hidden pane). */
  scroll: ViewportAnchor | null;
}

/** Same markup and content, ignoring heading `id`s: a reload can give every
 *  heading a fresh id (the .docx import does), and ids say nothing about
 *  whether the text changed. */
function sameIgnoringIds(a: PMNode, b: PMNode): boolean {
  if (a === b) return true;
  if (a.type !== b.type || a.childCount !== b.childCount || !Mark.sameSet(a.marks, b.marks)) return false;
  if (a.isText) return a.text === b.text;
  for (const key of Object.keys(a.attrs)) {
    if (key === 'id') continue;
    const x = a.attrs[key];
    const y = b.attrs[key];
    if (x !== y && JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  for (let i = 0; i < a.childCount; i++) if (!sameIgnoringIds(a.child(i), b.child(i))) return false;
  return true;
}

/** Where `pos` in `before` lands in `after`. The document is compared a
 *  top-level block (a card, a heading) at a time: a position ahead of the first
 *  changed block stays put, one behind the last changed block moves by the size
 *  change, and one inside the changed stretch keeps its distance from the start
 *  of that stretch, held inside it. */
export function mapPosThroughReload(before: PMNode, after: PMNode, pos: number): number {
  const A = before.content;
  const B = after.content;
  let head = 0;
  while (head < A.childCount && head < B.childCount && sameIgnoringIds(A.child(head), B.child(head))) head++;
  let tail = 0;
  while (
    tail < A.childCount - head &&
    tail < B.childCount - head &&
    sameIgnoringIds(A.child(A.childCount - 1 - tail), B.child(B.childCount - 1 - tail))
  ) {
    tail++;
  }
  let start = 0;
  for (let i = 0; i < head; i++) start += A.child(i).nodeSize;
  let endA = A.size;
  let endB = B.size;
  for (let i = 0; i < tail; i++) {
    endA -= A.child(A.childCount - 1 - i).nodeSize;
    endB -= B.child(B.childCount - 1 - i).nodeSize;
  }
  let mapped: number;
  if (pos <= start) mapped = pos;
  else if (pos >= endA) mapped = pos + (endB - endA);
  else mapped = Math.min(start + (pos - start), Math.max(start, endB - 1));
  return Math.max(0, Math.min(mapped, B.size));
}

/** Save the caret and the reading position of `view` before it is replaced. */
export function captureReloadPosition(view: EditorView): ReloadPosition {
  const { selection, doc } = view.state;
  const scroller = nearestScroller(view.dom as HTMLElement);
  // At the very top there is nothing to hold: the fresh view is already there.
  const scroll = scroller && scroller.scrollTop > 0 ? captureViewportAnchor(view) : null;
  return { docBefore: doc, anchor: selection.anchor, head: selection.head, scroll };
}

/** Put the caret and the reading position back in `view`, the fresh view of
 *  the reloaded document. */
export function restoreReloadPosition(view: EditorView, saved: ReloadPosition): void {
  if (view.isDestroyed) return;
  const doc = view.state.doc;
  const map = (p: number): number => mapPosThroughReload(saved.docBefore, doc, p);
  try {
    const sel = TextSelection.between(doc.resolve(map(saved.anchor)), doc.resolve(map(saved.head)));
    view.dispatch(view.state.tr.setSelection(sel).setMeta('addToHistory', false));
  } catch {
    /* leave the caret where the fresh view put it */
  }
  if (!saved.scroll) return;
  const pos = map(saved.scroll.pos);
  const scroller = nearestScroller(view.dom as HTMLElement);
  if (!scroller) return;
  // A long document is laid out lazily, so a position far down has no real
  // height yet: jump to it roughly first, then let the anchor refine.
  try {
    const { node } = view.domAtPos(pos);
    const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  } catch {
    /* the refine below still gets us close */
  }
  restoreViewportAnchor({ view, scroller, pos, topBefore: saved.scroll.topBefore });
}
