/**
 * Paced auto-scroll — scrolls the editor at the pace the visible
 * content would actually be read aloud, using the same read-aloud
 * word classification and per-reader WPM math as the read-time
 * estimates (`word-count.ts`).
 *
 * Rather than precomputing a document-wide position/time map (which
 * `content-visibility: auto` virtualization makes expensive or
 * outright wrong for off-screen cards — see `precise-scroll.ts`'s
 * doc comment), this resamples a few times a second: it asks
 * ProseMirror which doc positions sit at a small pixel window just
 * below the current viewport top, counts the read-aloud words in
 * that window, and converts that into a scroll velocity. Dense
 * highlighted text scrolls slowly, tag/cite text scrolls at its own
 * (usually faster) `tagWpm`, and unhighlighted filler — near-zero
 * read-aloud words per pixel — scrolls quickly, capped so it never
 * becomes an unreadable blur. Because the sampled window is always
 * adjacent to the current scroll position, `posAtCoords` only ever
 * asks about content that's on-screen or about to be — the same
 * "only touch what's near the viewport" discipline
 * `preciseScrollIntoView` uses, for the same reason.
 */

import type { EditorView } from 'prosemirror-view';
import {
  countReadAloudSplit,
  readTimeSeconds,
  type ReaderRates,
  type ReadAloudCounts,
} from './word-count.js';
import { nearestScroller } from './precise-scroll.js';
import { readingLineOffset } from './reading-line.js';

/** How far below the viewport top to sample, in CSS px. Small enough
 *  that the sampled content is always on-screen or just about to be;
 *  large enough to average over more than one short line so a single
 *  short heading or blank gap doesn't dominate the sample. */
const SAMPLE_WINDOW_PX = 220;

/** How often to re-sample and recompute velocity, in ms. Scrolling
 *  itself advances every animation frame at the last-computed
 *  velocity; only the pricier posAtCoords + word-count sample is
 *  throttled. */
const RESAMPLE_INTERVAL_MS = 300;

/** Floor and ceiling on scroll speed, px/sec. The floor keeps a
 *  dense highlighted stretch from crawling to an apparent stop (kept low so
 *  slow readers on dense text aren't scrolled faster than they read; the tick
 *  accumulates sub-pixel steps itself, so a slow pace still moves); the
 *  ceiling keeps a long unhighlighted (zero read-aloud) run from
 *  whipping past as an unreadable blur. */
const MIN_VELOCITY_PX_S = 3;
const MAX_VELOCITY_PX_S = 900;

/** Used when a sample can't resolve real content — the very start or
 *  end of the doc, or a window with nothing under it yet. */
const FALLBACK_VELOCITY_PX_S = 60;

/** Longest frame gap the scroll step will honor, in seconds. */
const MAX_FRAME_DT_S = 0.1;

interface RunningState {
  view: EditorView;
  velocity: number;
  /** Our own unrounded scroll position, and what the scroller read back after
   *  the last write (to spot outside movement). */
  pos: number;
  applied: number;
  lastFrameTime: number;
  lastSampleTime: number;
  rafId: number;
  /** Full teardown: cancels the frame loop, removes the manual-
   *  interrupt listeners, clears `running`, and fires `onStop` —
   *  idempotent, so both the interrupt listeners and an explicit
   *  `stopAutoScroll()` call can each call it safely. */
  stop: () => void;
}

let running: RunningState | null = null;

/** True while auto-scroll is actively running, on any view. */
export function isAutoScrolling(): boolean {
  return running !== null;
}

