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
  adjustAutoScrollSpeed,
  autoScrollSpeed,
  onAutoScrollSpeedChange,
  AUTO_SCROLL_MIN_WPM,
  AUTO_SCROLL_MAX_WPM,
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
    expect(velocityFromWindow(counts, READER, 300)).toBe(3); // MIN
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

  it('tells onStop whether the reader took over: scroll input yes, the button and Escape no', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const { scroller, editorDom } = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    const run = (stop: () => void): unknown => {
      __resetAutoScrollForTests();
      const onStop = vi.fn();
      startAutoScroll(makeView(editorDom), { wpm: 200 }, onStop);
      stop();
      expect(onStop).toHaveBeenCalledTimes(1);
      return onStop.mock.calls[0]?.[0];
    };
    expect(run(() => scroller.dispatchEvent(new Event('wheel')))).toBe(true);
    expect(run(() => scroller.dispatchEvent(new Event('pointerdown')))).toBe(true);
    expect(run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })))).toBe(true);
    expect(run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))).toBeFalsy();
    expect(run(() => stopAutoScroll())).toBeFalsy();
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

describe('reading line', () => {
  it('readingLineOffset eases down from the top to a third of the window', async () => {
    const { readingLineOffset } = await import('../../src/editor/reading-line.js');
    expect(readingLineOffset(600, 0)).toBe(0);
    expect(readingLineOffset(600, 80)).toBe(80);
    expect(readingLineOffset(600, 5000)).toBe(200);
  });
});

describe('Reading view pages', () => {
  it('pageReadSeconds times the words between the first column top and the last column bottom', async () => {
    const { pageReadSeconds } = await import('../../src/editor/auto-scroll.js');
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['card']!.createChecked(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('t')),
        schema.nodes['card_body']!.create(null, schema.text(words, [schema.marks['highlight']!.create({ color: 'yellow' })])),
      ]),
    ]);
    const { scroller, editorDom } = makeScroller({ scrollHeight: 600, clientHeight: 600 });
    const size = doc.content.size;
    const view = {
      dom: editorDom,
      state: { doc },
      posAtCoords: (c: { left: number; top: number }) => ({ pos: c.top < 100 ? 0 : size, inside: 0 }),
    } as unknown as EditorView;
    // 30 highlighted body words (+1 tag word) at 60 wpm (1 word/s) ≈ 31 s.
    const s = pageReadSeconds(view, scroller, { wpm: 60 });
    expect(s).toBeGreaterThan(29);
    expect(s).toBeLessThan(33);
    // A page that can't be measured falls back to a steady 20 s.
    const blind = { ...view, posAtCoords: () => null } as unknown as EditorView;
    expect(pageReadSeconds(blind, scroller, { wpm: 60 })).toBe(20);
  });
});

describe('auto-scroll behaviors found in testing', () => {
  it('paces at the lay rate when asked, and keeps a steady default for an unset lay rate', () => {
    const counts: ReadAloudCounts = { body: 15, other: 0 };
    const reader = { wpm: 60, layWpm: 30 };
    // flow: 15 words at 1 word/s = 15 s -> 300px/15s = 20 px/s; lay is half speed -> 10 px/s.
    expect(velocityFromWindow(counts, reader, 300, false)).toBe(20);
    expect(velocityFromWindow(counts, reader, 300, true)).toBe(10);
    expect(velocityFromWindow(counts, { wpm: 60 }, 300, true)).toBe(60); // lay not set up: FALLBACK, not the cap
  });

  it('Escape and the scroll keys hand control back; ordinary typing does not', () => {
    const { scroller, editorDom } = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    void scroller;
    for (const key of ['Escape', 'PageDown', 'End']) {
      __resetAutoScrollForTests();
      const view = makeView(editorDom);
      const onStop = vi.fn();
      expect(startAutoScroll(view, { wpm: 200 }, onStop)).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(onStop, key).toHaveBeenCalledTimes(1);
    }
    __resetAutoScrollForTests();
    const onStop = vi.fn();
    startAutoScroll(makeView(editorDom), { wpm: 200 }, onStop);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, bubbles: true }));
    expect(onStop).not.toHaveBeenCalled();
  });

  it('refuses to start when the reader is already at the end of the document', () => {
    const { scroller, editorDom } = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    Object.defineProperty(scroller, 'scrollTop', { value: 1500, writable: true, configurable: true });
    expect(startAutoScroll(makeView(editorDom), { wpm: 200 }, vi.fn())).toBe(false);
  });
});

