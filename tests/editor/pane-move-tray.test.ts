// @vitest-environment jsdom

/**
 * Move tray (src/editor/pane-move-tray.ts): the bottom strip shown while a
 * pane's title chip is dragged. Every tile is a drop target keyed by
 * `data-move-target`; the tray only draws and lights up the hovered one.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { describeMoveTarget, showMoveTray, windowTarget, type MoveTraySlot } from '../../src/editor/pane-move-tray.js';

const slots: MoveTraySlot[] = [
  { id: 'slot1', num: 1, name: '1AC Case', source: false },
  { id: 'slot2', num: 2, name: 'Health DA', source: true },
  { id: 'slot3', num: 3, name: null, source: false },
];
const windows = [{ id: 7, label: 'Window 7' }];

afterEach(() => {
  document.body.innerHTML = '';
});

const tile = (target: string): HTMLElement | null => document.querySelector(`[data-move-target="${target}"]`);

describe('describeMoveTarget', () => {
  it('says what dropping would do', () => {
    expect(describeMoveTarget('slot1', slots, windows)).toBe('Swap with 1AC Case');
    expect(describeMoveTarget('slot3', slots, windows)).toBe('Move to slot 3');
    expect(describeMoveTarget('win:new', slots, windows)).toBe('Open in a new window');
    expect(describeMoveTarget(windowTarget(7), slots, windows)).toBe('Send to Window 7');
    expect(describeMoveTarget('nope', slots, windows)).toBe('');
  });
});

describe('showMoveTray', () => {
  it('draws a tile per slot, a new-window tile and one per other window', () => {
    showMoveTray(slots, windows);
    expect(tile('slot1')).not.toBeNull();
    expect(tile('slot2')?.classList.contains('pmd-move-tile-source')).toBe(true);
    expect(tile('slot3')?.classList.contains('pmd-move-tile-empty')).toBe(true);
    expect(tile('win:new')).not.toBeNull();
    expect(tile('win:7')).not.toBeNull();
  });

  it('offers this window’s slots only when windows are unavailable', () => {
    showMoveTray(slots, [], false);
    expect(tile('slot1')).not.toBeNull();
    expect(tile('win:new')).toBeNull();
  });

  it('lights up the hovered tile, and moves the light when it changes', () => {
    const tray = showMoveTray(slots, windows);
    tray.setHover('slot1');
    expect(tile('slot1')?.classList.contains('pmd-move-tile-hot')).toBe(true);
    tray.setHover('win:new');
    expect(tile('slot1')?.classList.contains('pmd-move-tile-hot')).toBe(false);
    expect(tile('win:new')?.classList.contains('pmd-move-tile-hot')).toBe(true);
    tray.setHover(null);
    expect(document.querySelector('.pmd-move-tile-hot')).toBeNull();
  });

  it('adds windows found late and keeps the hover on a tile that was already lit', () => {
    const tray = showMoveTray(slots, []);
    expect(tile('win:7')).toBeNull();
    tray.setHover('win:new');
    tray.setWindows(windows);
    expect(tile('win:7')).not.toBeNull();
    expect(tile('win:new')?.classList.contains('pmd-move-tile-hot')).toBe(true);
  });

  it('removes itself', () => {
    const tray = showMoveTray(slots, windows);
    tray.destroy();
    expect(document.querySelector('.pmd-move-tray')).toBeNull();
  });
});
