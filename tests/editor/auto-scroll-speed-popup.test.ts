// @vitest-environment jsdom

/** The Auto-Scroll speed popup: shows while a run is going, buttons change the pace. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  __resetAutoScrollForTests,
  autoScrollSpeed,
  startAutoScroll,
  stopAutoScroll,
} from '../../src/editor/auto-scroll.js';
import {
  __resetAutoScrollSpeedPopupForTests,
  mountAutoScrollSpeedPopup,
  SPEED_STEP_BIG_WPM,
  SPEED_STEP_WPM,
} from '../../src/editor/auto-scroll-speed-popup.js';

function startRun(): void {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  const dom = document.createElement('div');
  scroller.appendChild(dom);
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, 'scrollHeight', { value: 4000, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  const doc = schema.nodes['doc']!.createChecked(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('a tag')),
      schema.nodes['card_body']!.create(null, schema.text('body text')),
    ]),
  ]);
  const view = { dom, state: { doc }, isDestroyed: false, posAtCoords: () => null } as unknown as EditorView;
  expect(startAutoScroll(view, { wpm: 200 }, vi.fn())).toBe(true);
}

const popup = (): HTMLElement | null => document.querySelector('.pmd-as-popup');
const btn = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('.pmd-as-popup button')].find((b) => b.title.startsWith(label))!;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => {
  __resetAutoScrollSpeedPopupForTests();
  __resetAutoScrollForTests();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('Auto-Scroll speed popup', () => {
  it('appears while Auto-Scroll runs and goes when it stops', () => {
    mountAutoScrollSpeedPopup();
    expect(popup()).toBeNull();
    startRun();
    expect(popup()).not.toBeNull();
    expect(popup()!.querySelector('big')!.textContent).toBe('200');
    stopAutoScroll();
    expect(popup()).toBeNull();
  });

  it('the faster and slower buttons change the pace, and Shift takes a bigger step', () => {
    mountAutoScrollSpeedPopup();
    startRun();
    btn('Faster').click();
    expect(popup()!.querySelector('big')!.textContent).toBe(String(200 + SPEED_STEP_WPM));
    btn('Slower').click();
    btn('Slower').click();
    expect(autoScrollSpeed()?.wpm).toBe(200 - SPEED_STEP_WPM);
    btn('Faster').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(autoScrollSpeed()?.wpm).toBe(200 - SPEED_STEP_WPM + SPEED_STEP_BIG_WPM);
  });

  it('Stop stops the run', () => {
    mountAutoScrollSpeedPopup();
    startRun();
    btn('Stop').click();
    expect(autoScrollSpeed()).toBeNull();
    expect(popup()).toBeNull();
  });

  it('can be dragged, stays on screen, and remembers where it was left', () => {
    mountAutoScrollSpeedPopup();
    startRun();
    const head = popup()!.querySelector<HTMLElement>('.pmd-as-head')!;
    popup()!.getBoundingClientRect = () => ({ left: 100, top: 100, width: 232, height: 90 }) as DOMRect;
    const ev = (type: string, x: number, y: number): PointerEvent =>
      Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 }) as unknown as PointerEvent;
    head.dispatchEvent(ev('pointerdown', 120, 110));
    head.dispatchEvent(ev('pointermove', 320, 210));
    expect(popup()!.style.left).toBe('300px');
    expect(popup()!.style.top).toBe('200px');
    head.dispatchEvent(ev('pointermove', -500, -500));
    expect(popup()!.style.left).toBe('8px'); // not off the left edge
    head.dispatchEvent(ev('pointerup', -500, -500));
    expect(localStorage.getItem('cm.autoScrollPopupPos')).not.toBeNull();
  });

  it('says whether it is following the timer', () => {
    mountAutoScrollSpeedPopup();
    startRun();
    expect(popup()!.querySelector('.pmd-as-note')!.textContent).toBe('Your pace');
  });
});
