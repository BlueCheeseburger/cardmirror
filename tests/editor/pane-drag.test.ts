// @vitest-environment jsdom

/**
 * Chip drag (src/editor/pane-drag.ts): the gesture that moves a doc
 * between multi-pane slots. What matters here is that it stays out of
 * the way of the chip's other affordances — a click still clicks, a
 * double-click still renames — and that every way out of the gesture
 * cleans up, including the ones that don't end in a drop.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { installPaneChipDrag, isPaneChipDragging } from '../../src/editor/pane-drag.js';

/** jsdom has no PointerEvent; a MouseEvent carrying a pointerId is
 *  indistinguishable to the code under test. */
function pointer(type: string, x: number, y: number, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
    ...init,
  });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
}

interface Harness {
  chip: HTMLElement;
  opts: {
    canDrag: ReturnType<typeof vi.fn>;
    label: ReturnType<typeof vi.fn>;
    slotAtPoint: ReturnType<typeof vi.fn>;
    onDragStart: ReturnType<typeof vi.fn>;
    onDragEnd: ReturnType<typeof vi.fn>;
    onHover: ReturnType<typeof vi.fn>;
    onDrop: ReturnType<typeof vi.fn>;
  };
}

function setup(over: string | null = 'slot2'): Harness {
  const chip = document.createElement('div');
  chip.className = 'pmd-pane-chip';
  const btn = document.createElement('button');
  btn.className = 'pmd-pane-chip-close';
  chip.appendChild(btn);
  document.body.appendChild(chip);
  const opts = {
    canDrag: vi.fn(() => true),
    label: vi.fn(() => '1nc.docx'),
    slotAtPoint: vi.fn(() => over),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onHover: vi.fn(),
    onDrop: vi.fn(),
  };
  installPaneChipDrag(chip, opts);
  return { chip, opts };
}

function ghost(): HTMLElement | null {
  return document.querySelector('.pmd-pane-drag-ghost');
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('pane chip drag', () => {
  it('drags a doc onto another slot', () => {
    const { chip, opts } = setup('slot3');
    chip.dispatchEvent(pointer('pointerdown', 10, 10));
    chip.dispatchEvent(pointer('pointermove', 40, 12));
    expect(opts.onDragStart).toHaveBeenCalledTimes(1);
    expect(ghost()?.textContent).toBe('1nc.docx');
    expect(opts.onHover).toHaveBeenLastCalledWith('slot3');

    chip.dispatchEvent(pointer('pointerup', 40, 12));
    expect(opts.onDrop).toHaveBeenCalledWith('slot3');
    expect(opts.onDragEnd).toHaveBeenCalledTimes(1);
    expect(ghost()).toBeNull();
    expect(isPaneChipDragging()).toBe(false);
  });

  it('cleans the drag up BEFORE committing the move', () => {
    // The commit re-lays-out the row (a slot empties, another gains a
    // doc). Dropping the drag dressing first means it never has to be
    // unwound from a layout that has since changed underneath it.
    const order: string[] = [];
    const { chip, opts } = setup('slot2');
    opts.onDragEnd.mockImplementation(() => order.push('end'));
    opts.onDrop.mockImplementation(() => order.push('drop'));
    chip.dispatchEvent(pointer('pointerdown', 0, 0));
    chip.dispatchEvent(pointer('pointermove', 30, 0));
    chip.dispatchEvent(pointer('pointerup', 30, 0));
    expect(order).toEqual(['end', 'drop']);
  });

  it('a small move is a click, not a drag', () => {
    const { chip, opts } = setup();
    chip.dispatchEvent(pointer('pointerdown', 10, 10));
    chip.dispatchEvent(pointer('pointermove', 13, 12));
    chip.dispatchEvent(pointer('pointerup', 13, 12));
    expect(opts.onDragStart).not.toHaveBeenCalled();
    expect(opts.onDrop).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();
  });

  it('never starts on one of the chip’s own buttons', () => {
    const { chip, opts } = setup();
    const btn = chip.querySelector('button')!;
    btn.dispatchEvent(pointer('pointerdown', 10, 10));
    chip.dispatchEvent(pointer('pointermove', 60, 10));
    expect(opts.onDragStart).not.toHaveBeenCalled();
  });

  it('dropping over nothing moves nothing', () => {
    const { chip, opts } = setup(null);
    chip.dispatchEvent(pointer('pointerdown', 0, 0));
    chip.dispatchEvent(pointer('pointermove', 30, 0));
    chip.dispatchEvent(pointer('pointerup', 30, 0));
    expect(opts.onDrop).not.toHaveBeenCalled();
    expect(opts.onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('Escape abandons the drag without moving anything', () => {
    const { chip, opts } = setup('slot2');
    chip.dispatchEvent(pointer('pointerdown', 0, 0));
    chip.dispatchEvent(pointer('pointermove', 30, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(opts.onDragEnd).toHaveBeenCalledTimes(1);
    expect(ghost()).toBeNull();

    chip.dispatchEvent(pointer('pointerup', 30, 0));
    expect(opts.onDrop).not.toHaveBeenCalled();
  });

  it('a cancelled pointer (window blur, touch interrupted) tears down', () => {
    const { chip, opts } = setup('slot2');
    chip.dispatchEvent(pointer('pointerdown', 0, 0));
    chip.dispatchEvent(pointer('pointermove', 30, 0));
    chip.dispatchEvent(pointer('pointercancel', 30, 0));
    expect(opts.onDrop).not.toHaveBeenCalled();
    expect(opts.onDragEnd).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('pmd-pane-dragging')).toBe(false);
  });

  it('refuses to start when the workspace says it can’t drag', () => {
    const { chip, opts } = setup();
    opts.canDrag.mockReturnValue(false);
    chip.dispatchEvent(pointer('pointerdown', 0, 0));
    chip.dispatchEvent(pointer('pointermove', 60, 0));
    expect(opts.onDragStart).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();
  });

  it('reports hover only when it changes', () => {
    const { chip, opts } = setup('slot2');
    chip.dispatchEvent(pointer('pointerdown', 0, 0));
    chip.dispatchEvent(pointer('pointermove', 30, 0));
    chip.dispatchEvent(pointer('pointermove', 35, 0));
    chip.dispatchEvent(pointer('pointermove', 40, 0));
    expect(opts.onHover).toHaveBeenCalledTimes(1);
  });

  it('keeps tracking once the pointer leaves the chip', () => {
    // The whole point of the gesture is to end up over ANOTHER pane —
    // tracking that only listened on the chip would lose the pointer
    // the moment it mattered.
    const { chip, opts } = setup('slot3');
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    chip.dispatchEvent(pointer('pointerdown', 0, 0));
    elsewhere.dispatchEvent(pointer('pointermove', 200, 300));
    expect(opts.onDragStart).toHaveBeenCalledTimes(1);
    elsewhere.dispatchEvent(pointer('pointerup', 200, 300));
    expect(opts.onDrop).toHaveBeenCalledWith('slot3');
  });

  it('ignores a non-primary button', () => {
    const { chip, opts } = setup();
    chip.dispatchEvent(pointer('pointerdown', 0, 0, { button: 2 }));
    chip.dispatchEvent(pointer('pointermove', 60, 0));
    expect(opts.onDragStart).not.toHaveBeenCalled();
  });
});
