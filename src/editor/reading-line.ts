import type { EditorView } from 'prosemirror-view';
import { nearestScroller } from './precise-scroll.js';
import { readerControllerFor, READER_EDGE_W } from './reader-view.js';

/**
 * Where on screen a speaker is actually reading.
 *
 * People don't read the very top line of the window: their eyes sit about a
 * third of the way down, with the text above already delivered. Everything
 * that guesses "the line being read" from the scroll position (the time
 * left, the on-time / too-slow / too-fast indicator, paced auto-scroll, the
 * place read mode pins when it toggles) uses this line instead of the top
 * edge.
 *
 * Near the start of the document the line eases down from the top: at the
 * very top nothing has been read yet, so the first lines are still ahead of
 * the reader, and it reaches the full third once the document has scrolled
 * that far. Without the ease, opening a speech doc would make its first
 * third of a screen read as already delivered.
 */

/** How far down the window the reading line sits, as a fraction of its height. */
export const READING_LINE_FRACTION = 1 / 3;

/** px below the top of the visible document at which the reader is looking.
 *  `viewportH` is the window's height; `scrolledPx` is how far the document
 *  has scrolled (0 at the very top). */
export function readingLineOffset(viewportH: number, scrolledPx: number): number {
  return Math.max(0, Math.min(viewportH * READING_LINE_FRACTION, scrolledPx));
}

/** The document position of the line a speaker is reading in `view`: about a
 *  third of the way down the visible document (see `reading-line.ts`), not its
 *  top edge. In Reading view (paged, scrolled sideways) it is the first column
 *  of the current page, a third of the way down. Null when it can't be measured (no scroller, a hidden or
 *  zero-size pane, a layout without hit-testing). */
export function scrollAnchorPos(view: EditorView): number | null {
  const scroller = nearestScroller(view.dom);
  if (!scroller) return null;
  const s = scroller.getBoundingClientRect();
  const e = view.dom.getBoundingClientRect();
  if (s.height === 0 || e.width === 0) return null;
  if (readerControllerFor(view)) {
    // Reading view: the editor is a wide strip scrolled sideways, so its
    // middle is pages away. The page being read is the one in the window;
    // aim at its first column (clear of the flip lanes at the edges).
    const top = s.top + s.height * READING_LINE_FRACTION;
    for (const dx of [READER_EDGE_W + 14, READER_EDGE_W + 60, READER_EDGE_W + 120, s.width * 0.3]) {
      try {
        const pos = view.posAtCoords({ left: Math.min(s.left + dx, s.right - 1), top })?.pos ?? null;
        if (pos !== null) return pos;
      } catch {
        /* try the next offset */
      }
    }
    return null;
  }
  // The reading line, a third down the visible part of the document: measured
  // from the editor's own top when it starts inside the window (scrolled to
  // the very top, or a short doc), the window's top edge otherwise — and in
  // the middle of the text column.
  const scrolled = Math.max(0, s.top - e.top);
  const top = Math.max(s.top, e.top) + 6 + readingLineOffset(s.height, scrolled);
  const left = Math.min(Math.max(e.left + e.width / 2, s.left + 1), s.right - 1);
  try {
    return view.posAtCoords({ left, top })?.pos ?? null;
  } catch {
    return null;
  }
}
