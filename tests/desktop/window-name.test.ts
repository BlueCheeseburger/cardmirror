import { describe, expect, it } from 'vitest';
import { normalizeWindowName } from '../../apps/desktop/src/window-name.js';

describe('normalizeWindowName', () => {
  it('trims a name', () => {
    expect(normalizeWindowName('  10-29 debate ')).toBe('10-29 debate');
  });
  it('treats blank or non-string input as no name (which clears it)', () => {
    expect(normalizeWindowName('')).toBeNull();
    expect(normalizeWindowName('   ')).toBeNull();
    expect(normalizeWindowName(null)).toBeNull();
    expect(normalizeWindowName(undefined)).toBeNull();
    expect(normalizeWindowName(42)).toBeNull();
  });
});
