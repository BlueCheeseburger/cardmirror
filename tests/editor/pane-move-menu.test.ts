// @vitest-environment jsdom

/**
 * "Move to…" — the right-click menu on a pane's title chip that
 * reaches a doc into a window chip-drag can't: another live
 * multi-pane window, entirely.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { installMoveMenuTrigger } from '../../src/editor/pane-move-menu.js';

function makeChip(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pmd-pane-chip';
  document.body.appendChild(el);
  return el;
}

function rightClick(el: HTMLElement, x = 40, y = 40): void {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  el.dispatchEvent(e);
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  // The menu defers its own close-listener registration by a real
  // macrotask (same reasoning as image/nav-panel context menus: so the
  // right-click's own mousedown doesn't immediately close what it just
  // opened) — a microtask flush alone leaves Escape/outside-click inert.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  // Several cases above deliberately leave a menu open (they're
  // testing that it opened, not exercising a close path) — close
  // whatever's left the real way, through the module's own Escape
  // handling, so its `window`-level mousedown/keydown listeners don't
  // accumulate across tests. (A harmless no-op when nothing is open —
  // nothing is listening.)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});

describe('pane move menu', () => {
  it('lists each candidate window plus New Window', async () => {
    const chip = makeChip();
    const onPick = vi.fn();
    installMoveMenuTrigger(chip, {
      canMove: () => true,
      listCandidates: () =>
        Promise.resolve([
          { id: 7, label: 'Round 3 — CardMirror' },
          { id: 9, label: 'Blocks' },
        ]),
      onPick,
    });
    rightClick(chip);
    await flush();

    const items = Array.from(document.querySelectorAll('.pmd-nav-context-item')).map(
      (el) => el.textContent,
    );
    expect(items).toEqual([
      'Move to “Round 3 — CardMirror”',
      'Move to “Blocks”',
      'Move to New Window',
    ]);
  });

  it('clicking a candidate picks its window id', async () => {
    const chip = makeChip();
    const onPick = vi.fn();
    installMoveMenuTrigger(chip, {
      canMove: () => true,
      listCandidates: () => Promise.resolve([{ id: 7, label: 'Round 3' }]),
      onPick,
    });
    rightClick(chip);
    await flush();

    document.querySelectorAll('.pmd-nav-context-item')[0]!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(onPick).toHaveBeenCalledWith(7);
    // The menu closes itself on pick.
    expect(document.querySelector('.pmd-nav-context-menu')).toBeNull();
  });

  it('clicking "Move to New Window" picks the new-window sentinel', async () => {
    const chip = makeChip();
    const onPick = vi.fn();
    installMoveMenuTrigger(chip, {
      canMove: () => true,
      listCandidates: () => Promise.resolve([]),
      onPick,
    });
    rightClick(chip);
    await flush();

    const items = document.querySelectorAll('.pmd-nav-context-item');
    expect(items).toHaveLength(1);
    items[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('new-window');
  });

  it('shows only "Move to New Window" with zero other windows', async () => {
    const chip = makeChip();
    installMoveMenuTrigger(chip, {
      canMove: () => true,
      listCandidates: () => Promise.resolve([]),
      onPick: vi.fn(),
    });
    rightClick(chip);
    await flush();
    const items = document.querySelectorAll('.pmd-nav-context-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toBe('Move to New Window');
  });

  it('does not open when canMove() is false — an empty or expanded pane', async () => {
    const chip = makeChip();
    const listCandidates = vi.fn(() => Promise.resolve([]));
    installMoveMenuTrigger(chip, { canMove: () => false, listCandidates, onPick: vi.fn() });
    rightClick(chip);
    await flush();
    expect(listCandidates).not.toHaveBeenCalled();
    expect(document.querySelector('.pmd-nav-context-menu')).toBeNull();
  });

  it('Escape closes the menu without picking anything', async () => {
    const chip = makeChip();
    const onPick = vi.fn();
    installMoveMenuTrigger(chip, {
      canMove: () => true,
      listCandidates: () => Promise.resolve([{ id: 1, label: 'X' }]),
      onPick,
    });
    rightClick(chip);
    await flush();
    expect(document.querySelector('.pmd-nav-context-menu')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.pmd-nav-context-menu')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('a right-click elsewhere re-opening the menu does not leave two open', async () => {
    const chipA = makeChip();
    const chipB = makeChip();
    installMoveMenuTrigger(chipA, {
      canMove: () => true,
      listCandidates: () => Promise.resolve([{ id: 1, label: 'A target' }]),
      onPick: vi.fn(),
    });
    installMoveMenuTrigger(chipB, {
      canMove: () => true,
      listCandidates: () => Promise.resolve([{ id: 2, label: 'B target' }]),
      onPick: vi.fn(),
    });
    rightClick(chipA);
    await flush();
    rightClick(chipB);
    await flush();
    expect(document.querySelectorAll('.pmd-nav-context-menu')).toHaveLength(1);
    expect(document.body.textContent).toContain('B target');
  });

  it('a right-click on another chip before the first resolves never leaves an orphaned menu', async () => {
    // Two chips right-clicked back-to-back, BEFORE either's async
    // listCandidates() resolves — the real race a slow IPC round trip
    // to main can produce. Whichever resolves last must be the only
    // one that ends up in the DOM; the other must contribute nothing,
    // not an unclosable leftover.
    const chipA = makeChip();
    const chipB = makeChip();
    let resolveA!: (v: import('../../src/editor/pane-move-menu.js').MoveMenuCandidate[]) => void;
    const pendingA = new Promise<import('../../src/editor/pane-move-menu.js').MoveMenuCandidate[]>(
      (r) => (resolveA = r),
    );
    installMoveMenuTrigger(chipA, { canMove: () => true, listCandidates: () => pendingA, onPick: vi.fn() });
    installMoveMenuTrigger(chipB, {
      canMove: () => true,
      listCandidates: () => Promise.resolve([{ id: 2, label: 'B target' }]),
      onPick: vi.fn(),
    });

    rightClick(chipA); // starts, but pendingA never resolves yet
    rightClick(chipB); // supersedes it, and resolves quickly
    await flush();
    expect(document.querySelectorAll('.pmd-nav-context-menu')).toHaveLength(1);
    expect(document.body.textContent).toContain('B target');

    // A's stale listCandidates() finally resolves — must not append
    // a second, orphaned menu now that B owns the slot.
    resolveA([{ id: 1, label: 'A target' }]);
    await flush();
    expect(document.querySelectorAll('.pmd-nav-context-menu')).toHaveLength(1);
    expect(document.body.textContent).toContain('B target');
  });

  it('re-checks canMove() after the candidate list resolves — a pane that emptied in the meantime shows no menu', async () => {
    const chip = makeChip();
    let movable = true;
    installMoveMenuTrigger(chip, {
      canMove: () => movable,
      listCandidates: () => {
        // The pane's doc closes WHILE this (IPC-bound, in reality) call
        // is in flight.
        movable = false;
        return Promise.resolve([{ id: 1, label: 'X' }]);
      },
      onPick: vi.fn(),
    });
    rightClick(chip);
    await flush();
    expect(document.querySelector('.pmd-nav-context-menu')).toBeNull();
  });

  it('preventDefault() lets a more specific contextmenu handler win', () => {
    const chip = makeChip();
    const listCandidates = vi.fn(() => Promise.resolve([]));
    // Something upstream (bubble order irrelevant here — same target)
    // already called preventDefault on this exact event.
    installMoveMenuTrigger(chip, { canMove: () => true, listCandidates, onPick: vi.fn() });
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    e.preventDefault();
    chip.dispatchEvent(e);
    expect(listCandidates).not.toHaveBeenCalled();
  });
});