describe('following the blue bar', () => {
  /** Frame callbacks captured instead of fired, so a test steps the loop by hand. */
  function captureFrames(): Array<(t: number) => void> {
    const frames: Array<(t: number) => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    return frames;
  }
  function liveScroller(): { scroller: HTMLElement; editorDom: HTMLElement } {
    const made = makeScroller({ scrollHeight: 4000, clientHeight: 600 });
    Object.defineProperty(made.scroller, 'scrollTop', { value: 0, writable: true, configurable: true });
    // The editor moves up as the scroller scrolls, like the real thing.
    made.editorDom.getBoundingClientRect = () =>
      ({ top: -made.scroller.scrollTop, bottom: 4000, left: 0, right: 200, width: 200, height: 4000 }) as unknown as DOMRect;
    return made;
  }
  const step = (frames: Array<(t: number) => void>): void => {
    const cb = frames.shift();
    cb?.(performance.now() + 100);
  };

  it('puts the blue bar on the reading line, and holds there while the bar holds', () => {
    const frames = captureFrames();
    const { scroller, editorDom } = liveScroller();
    const view = makeView(editorDom);
    const onStop = vi.fn();
    expect(
      startAutoScroll(view, { wpm: 200 }, onStop, {
        followClock: () => true,
        bar: () => ({ y: 500, pos: 1, atEnd: false }),
      }),
    ).toBe(true);
    step(frames);
    // Line = scrollTop + 6 + a third of the window (200) once past the top ease: 294 + 6 + 200.
    expect(scroller.scrollTop).toBe(294);
    step(frames);
    expect(scroller.scrollTop).toBe(294);
    expect(isAutoScrolling()).toBe(true);
  });

  it('moves with the bar and stops when the clock has run the bar to the end', () => {
    const frames = captureFrames();
    const { scroller, editorDom } = liveScroller();
    let bar = { y: 800, pos: 1, atEnd: false };
    const onStop = vi.fn();
    startAutoScroll(makeView(editorDom), { wpm: 200 }, onStop, { followClock: () => true, bar: () => bar });
    step(frames);
    const first = scroller.scrollTop;
    bar = { y: 1200, pos: 2, atEnd: false };
    step(frames);
    expect(scroller.scrollTop - first).toBe(400); // same distance the bar moved
    // Not stopped by getting near the bottom; only by the bar's own end.
    bar = { y: 3990, pos: 3, atEnd: true };
    step(frames);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(isAutoScrolling()).toBe(false);
  });

  it('keeps pacing by the reader’s own speed when the run did not start with the clock', () => {
    const frames = captureFrames();
    const { scroller, editorDom } = liveScroller();
    const bar = vi.fn(() => ({ y: 1500, pos: 1, atEnd: false }));
    startAutoScroll(makeView(editorDom), { wpm: 200 }, vi.fn(), { followClock: () => false, bar });
    step(frames);
    expect(bar).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBeLessThan(20); // the 60 px/s fallback for 0.1 s, not a jump to the bar
  });

  it('falls back to the reader’s own speed while the bar is not available', () => {
    const frames = captureFrames();
    const { scroller, editorDom } = liveScroller();
    startAutoScroll(makeView(editorDom), { wpm: 200 }, vi.fn(), { followClock: () => true, bar: () => null });
    step(frames);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(scroller.scrollTop).toBeLessThan(20);
  });
});