/** The view auto-scroll is currently running on, or null. */
export function autoScrollingView(): EditorView | null {
  return running?.view ?? null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** The pure math half of sampling: given the read-aloud words found in
 *  a `windowPx`-tall slice of the document and `reader`'s rate(s),
 *  return the scroll velocity (px/sec) that would carry the reader
 *  through that slice in exactly the time it takes to read it aloud.
 *  Split out from `sampleAutoScrollVelocity` so the pacing math is
 *  testable without a live DOM/ProseMirror view. Exported for tests. */
export function velocityFromWindow(
  counts: ReadAloudCounts,
  reader: ReaderRates,
  windowPx: number,
  useLay = false,
): number {
  const seconds = readTimeSeconds(counts, reader, useLay);
  // A lay rate that isn't set up yet can't pace anything: keep a steady
  // default rather than skimming at the cap as if nothing were read aloud.
  if (seconds === null) return FALLBACK_VELOCITY_PX_S;
  // No read-aloud words in this window (unhighlighted filler, a bare
  // heading) — nothing to pace against, so skim through at the cap
  // rather than stall waiting for content that isn't there.
  if (!seconds || seconds <= 0) return MAX_VELOCITY_PX_S;
  return clamp(windowPx / seconds, MIN_VELOCITY_PX_S, MAX_VELOCITY_PX_S);
}

/** Sample the read-aloud word density in a small window just below
 *  the scroller's visible top, and convert it to a scroll velocity
 *  for `reader`. Exported for tests. */
export function sampleAutoScrollVelocity(
  view: EditorView,
  scroller: HTMLElement,
  reader: ReaderRates,
  useLay = false,
): number {
  const scRect = scroller.getBoundingClientRect();
  const editorRect = view.dom.getBoundingClientRect();
  const x = clamp(editorRect.left + editorRect.width / 2, scRect.left + 2, scRect.right - 2);
  // Sample from the line being read (a third of the way down), not the top
  // edge: the text above it has already been delivered.
  const scrolled = Math.max(0, scRect.top - editorRect.top);
  const topY = scRect.top + 1 + readingLineOffset(scRect.height, scrolled);
  const bottomY = Math.min(topY + SAMPLE_WINDOW_PX, scRect.bottom - 1);
  if (bottomY <= topY) return FALLBACK_VELOCITY_PX_S;

  const top = view.posAtCoords({ left: x, top: topY });
  const bottom = view.posAtCoords({ left: x, top: bottomY });
  if (!top || !bottom) return FALLBACK_VELOCITY_PX_S;

  const from = Math.min(top.pos, bottom.pos);
  const to = Math.max(top.pos, bottom.pos);
  if (to <= from) return FALLBACK_VELOCITY_PX_S;

  const counts = countReadAloudSplit(view.state.doc, from, to);
  return velocityFromWindow(counts, reader, bottomY - topY, useLay);
}

/**
 * Start paced auto-scroll on `view`, at `reader`'s rate(s). Returns
 * false without starting when auto-scroll is already running (on any
 * view) or `view`'s scroller has nothing left to scroll.
 *
 * `onStop` fires exactly once, however the run ends — reaching the
 * bottom, a manual scroll/touch/click interrupt, or an explicit
 * `stopAutoScroll()` call — so callers can reset a toggle button's
 * pressed state without tracking the reason themselves.
 */
export interface AutoScrollOptions {
  /** Whether the document is on the lay speaking rate right now. Asked on
   *  every sample, so flipping the toggle mid-run changes the pace at once. */
  useLay?: () => boolean;
}

/** Keys that mean "I'm driving the scroll now" — they hand control back. */
const SCROLL_INTERRUPT_KEYS = new Set([
  'Escape', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown',
]);

export function startAutoScroll(
  view: EditorView,
  reader: ReaderRates,
  onStop: () => void,
  opts: AutoScrollOptions = {},
): boolean {
  const lay = (): boolean => opts.useLay?.() ?? false;
  if (running) return false;
  const scroller = nearestScroller(view.dom as HTMLElement);
  if (!scroller) return false;
  const maxTop = scroller.scrollHeight - scroller.clientHeight;
  // Nothing to scroll: the document fits, or the reader is already at its end.
  if (maxTop < 2 || scroller.scrollTop >= maxTop - 1) return false;

  let stopped = false;
  const onManualInterrupt = (): void => state.stop();
  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (SCROLL_INTERRUPT_KEYS.has(e.key)) state.stop();
  };

  const tick = (t: number): void => {
    if (stopped) return;
    // The pane closed / the doc was replaced out from under us mid-scroll —
    // posAtCoords on a torn-down view is unsafe to call, so stop cleanly
    // rather than let a stray frame throw.
    if (view.isDestroyed) {
      state.stop();
      return;
    }
    // A hitch or a backgrounded tab leaves a huge gap between frames; cap it
    // so the scroll doesn't leap that far in one step.
    const dt = Math.min((t - state.lastFrameTime) / 1000, MAX_FRAME_DT_S);
    state.lastFrameTime = t;
    if (t - state.lastSampleTime >= RESAMPLE_INTERVAL_MS) {
      state.velocity = sampleAutoScrollVelocity(view, scroller, reader, lay());
      state.lastSampleTime = t;
    }
    // Keep the position as a float of our own. A browser rounds every
    // `scrollTop` write to whole (physical) pixels, so `scrollTop += 0.2` per
    // frame (a dense stretch paces at ~12 px/s) read back unchanged and the
    // scroll silently stalled. If something else moved the scroller (layout
    // shift, cv:auto cards materializing) adopt its position instead.
    if (Math.abs(scroller.scrollTop - state.applied) > 1.5) state.pos = scroller.scrollTop;
    state.pos += state.velocity * dt;
    scroller.scrollTop = state.pos;
    state.applied = scroller.scrollTop;
    if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1) {
      state.stop();
      return;
    }
    state.rafId = requestAnimationFrame(tick);
  };

  const state: RunningState = {
    view,
    velocity: FALLBACK_VELOCITY_PX_S,
    pos: scroller.scrollTop,
    applied: scroller.scrollTop,
    lastFrameTime: performance.now(),
    lastSampleTime: 0, // forces an immediate sample on the first frame
    rafId: 0,
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(state.rafId);
      scroller.removeEventListener('wheel', onManualInterrupt);
      scroller.removeEventListener('touchstart', onManualInterrupt);
      scroller.removeEventListener('pointerdown', onManualInterrupt);
      document.removeEventListener('keydown', onKey, true);
      if (running === state) running = null;
      onStop();
    },
  };
  running = state;
  document.addEventListener('keydown', onKey, true);
  // Any manual scroll input hands control back to the reader — auto-scroll
  // never fights a deliberate scroll, wheel flick, or touch/click.
  scroller.addEventListener('wheel', onManualInterrupt, { passive: true });
  scroller.addEventListener('touchstart', onManualInterrupt, { passive: true });
  scroller.addEventListener('pointerdown', onManualInterrupt, { passive: true });
  state.rafId = requestAnimationFrame(tick);
  return true;
}

/** Stop auto-scroll if running (on any view) — full teardown, and
 *  fires the `onStop` callback passed to `startAutoScroll`. No-op if
 *  nothing is running. */
export function stopAutoScroll(): void {
  running?.stop();
}

/** Stop auto-scroll if it's running on a DIFFERENT view than `view` —
 *  called on focus change so switching panes doesn't leave a
 *  background pane silently scrolling. Running on the same view is
 *  left alone (e.g. that view's own focus event re-firing). */
export function stopAutoScrollIfOtherView(view: EditorView | null): void {
  if (running && running.view !== view) running.stop();
}

/** Test seam: reset module state between tests. */
export function __resetAutoScrollForTests(): void {
  running?.stop();
  running = null;
}
