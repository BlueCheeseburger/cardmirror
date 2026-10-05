// @vitest-environment jsdom
/**
 * The palette's width: centered on the window at full width, and it no longer
 * shrinks to fit a narrow pane.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { quickCardSearchUI } from '../../src/editor/quick-card-search-ui.js';

function openPalette(): void {
  quickCardSearchUI.open({ view: null, runCommand: () => {}, openFilePath: () => {} });
}

describe('palette width', () => {
  afterEach(() => {
    if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
    document.body.innerHTML = '';
  });

  it('is centered on the window at full width, wherever the focused pane is', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    openPalette();
    const root = document.querySelector<HTMLElement>('.pmd-qcs')!;
    expect(root.style.width).toBe('540px');
    expect(root.style.left).toBe('600px');
  });

  it('shrinks only when the window itself is narrower than the bar', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    openPalette();
    const root = document.querySelector<HTMLElement>('.pmd-qcs')!;
    expect(root.style.width).toBe('376px');
    expect(root.style.left).toBe('200px');
  });
});
