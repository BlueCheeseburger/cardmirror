/**
 * The reading-position marker: a blue bar in the margin between the outline
 * and the speech document.
 *
 *   - EXPECTED bar: once the speech clock has started (it stays when paused and
 *     goes only on a reset) and the first
 *     reader has a speed (flow, or lay while the doc is on the lay toggle),
 *     it shows where the speaker should be reading by now: the whole doc read
 *     at a steady pace across the whole speech (`expectedReadSec`,
 *     `timer-pace.ts`). It starts at the top and moves down continuously: not
 *     from line to line, but sliding along each line's height as the words
 *     are read. Unhighlighted text takes no reading time, so the target jumps
 *     across it; the bar follows the target at a capped speed, so it visibly
 *     rushes through that text instead of jumping. Hidden for a doc more than
 *     a minute longer than the speech (a masterfile).
 *   - TELEPROMPTER bar (outlined): while paced Auto-Scroll runs, the line it
 *     takes to be the one being read (a third of the way down,
 *     `reading-line.ts`).
 *
 * Both are plain elements inside the document's scroller, outside the
 * ProseMirror DOM. The expected bar lives in the scroller's content
 * coordinates, so it scrolls with the text; the teleprompter bar stays put on
 * screen, so it is re-placed on every scroll event. Positions are measured
 * with `coordsAtPos`, so read mode (which hides the unread text) and the
 * document zoom need no special case beyond re-measuring when the layout
 * changes (a ResizeObserver on the editor).
 */

import type { EditorView } from 'prosemirror-view';
import { settings } from './settings.js';
import { docReadCounts, posAtReadSeconds } from './live-read-time.js';
import { readTimeSeconds } from './word-count.js';
import { expectedReadSec, speechClockStarted, type PaceTarget } from './timer-pace.js';
import { getTimerState, getVisibleRemainingMs, subscribeTimer } from './timer-state.js';
import { autoScrollingView } from './auto-scroll.js';
import { nearestScroller } from './precise-scroll.js';
import { readingLineOffset } from './reading-line.js';

/** Height (px) of both bars, about two lines of text. */
const MARK_H = 40;

/** How the expected bar follows its target: exponential smoothing with this
 *  time constant (s), at no more than this speed (px/s), so a run of
 *  unhighlighted text is crossed quickly but in plain sight. */
const FOLLOW_TAU_S = 0.12;
const FOLLOW_MAX_PX_S = 1400;
/** How often (ms) the target is re-measured; the bar itself moves every frame. */
const RETARGET_MS = 100;

class Mark {
  readonly el = document.createElement('div');
  private host: HTMLElement | null = null;

  constructor(
    cls: string,
    private readonly onScroll: () => void,
  ) {
    this.el.className = `pmd-pace-mark ${cls}`;
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
  }

  /** Show it `height` px tall with its top at `contentTop` (px from the top
   *  of `scroller`'s scrollable content). */
  place(scroller: HTMLElement, contentTop: number, height: number): void {
    if (this.host !== scroller) {
      this.detach();
      scroller.appendChild(this.el);
      scroller.addEventListener('scroll', this.onScroll, { passive: true });
      this.host = scroller;
    }
    const top = Math.max(0, Math.min(contentTop, Math.max(0, scroller.scrollHeight - height)));
    this.el.style.top = `${top}px`;
    this.el.style.height = `${height}px`;
    this.el.hidden = false;
  }

  /** Same, with the top given in viewport px. */
  placeViewport(scroller: HTMLElement, viewportTop: number, height: number): void {
    const sr = scroller.getBoundingClientRect();
    this.place(scroller, viewportTop - sr.top - scroller.clientTop + scroller.scrollTop, height);
  }

  hide(): void {
    this.el.hidden = true;
    this.detach();
  }

  private detach(): void {
    this.host?.removeEventListener('scroll', this.onScroll);
    this.host = null;
    this.el.remove();
  }
}

interface Place {
  view: EditorView;
  pos: number;
}

let getTargetFn: (() => PaceTarget | null) | null = null;
let observed: Element | null = null;
let resizeObserver: ResizeObserver | null = null;

/** The expected bar's target (content coordinates of `scroller`) and where the
 *  bar is now. */
let expected: { view: EditorView; scroller: HTMLElement; targetY: number } | null = null;
let shownY: number | null = null;
let shownIn: HTMLElement | null = null;
let lastFrame = 0;
let lastTarget = -Infinity;
let frameId = 0;

const expectedMark = new Mark('pmd-pace-mark-expected', () => retargetSoon());
const prompterMark = new Mark('pmd-pace-mark-prompter', () => measurePrompter());

function retargetSoon(): void {
  lastTarget = -Infinity; // the next frame (or tick) re-measures
  if (expected && !frameId && typeof requestAnimationFrame === 'function') {
    frameId = requestAnimationFrame(frame);
  }
}

/** Viewport rect of the caret at `pos`, or null when it has none (not laid
 *  out, or hidden by read mode). */
function caretRect(view: EditorView, pos: number): { top: number; bottom: number; left: number } | null {
  const at = Math.max(0, Math.min(pos, view.state.doc.content.size));
  for (const side of [-1, 1]) {
    try {
      const r = view.coordsAtPos(at, side);
      if (r.bottom > r.top) return r;
    } catch {
      /* not laid out */
    }
  }
  return null;
}

/** Where the speaker should be by the clock, as a document position; null
 *  when there is nothing to show. */
