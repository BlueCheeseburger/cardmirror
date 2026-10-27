// @vitest-environment jsdom
/**
 * The swap-on-drop setting: dropping a dragged title chip on an occupied
 * pane stacks by default; turning it on makes the drop swap instead.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { settings } from '../../src/editor/settings.js';

describe('swapOnPaneDrop setting', () => {
  beforeEach(() => {
    localStorage.clear();
    settings.set('swapOnPaneDrop', false);
  });

  it('is off by default, so a drop stacks', () => {
    expect(settings.get('swapOnPaneDrop')).toBe(false);
  });

  it('turns on, and round-trips through the saved settings', () => {
    settings.set('swapOnPaneDrop', true);
    expect(settings.get('swapOnPaneDrop')).toBe(true);
    expect(JSON.parse(localStorage.getItem('pmd-settings')!).swapOnPaneDrop).toBe(true);
  });

  it('treats anything that is not literally true as off', () => {
    localStorage.setItem('pmd-settings', JSON.stringify({ swapOnPaneDrop: 'yes' }));
    settings.replaceAll(JSON.parse(localStorage.getItem('pmd-settings')!));
    expect(settings.get('swapOnPaneDrop')).toBe(false);
  });
});
