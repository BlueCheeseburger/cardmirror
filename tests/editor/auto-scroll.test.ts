// @vitest-environment jsdom

/**
 * Paced auto-scroll (`src/editor/auto-scroll.ts`).
 *
 * jsdom has no layout engine, so `posAtCoords` / real scroll geometry
 * can't be exercised (same limitation `scroll-anchor.test.ts` notes).
 * Instead: `velocityFromWindow` — the pure math converting a window's
 * read-aloud word counts into a scroll speed — is tested directly, and
 * `startAutoScroll` / `stopAutoScroll`'s state machine is driven with a
 * scripted view + a real (but geometry-stubbed) scroller element, with
 * `requestAnimationFrame` stubbed to never actually fire (this suite
 * tests the start/stop lifecycle, not the frame-by-frame tick).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  velocityFromWindow,
  startAutoScroll,
  stopAutoScroll,
  isAutoScrolling,
  autoScrollingView,
  stopAutoScrollIfOtherView,
  __resetAutoScrollForTests,
} from '../../src/editor/auto-scroll.js';
import type { ReadAloudCounts } from '../../src/editor/word-count.js';

afterEach(() => {
  __resetAutoScrollForTests();
  vi.unstubAllGlobals();
});

describe('velocityFromWindow (pure pacing math)', () => {
  const READER = { wpm: 60 }; // 1 word/sec — easy arithmetic

  it('a window with no read-aloud words at all skims at the cap', () => {
    const counts: ReadAloudCounts = { body: 0, other: 0 };
    expect(velocityFromWindow(counts, READER, 300)).toBe(900); // MAX
  });

  it('paces a highlighted-only window to exactly cover it in its read time', () => {
    // 15 body words at 1 word/sec = 15s to read; 300px / 15s = 20px/s.
    const counts: ReadAloudCounts = { body: 15, other: 0 };
    expect(velocityFromWindow(counts, READER, 300)).toBe(20);
  });

  it('denser highlighted text scrolls slower than sparser text', () => {
    const sparse: ReadAloudCounts = { body: 5, other: 0 };
    const dense: ReadAloudCounts = { body: 50, other: 0 };
    const vSparse = velocityFromWindow(sparse, READER, 300);
    const vDense = velocityFromWindow(dense, READER, 300);
    expect(vDense).toBeLessThan(vSparse);
  });

  it('a separate tagWpm speeds up (or slows down) just the tag/cite portion', () => {
    const counts: ReadAloudCounts = { body: 0, other: 15 };
    // other at wpm=60 (1 word/s): 15s → 300px/15s = 20px/s.
    expect(velocityFromWindow(counts, { wpm: 60 }, 300)).toBe(20);
    // other at tagWpm=300 (5 words/s): 3s → 300px/3s = 100px/s — faster.
    expect(velocityFromWindow(counts, { wpm: 60, tagWpm: 300 }, 300)).toBe(100);
  });

  it('clamps to the floor for an extremely dense window', () => {
    const counts: ReadAloudCounts = { body: 100000, other: 0 };
    expect(velocityFromWindow(counts, READER, 300)).toBe(12); // MIN
  });

  it('clamps to the ceiling for an implausibly fast reader', () => {
    const counts: ReadAloudCounts = { body: 1, other: 0 };
    expect(velocityFromWindow(counts, { wpm: 1_000_000 }, 300)).toBe(900); // MAX
  });
});

/** A real (jsdom) scrollable container with a child standing in for
 *  `view.dom`, geometry stubbed since jsdom has no layout engine. */
function makeScroller(opts: { scrollHeight: number; clientHeight: number }): {
  scroller: HTMLElement;
  editorDom: HTMLElement;
} {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto'; // nearestScroller walks parentElement looking for this
  const editorDom = document.createElement('div');
  scroller.appendChild(editorDom);
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, 'scrollHeight', { value: opts.scrollHeight, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: opts.clientHeight, configurable: true });
  scroller.getBoundingClientRect = () =>
    ({ top: 0, bottom: opts.clientHeight, left: 0, right: 200, width: 200, height: opts.clientHeight }) as unknown as DOMRect;
  editorDom.getBoundingClientRect = () =>
    ({ top: 0, bottom: opts.scrollHeight, left: 0, right: 200, width: 200, height: opts.scrollHeight }) as unknown as DOMRect;
  return { scroller, editorDom };
}

function makeView(editorDom: HTMLElement): EditorView {
  const doc = schema.nodes['doc']!.createChecked(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('a tag')),
      schema.nodes['card_body']!.create(null, schema.text('body text')),
    ]),
  ]);
  return {
    dom: editorDom,
    state: { doc },
    isDestroyed: false,
    posAtCoords: () => null, // never resolves — tick() would fall back, but rAF never fires in these tests
  } as unknown as EditorView;
}

describe('startAutoScroll / stopAutoScroll (lifecycle)', () => {
  it('does not start when the scroller has nothing left to scroll', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const { editorDom } = makeScroller({ scrollHeight: 100, clientHeight: 100 });
    const view = makeView(editorDom);
    const onStop = vi.fn();
    expect(startAutoScroll(view, { wpm: 200 }, onStop)).toBe(false);
    expect(isAutoScrolling()).toBe(false);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('starts when there is room to scroll, and rejects a second concurrent start', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const { editorDom } = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    const view = makeView(editorDom);
    const onStop = vi.fn();
    expect(startAutoScroll(view, { wpm: 200 }, onStop)).toBe(true);
    expect(isAutoScrolling()).toBe(true);
    expect(autoScrollingView()).toBe(view);

    // A second view trying to start while one is already running is refused.
    const { editorDom: editorDom2 } = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    const view2 = makeView(editorDom2);
    expect(startAutoScroll(view2, { wpm: 200 }, vi.fn())).toBe(false);
  });

  it('stopAutoScroll() tears down and fires onStop exactly once', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const { editorDom } = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    const view = makeView(editorDom);
    const onStop = vi.fn();
    startAutoScroll(view, { wpm: 200 }, onStop);

    stopAutoScroll();
    expect(isAutoScrolling()).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);

    // Stopping again (nothing running) is a harmless no-op.
    stopAutoScroll();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('a manual wheel scroll interrupts and stops it', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const { scroller, editorDom } = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    const view = makeView(editorDom);
    const onStop = vi.fn();
    startAutoScroll(view, { wpm: 200 }, onStop);
    expect(isAutoScrolling()).toBe(true);

    scroller.dispatchEvent(new Event('wheel'));
    expect(isAutoScrolling()).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('stopAutoScrollIfOtherView leaves the same view running, stops a different one', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const { editorDom } = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    const view = makeView(editorDom);
    const onStop = vi.fn();
    startAutoScroll(view, { wpm: 200 }, onStop);

    stopAutoScrollIfOtherView(view);
    expect(isAutoScrolling()).toBe(true);
    expect(onStop).not.toHaveBeenCalled();

    const otherView = { ...view } as unknown as EditorView;
    stopAutoScrollIfOtherView(otherView);
    expect(isAutoScrolling()).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
