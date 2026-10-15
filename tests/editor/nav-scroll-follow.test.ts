// @vitest-environment jsdom

/**
 * The outline highlight follows the heading at the reading line while the
 * reader scrolls (the caret doesn't move when you scroll, so it used to stay on
 * the heading the caret was last in). The caret still wins when it moves, a
 * jump from the outline keeps its row lit, and a deliberate multi-selection is
 * never touched. jsdom has no layout, so the scroller's geometry and
 * `posAtCoords` are stubbed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { NavigationPanel } from '../../src/editor/nav-panel.js';

const ids = { a: newHeadingId(), b: newHeadingId(), c: newHeadingId() };

function build() {
  const heading = (type: string, id: string, text: string) =>
    schema.nodes[type]!.create({ id }, schema.text(text));
  const doc = schema.nodes['doc']!.create(null, [
    heading('hat', ids.a, 'Alpha'),
    schema.nodes['paragraph']!.create(null, schema.text('one')),
    heading('hat', ids.b, 'Beta'),
    schema.nodes['paragraph']!.create(null, schema.text('two')),
    heading('hat', ids.c, 'Gamma'),
    schema.nodes['paragraph']!.create(null, schema.text('three')),
  ]);
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  document.body.appendChild(scroller);
  const host = document.createElement('div');
  scroller.appendChild(host);
  const view = new EditorView(host, { state: EditorState.create({ doc }) });
  // Layout stubs: a 600px-tall window over a taller editor.
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON() {} }) as DOMRect;
  scroller.getBoundingClientRect = () => rect(0, 600);
  view.dom.getBoundingClientRect = () => rect(-400, 3000);
  // Where the reading line lands in the doc; tests move it.
  const hit = { pos: 1 };
  view.posAtCoords = () => ({ pos: hit.pos, inside: hit.pos });
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const panel = new NavigationPanel(parent);
  panel.attach(view);
  return { view, panel, scroller, hit, doc };
}

function lit(panel: NavigationPanel): string[] {
  return [...((panel as unknown as { selectedIds: Set<string> }).selectedIds)];
}

function posOf(doc: ReturnType<typeof build>['doc'], text: string): number {
  let found = -1;
  doc.descendants((n, pos) => {
    if (found < 0 && n.isText && n.text === text) found = pos + 1;
  });
  return found;
}

// Frames run when a test flushes them, like a browser: never before the
// requestAnimationFrame call that scheduled them returns.
let realRaf: typeof requestAnimationFrame;
let frames: Array<() => void> = [];
const flushFrames = (): void => {
  const due = frames;
  frames = [];
  for (const run of due) run();
};
beforeEach(() => {
  realRaf = window.requestAnimationFrame;
  frames = [];
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(() => cb(0));
    return frames.length;
  }) as typeof requestAnimationFrame;
});
afterEach(() => {
  window.requestAnimationFrame = realRaf;
  document.body.innerHTML = '';
});

/** A scroll event, then the animation frame it schedules. */
const scrollEvent = (scroller: HTMLElement): void => {
  scroller.dispatchEvent(new Event('scroll'));
  flushFrames();
};
const scrollWithWheel = (scroller: HTMLElement): void => {
  scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
  scrollEvent(scroller);
};

describe('outline highlight follows the reading line while scrolling', () => {
  it('moves to the heading at the reading line after a wheel scroll', () => {
    const { panel, scroller, hit, doc, view } = build();
    panel.setCaretHeading(posOf(doc, 'Alpha')); // caret in Alpha
    expect(lit(panel)).toEqual([ids.a]);
    hit.pos = posOf(doc, 'three'); // scrolled down to Gamma's section
    scrollWithWheel(scroller);
    expect(lit(panel)).toEqual([ids.c]);
    hit.pos = posOf(doc, 'two');
    scrollWithWheel(scroller);
    expect(lit(panel)).toEqual([ids.b]);
    panel.destroy();
    view.destroy();
  });

  it('ignores scrolling the caret caused: no scroll input, no change', () => {
    const { panel, scroller, hit, doc, view } = build();
    panel.setCaretHeading(posOf(doc, 'Beta')); // typing / a jump put the caret in Beta
    hit.pos = posOf(doc, 'three'); // …and the scroll-into-view left the reading line in Gamma
    scrollEvent(scroller); // no wheel, key or scrollbar drag
    expect(lit(panel)).toEqual([ids.b]);
    panel.destroy();
    view.destroy();
  });

  it('a caret move disarms it until the next scroll input', () => {
    const { panel, scroller, hit, doc, view } = build();
    hit.pos = posOf(doc, 'three');
    scrollWithWheel(scroller);
    expect(lit(panel)).toEqual([ids.c]);
    panel.setCaretHeading(posOf(doc, 'Alpha')); // click in Alpha
    hit.pos = posOf(doc, 'two');
    scrollEvent(scroller);
    expect(lit(panel)).toEqual([ids.a]);
    scrollWithWheel(scroller); // the reader scrolls again
    expect(lit(panel)).toEqual([ids.b]);
    panel.destroy();
    view.destroy();
  });

  it('a scroll key arms it, and so does pressing the scrollbar', () => {
    const { panel, scroller, hit, doc, view } = build();
    panel.setCaretHeading(posOf(doc, 'Alpha'));
    hit.pos = posOf(doc, 'two');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    scrollEvent(scroller);
    expect(lit(panel)).toEqual([ids.b]);
    panel.setCaretHeading(posOf(doc, 'Alpha'));
    hit.pos = posOf(doc, 'three');
    scroller.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    scrollEvent(scroller);
    expect(lit(panel)).toEqual([ids.c]);
    panel.destroy();
    view.destroy();
  });

  it('leaves a deliberate multi-selection alone', () => {
    const { panel, scroller, hit, doc, view } = build();
    (panel as unknown as { selectedIds: Set<string> }).selectedIds = new Set([ids.a, ids.b]);
    hit.pos = posOf(doc, 'three');
    scrollWithWheel(scroller);
    expect(lit(panel).sort()).toEqual([ids.a, ids.b].sort());
    panel.destroy();
    view.destroy();
  });

  it("ignores another scroller's scroll events", () => {
    const { panel, hit, doc, view } = build();
    panel.setCaretHeading(posOf(doc, 'Alpha'));
    hit.pos = posOf(doc, 'three');
    const other = document.createElement('div');
    document.body.appendChild(other);
    other.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    scrollEvent(other);
    expect(lit(panel)).toEqual([ids.a]);
    panel.destroy();
    view.destroy();
  });

  it('stops listening once destroyed', () => {
    const { panel, scroller, hit, doc, view } = build();
    panel.destroy();
    hit.pos = posOf(doc, 'three');
    expect(() => scrollWithWheel(scroller)).not.toThrow();
    view.destroy();
  });
});
