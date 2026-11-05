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

import { mustKeepWindowName } from '../../apps/desktop/src/window-name.js';

describe('mustKeepWindowName', () => {
  it('overrides a page title that differs from the window name', () => {
    expect(mustKeepWindowName('10-29 debate', 'CardMirror')).toBe(true);
    expect(mustKeepWindowName('10-29 debate', 'Case.docx — CardMirror')).toBe(true);
  });
  it('lets the page title through when it already is the name', () => {
    expect(mustKeepWindowName('10-29 debate', '10-29 debate')).toBe(false);
  });
  it('leaves an unnamed window to follow its page', () => {
    expect(mustKeepWindowName(undefined, 'Case.docx — CardMirror')).toBe(false);
    expect(mustKeepWindowName(null, 'CardMirror')).toBe(false);
    expect(mustKeepWindowName('', 'CardMirror')).toBe(false);
  });
});
