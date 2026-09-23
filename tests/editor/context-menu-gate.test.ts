// @vitest-environment jsdom
/** Context menus open on a right-click only (context-menu-gate.ts). */
import { describe, it, expect } from 'vitest';
import { isRightClickContextMenu } from '../../src/editor/context-menu-gate.js';

const ev = (init: MouseEventInit) => new MouseEvent('contextmenu', init);

describe('isRightClickContextMenu', () => {
  it('accepts the right button and a keyboard-invoked menu', () => {
    expect(isRightClickContextMenu(ev({ button: 2 }))).toBe(true);
    expect(isRightClickContextMenu(ev({ button: 0 }))).toBe(true); // menu key / Shift+F10
    expect(isRightClickContextMenu(ev({ button: 2, metaKey: true }))).toBe(true);
    expect(isRightClickContextMenu(ev({ button: 2, altKey: true, shiftKey: true }))).toBe(true);
  });

  it('refuses Ctrl+click however the browser reports its button', () => {
    expect(isRightClickContextMenu(ev({ button: 0, ctrlKey: true }))).toBe(false); // macOS Ctrl+click
    expect(isRightClickContextMenu(ev({ button: 2, ctrlKey: true }))).toBe(false);
  });
});
