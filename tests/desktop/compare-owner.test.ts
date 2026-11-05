import { describe, expect, it } from 'vitest';
import { compareWindowToNotify } from '../../apps/desktop/src/compare-owner.js';

describe('compareWindowToNotify', () => {
  const comparing = new Set([5]);

  it('names the Compare window a file was taken from', () => {
    expect(compareWindowToNotify(5, 9, comparing)).toBe(5);
  });
  it('says nothing for an ordinary editor window, a first claim, or a window re-claiming its own file', () => {
    expect(compareWindowToNotify(4, 9, comparing)).toBeUndefined();
    expect(compareWindowToNotify(undefined, 9, comparing)).toBeUndefined();
    // Reload From Disk re-registers from the same window, even if it is in Compare.
    expect(compareWindowToNotify(5, 5, comparing)).toBeUndefined();
  });
  it('says nothing once Compare has closed', () => {
    expect(compareWindowToNotify(5, 9, new Set())).toBeUndefined();
  });
});
