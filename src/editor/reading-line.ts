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
