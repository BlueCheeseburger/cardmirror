// @vitest-environment jsdom
/**
 * The "Left" read-time segment counts from where the document is
 * SCROLLED to (the line at the top edge of the window), not from the
 * cursor. jsdom has no layout, so the scroller and editor rectangles and
 * the hit test are stubbed.
 */
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  remainingReadSegment,
  remainingReadCounts,
  scrollAnchorPos,
  watchScrollForRemaining,
} from '../../src/editor/live-read-time.js';
import { settings } from '../../src/editor/settings.js';
import { totalWords } from '../../src/editor/word-count.js';

function card(tagText: string, bodyText: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tagText)),
    schema.nodes['card_body']!.create(null, schema.text(bodyText)),
  ]);
}

const doc = schema.nodes['doc']!.createChecked(null, [
  card('Alpha', 'one two three four five six seven eight'),
  card('Beta', 'nine ten eleven twelve'),
  card('Gamma', 'thirteen fourteen'),
]);

/** Document position at the start of the text `needle`. */
function posOf(needle: string): number {
  let found = -1;
  doc.descendants((n, pos) => {
    if (found < 0 && n.isText && n.text!.includes(needle)) found = pos + n.text!.indexOf(needle);
    return true;
  });
  return found;
}

function rect(top: number, height: number, left = 0, width = 800): DOMRect {
  return { top, height, left, width, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

/** A fake view inside an `overflow-y: auto` scroller. `hit` answers the
 *  coordinate lookup and records what it was asked. */
function fakeView(opts: { scroller: DOMRect; editor: DOMRect; hit: number | null }): {
  view: EditorView;
  asked: Array<{ left: number; top: number }>;
  scroller: HTMLElement;
} {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  const dom = document.createElement('div');
  scroller.appendChild(dom);
  document.body.appendChild(scroller);
  scroller.getBoundingClientRect = () => opts.scroller;
  dom.getBoundingClientRect = () => opts.editor;
  const asked: Array<{ left: number; top: number }> = [];
  const view = {
    dom,
    posAtCoords: (c: { left: number; top: number }) => {
      asked.push(c);
      return opts.hit === null ? null : { pos: opts.hit, inside: opts.hit };
    },
  } as unknown as EditorView;
  return { view, asked, scroller };
}

const leftOf = (counts: ReturnType<typeof remainingReadCounts>): number => totalWords(counts!);

beforeEach(() => {
  settings.set('liveRemainingReadTime', true);
  settings.set('readers', [
    { name: 'Amy', wpm: 200 },
    { name: 'Ben', wpm: 100 },
  ]);
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  settings.set('liveRemainingReadTime', false);
});

describe('scrollAnchorPos', () => {
  it('asks for the line a third of the way down the window when the doc is scrolled', () => {
    // The editor's top is 500px above the window's: the window is mid-document,
    // so the reading line sits the full third (600 / 3 = 200px) below its top.
    const { view, asked } = fakeView({ scroller: rect(100, 600), editor: rect(-400, 2000, 50, 700), hit: 42 });
    expect(scrollAnchorPos(view)).toBe(42);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.top).toBe(100 + 6 + 200);
    expect(asked[0]!.left).toBe(400); // the middle of the text column
  });

  it('eases the line down from the top over the first third of scrolling', () => {
    // Scrolled only 60px: nothing much has been read, so the line is 60px down.
    const { view, asked } = fakeView({ scroller: rect(100, 600), editor: rect(40, 2000, 50, 700), hit: 7 });
    scrollAnchorPos(view);
    expect(asked[0]!.top).toBe(100 + 6 + 60);
  });

  it('anchors to the editor top when the document starts inside the window', () => {
    const { view, asked } = fakeView({ scroller: rect(100, 600), editor: rect(140, 300, 50, 700), hit: 1 });
    scrollAnchorPos(view);
    expect(asked[0]!.top).toBe(146);
  });

  it('is null with no scroller, a hidden pane, or a missed hit test', () => {
    const lone = { dom: document.createElement('div'), posAtCoords: () => ({ pos: 5, inside: 5 }) } as unknown as EditorView;
    expect(scrollAnchorPos(lone)).toBeNull();
    expect(scrollAnchorPos(fakeView({ scroller: rect(0, 0), editor: rect(0, 0, 0, 0), hit: 5 }).view)).toBeNull();
    expect(scrollAnchorPos(fakeView({ scroller: rect(0, 600), editor: rect(0, 900), hit: null }).view)).toBeNull();
  });
});

describe('scrollAnchorPos in Reading view', () => {
  it('aims at the first column of the page in view, a third of the way down', async () => {
    const { applyReaderViewToTarget, readerControllerFor } = await import('../../src/editor/reader-view.js');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dom = document.createElement('div');
    dom.className = 'ProseMirror';
    host.appendChild(dom);
    const asked: Array<{ left: number; top: number }> = [];
    const view = {
      dom,
      state: { tr: { setMeta() { return {}; } } },
      setProps() {},
      dispatch() {},
      posAtCoords: (c: { left: number; top: number }) => {
        asked.push(c);
        return { pos: 11, inside: 11 };
      },
    } as unknown as EditorView;
    host.style.overflowY = 'auto';
    host.getBoundingClientRect = () => rect(0, 600, 0, 900);
    dom.getBoundingClientRect = () => rect(0, 600, -2000, 9000); // a wide strip scrolled sideways
    applyReaderViewToTarget(host, view, true);
    expect(readerControllerFor(view)).not.toBeNull();
    expect(scrollAnchorPos(view)).toBe(11);
    expect(asked[0]!.top).toBe(200);
    expect(asked[0]!.left).toBeLessThan(150); // the first column, not the strip's middle
    applyReaderViewToTarget(host, view, false);
  });
});

describe('remainingReadSegment follows the scroll, not the cursor', () => {
  const cursorAtStart = (): EditorState => EditorState.create({ doc, selection: TextSelection.atStart(doc) });

  it('counts from the scrolled-to line even with the cursor elsewhere', () => {
    const state = cursorAtStart();
    const atBeta = fakeView({ scroller: rect(0, 600), editor: rect(-400, 2000), hit: posOf('nine') }).view;
    const atGamma = fakeView({ scroller: rect(0, 600), editor: rect(-900, 2000), hit: posOf('thirteen') }).view;
    const fromStart = leftOf(remainingReadCounts(state));
    const fromBeta = leftOf(remainingReadCounts(state, atBeta));
    const fromGamma = leftOf(remainingReadCounts(state, atGamma));
    expect(fromBeta).toBeLessThan(fromStart);
    expect(fromGamma).toBeLessThan(fromBeta);
  });

  it('moving the cursor does not change it', () => {
    const view = fakeView({ scroller: rect(0, 600), editor: rect(-400, 2000), hit: posOf('nine') }).view;
    const a = remainingReadSegment(cursorAtStart(), false, view);
    const moved = EditorState.create({ doc, selection: TextSelection.create(doc, posOf('fourteen')) });
    expect(remainingReadSegment(moved, false, view)).toBe(a);
  });

  it('falls back to the cursor when the scroll position cannot be measured', () => {
    const hidden = fakeView({ scroller: rect(0, 0), editor: rect(0, 0, 0, 0), hit: 5 }).view;
    const moved = EditorState.create({ doc, selection: TextSelection.create(doc, posOf('nine')) });
    expect(remainingReadSegment(moved, false, hidden)).toBe(remainingReadSegment(moved));
  });

  it('is off with the setting off', () => {
    settings.set('liveRemainingReadTime', false);
    const view = fakeView({ scroller: rect(0, 600), editor: rect(-400, 2000), hit: 10 }).view;
    expect(remainingReadSegment(cursorAtStart(), false, view)).toBeNull();
  });
});

describe('watchScrollForRemaining', () => {
  it('refreshes once after a burst of scroll events, and stops when disposed', () => {
    vi.useFakeTimers();
    const scroller = document.createElement('div');
    const refresh = vi.fn();
    const dispose = watchScrollForRemaining(scroller, refresh);
    for (let i = 0; i < 5; i++) scroller.dispatchEvent(new Event('scroll'));
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(refresh).toHaveBeenCalledTimes(1);
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(120);
    expect(refresh).toHaveBeenCalledTimes(2);
    dispose();
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(120);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does nothing while the segment is off', () => {
    vi.useFakeTimers();
    settings.set('liveRemainingReadTime', false);
    const scroller = document.createElement('div');
    const refresh = vi.fn();
    watchScrollForRemaining(scroller, refresh);
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(500);
    expect(refresh).not.toHaveBeenCalled();
  });
});