function computeExpectedPos(): { view: EditorView; pos: number } | null {
  if (!settings.get('paceMarker')) return null;
  const timer = getTimerState();
  if (!speechClockStarted(timer)) return null;
  const reader = settings.get('readers')[0];
  const target = getTargetFn?.();
  if (!reader || !target) return null;
  const doc = target.view.state.doc;
  const totalSec = readTimeSeconds(docReadCounts(doc), reader, target.useLay);
  if (totalSec === null) return null;
  const sec = expectedReadSec({
    clockSec: getVisibleRemainingMs(timer) / 1000,
    totalSec,
    speechTotalSec: timer.speechTotalMs / 1000,
  });
  if (sec === null) return null;
  const pos = posAtReadSeconds(doc, sec, reader, target.useLay);
  return pos === null ? null : { view: target.view, pos };
}

/** Re-measure the expected bar's target. The vertical position slides along
 *  the line's height with how far across the line the caret is, so it runs
 *  on from the end of one line to the start of the next instead of stepping. */
function measureTarget(): void {
  const p = computeExpectedPos();
  const scroller = p && p.view.dom.isConnected ? nearestScroller(p.view.dom) : null;
  if (!p || !scroller) {
    expected = null;
    return;
  }
  const er = p.view.dom.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  const r = sr.height === 0 || er.width === 0 ? null : caretRect(p.view, p.pos);
  if (!r) {
    expected = null;
    return;
  }
  const frac = Math.max(0, Math.min(1, (r.left - er.left) / er.width));
  const viewportY = (r.top + r.bottom) / 2 + (frac - 0.5) * (r.bottom - r.top);
  expected = { view: p.view, scroller, targetY: viewportY - sr.top - scroller.clientTop + scroller.scrollTop };
}

/** One step of the expected bar: re-measure the target now and then, move the
 *  bar toward it, draw it. */
function step(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (now - lastTarget >= RETARGET_MS) {
    lastTarget = now;
    measureTarget();
    observe(expected?.view ?? null);
  }
  const e = expected;
  if (!e) {
    shownY = null;
    shownIn = null;
    expectedMark.hide();
    return;
  }
  if (shownY === null || shownIn !== e.scroller) {
    shownY = e.targetY;
    shownIn = e.scroller;
  } else {
    const diff = e.targetY - shownY;
    const move = diff * (1 - Math.exp(-dt / FOLLOW_TAU_S));
    const cap = FOLLOW_MAX_PX_S * dt;
    shownY += Math.max(-cap, Math.min(cap, move));
  }
  expectedMark.place(e.scroller, shownY - MARK_H / 2, MARK_H);
}

function frame(): void {
  frameId = 0;
  // `performance.now()`, not the frame's timestamp: `update` steps on the same clock.
  step(performance.now());
  // A paused clock whose bar has reached its target needs no more frames; a
  // scroll, resize or clock change restarts the loop (`retargetSoon`).
  const e = expected;
  const settled = e !== null && shownY !== null && Math.abs(e.targetY - shownY) < 0.3;
  if (e && !(settled && !getTimerState().running)) frameId = requestAnimationFrame(frame);
}

/** The Auto-Scroll bar is fixed on screen, so it is placed from geometry
 *  alone (cheap enough to run on every scroll event). */
function measurePrompter(): void {
  const view = settings.get('paceMarker') ? autoScrollingView() : null;
  const scroller = view && view.dom.isConnected ? nearestScroller(view.dom) : null;
  if (!view || !scroller) {
    prompterMark.hide();
    return;
  }
  const sr = scroller.getBoundingClientRect();
  const er = view.dom.getBoundingClientRect();
  if (sr.height === 0 || er.width === 0) {
    prompterMark.hide();
    return;
  }
  const scrolled = Math.max(0, sr.top - er.top);
  const y = Math.max(sr.top, er.top) + 6 + readingLineOffset(sr.height, scrolled);
  prompterMark.placeViewport(scroller, y - MARK_H / 2, MARK_H);
}

/** Re-measure when the editor's size changes (read mode, zoom, window). */
function observe(view: EditorView | null): void {
  const el = view?.dom ?? null;
  if (el === observed) return;
  if (observed) resizeObserver?.unobserve(observed);
  observed = el;
  if (el && typeof ResizeObserver !== 'undefined') {
    resizeObserver ??= new ResizeObserver(() => retargetSoon());
    resizeObserver.observe(el);
  }
}

function update(): void {
  // A frame only runs while the window is painting; this also covers a hidden
  // window, and starts the loop when the clock starts.
  step(performance.now());
  if (expected && !frameId && typeof requestAnimationFrame === 'function') {
    frameId = requestAnimationFrame(frame);
  }
  measurePrompter();
}

/** Re-place the bars now (after a lay toggle or Auto-Scroll start / stop). */
export function refreshPaceMarker(): void {
  if (!getTargetFn) return;
  retargetSoon();
  update();
}

/** Start the marker. `getTarget` is the same getter the pace row uses: the
 *  speech document's view (or the focused one) and its lay toggle. */
export function mountPaceMarker(getTarget: () => PaceTarget | null): void {
  if (getTargetFn) return;
  getTargetFn = getTarget;
  subscribeTimer(() => {
    retargetSoon();
    update();
  });
  settings.subscribe(() => {
    retargetSoon();
    update();
  });
  // The clock ticks, and Auto-Scroll starts and stops, without notifying us.
  window.setInterval(update, 1000);
  update();
}