describe('speed buttons', () => {
  function frames(): { run: (n?: number) => void } {
    const queue: Array<(t: number) => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let t = performance.now();
    return {
      run: (n = 1) => {
        for (let i = 0; i < n; i++) {
          t += 100;
          queue.shift()?.(t);
        }
      },
    };
  }
  function live(): { scroller: HTMLElement; editorDom: HTMLElement } {
    const made = makeScroller({ scrollHeight: 4000, clientHeight: 600 });
    Object.defineProperty(made.scroller, 'scrollTop', { value: 0, writable: true, configurable: true });
    made.editorDom.getBoundingClientRect = () =>
      ({ top: -made.scroller.scrollTop, bottom: 4000, left: 0, right: 200, width: 200, height: 4000 }) as unknown as DOMRect;
    return made;
  }

  it('reports the reader’s pace, and nothing when not running', () => {
    expect(autoScrollSpeed()).toBeNull();
    frames();
    const { editorDom } = live();
    startAutoScroll(makeView(editorDom), { wpm: 240 }, vi.fn());
    expect(autoScrollSpeed()).toEqual({ wpm: 240, following: false });
    adjustAutoScrollSpeed(10);
    expect(autoScrollSpeed()?.wpm).toBe(250);
    adjustAutoScrollSpeed(-50);
    expect(autoScrollSpeed()?.wpm).toBe(200);
  });

  it('scrolls faster after speeding up, in proportion', () => {
    const f = frames();
    const { scroller, editorDom } = live();
    startAutoScroll(makeView(editorDom), { wpm: 200 }, vi.fn());
    f.run(); // 60 px/s fallback for 0.1 s
    const first = scroller.scrollTop;
    expect(first).toBeGreaterThan(5);
    expect(first).toBeLessThan(6.01);
    adjustAutoScrollSpeed(200); // 200 → 400 wpm: twice as fast
    f.run();
    expect(scroller.scrollTop - first).toBeCloseTo(12, 5);
  });

  it('keeps the pace in step with the lay rate when the document is on lay speaking', () => {
    frames();
    const { editorDom } = live();
    let lay = false;
    startAutoScroll(makeView(editorDom), { wpm: 200, layWpm: 120 }, vi.fn(), { useLay: () => lay });
    expect(autoScrollSpeed()?.wpm).toBe(200);
    lay = true;
    expect(autoScrollSpeed()?.wpm).toBe(120);
  });

  it('works while following the clock: it lets go of the blue bar and paces by speed', () => {
    const f = frames();
    const { scroller, editorDom } = live();
    const bar = vi.fn(() => ({ y: 900, pos: 1, atEnd: false }));
    startAutoScroll(makeView(editorDom), { wpm: 200 }, vi.fn(), { followClock: () => true, bar });
    f.run();
    expect(autoScrollSpeed()?.following).toBe(true);
    const onBar = scroller.scrollTop;
    expect(onBar).toBeGreaterThan(300); // put on the bar
    const calls = bar.mock.calls.length;
    adjustAutoScrollSpeed(10);
    expect(autoScrollSpeed()).toEqual({ wpm: 210, following: false });
    f.run(2);
    expect(bar.mock.calls.length).toBe(calls); // no longer asking the bar
    expect(scroller.scrollTop).toBeGreaterThan(onBar); // still scrolling, on from where it was
    expect(scroller.scrollTop - onBar).toBeLessThan(40);
    expect(isAutoScrolling()).toBe(true);
  });

  it('stays between the slowest and fastest pace', () => {
    frames();
    const { editorDom } = live();
    startAutoScroll(makeView(editorDom), { wpm: 200 }, vi.fn());
    adjustAutoScrollSpeed(-100000);
    expect(autoScrollSpeed()?.wpm).toBe(AUTO_SCROLL_MIN_WPM);
    adjustAutoScrollSpeed(100000);
    expect(autoScrollSpeed()?.wpm).toBe(AUTO_SCROLL_MAX_WPM);
  });

  it('tells listeners when a run starts, changes pace and stops', () => {
    frames();
    const { editorDom } = live();
    const seen: Array<number | null> = [];
    const off = onAutoScrollSpeedChange(() => seen.push(autoScrollSpeed()?.wpm ?? null));
    startAutoScroll(makeView(editorDom), { wpm: 200 }, vi.fn());
    adjustAutoScrollSpeed(10);
    stopAutoScroll();
    off();
    expect(seen).toEqual([200, 210, null]);
  });

  it('is a no-op when nothing is running', () => {
    expect(() => adjustAutoScrollSpeed(10)).not.toThrow();
  });
});

describe('scrollTopForReadingLine', () => {
  it('is the inverse of where the reading line sits', async () => {
    const { scrollTopForReadingLine, readingLineOffset } = await import('../../src/editor/reading-line.js');
    const H = 600;
    for (const editorTop of [0, 24]) {
      for (const scrollTop of [editorTop + 1, editorTop + 50, editorTop + 199, editorTop + 400, editorTop + 3000]) {
        const lineY = scrollTop + 6 + readingLineOffset(H, scrollTop - editorTop);
        expect(scrollTopForReadingLine(lineY, editorTop, H)).toBeCloseTo(scrollTop, 6);
      }
    }
  });

  it('stays at the top while the bar is on the first line', async () => {
    const { scrollTopForReadingLine } = await import('../../src/editor/reading-line.js');
    expect(scrollTopForReadingLine(10, 24, 600)).toBe(0);
    expect(scrollTopForReadingLine(30, 24, 600)).toBe(0);
  });
});
