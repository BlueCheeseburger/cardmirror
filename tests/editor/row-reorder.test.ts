// @vitest-environment jsdom
/**
 * Drag-to-reorder for list rows (row-reorder.ts): no handles, and deliberately
 * stiff, so a click that wanders or a hand that drifts moves nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachRowReorder, ROW_DRAGGING_CLASS, LIST_REORDERING_CLASS } from '../../src/editor/row-reorder.js';

const ROW_H = 30;
let list: HTMLElement;
let detach: () => void;
let onReorder: ReturnType<typeof vi.fn>;

const rows = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>(':scope > .row')];
const names = (): string[] => rows().map((r) => r.dataset['n']!);

function pointer(type: string, y: number, target: EventTarget = document): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, clientY: y, pointerId: 1, isPrimary: true, button: 0 }),
  );
}
/** Press on row `i`, drag to `toY` (in steps), and let go (unless `hold`). */
function drag(i: number, toY: number, hold = false): void {
  const startY = i * ROW_H + ROW_H / 2;
  pointer('pointerdown', startY, rows()[i]!);
  const step = toY > startY ? 2 : -2;
  for (let y = startY; step > 0 ? y < toY : y > toY; y += step) pointer('pointermove', y);
  pointer('pointermove', toY);
  if (!hold) pointer('pointerup', toY);
}

beforeEach(() => {
  list = document.createElement('div');
  for (const n of ['A', 'B', 'C', 'D']) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset['n'] = n;
    const btn = document.createElement('button');
    btn.className = 'close';
    row.appendChild(btn);
    list.appendChild(row);
  }
  document.body.appendChild(list);
  // jsdom has no layout: every row is ROW_H tall.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ height: ROW_H, width: 100, top: 0, left: 0, right: 100, bottom: ROW_H, x: 0, y: 0, toJSON() {} }) as DOMRect,
  );
  onReorder = vi.fn();
  detach = attachRowReorder(list, { rows, ignore: '.close', onReorder });
});

afterEach(() => {
  detach();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('attachRowReorder', () => {
  it('a press that barely moves is still a click: nothing drags', () => {
    drag(0, ROW_H / 2 + 8); // 8px, under the 16px threshold
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    expect(onReorder).not.toHaveBeenCalled();
    expect(rows()[0]!.classList.contains(ROW_DRAGGING_CLASS)).toBe(false);
  });

  it('a click after a short wobble still reaches the row', () => {
    const clicked = vi.fn();
    rows()[0]!.addEventListener('click', clicked);
    drag(0, ROW_H / 2 + 6);
    rows()[0]!.click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('is stiff: dragging past the threshold but not far into the neighbour does not swap', () => {
    drag(0, ROW_H / 2 + 20); // over the threshold, under 80% of a row (24px)
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('swaps once the row has moved far enough past its neighbour', () => {
    drag(0, ROW_H / 2 + 28);
    expect(names()).toEqual(['B', 'A', 'C', 'D']);
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('a long drag moves it several places, in one reorder', () => {
    drag(0, ROW_H / 2 + 3 * ROW_H);
    expect(names()).toEqual(['B', 'C', 'D', 'A']);
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(0, 3);
  });

  it('drags upward too', () => {
    drag(3, 3 * ROW_H + ROW_H / 2 - 2 * ROW_H - 4);
    expect(names()).toEqual(['A', 'D', 'B', 'C']);
    expect(onReorder).toHaveBeenCalledWith(3, 1);
  });

  it('dragging back to where it started is no reorder', () => {
    const startY = ROW_H / 2;
    pointer('pointerdown', startY, rows()[0]!);
    for (let y = startY; y <= startY + 44; y += 2) pointer('pointermove', y);
    expect(names()).toEqual(['B', 'A', 'C', 'D']);
    for (let y = startY + 44; y >= startY; y -= 2) pointer('pointermove', y);
    pointer('pointerup', startY);
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('shows the drag while it is going and clears it on drop', () => {
    drag(0, ROW_H / 2 + 28, true);
    const held = list.querySelector<HTMLElement>('.' + ROW_DRAGGING_CLASS)!;
    expect(held.dataset['n']).toBe('A');
    expect(held.style.transform).toMatch(/^translateY\(/);
    expect(list.classList.contains(LIST_REORDERING_CLASS)).toBe(true);
    pointer('pointerup', ROW_H / 2 + 28);
    expect(held.style.transform).toBe('');
    expect(list.classList.contains(LIST_REORDERING_CLASS)).toBe(false);
    expect(list.querySelector('.' + ROW_DRAGGING_CLASS)).toBeNull();
  });

  it('Escape puts everything back and commits nothing', () => {
    drag(0, ROW_H / 2 + 70, true);
    expect(names()).not.toEqual(['A', 'B', 'C', 'D']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    pointer('pointerup', ROW_H / 2 + 70);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('a cancelled pointer puts everything back too', () => {
    drag(1, 1 * ROW_H + ROW_H / 2 - 40, true);
    pointer('pointercancel', 0);
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('swallows the click that follows a drop, so the row under it is not picked', () => {
    const clicked = vi.fn();
    list.addEventListener('click', clicked);
    drag(0, ROW_H / 2 + 28);
    rows()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).not.toHaveBeenCalled();
  });

  it('presses on the ignored control never start a drag', () => {
    const startY = ROW_H / 2;
    pointer('pointerdown', startY, rows()[0]!.querySelector('.close')!);
    for (let y = startY; y < startY + 60; y += 2) pointer('pointermove', y);
    pointer('pointerup', startY + 60);
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('only the primary button drags', () => {
    rows()[0]!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 15, pointerId: 1, isPrimary: true, button: 2 }));
    for (let y = 15; y < 80; y += 2) pointer('pointermove', y);
    pointer('pointerup', 80);
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('stops listening once detached', () => {
    detach();
    drag(0, ROW_H / 2 + 70);
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    expect(onReorder).not.toHaveBeenCalled();
  });
});
