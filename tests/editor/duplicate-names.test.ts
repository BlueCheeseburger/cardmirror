import { describe, expect, it } from 'vitest';
import { duplicateNamePaths } from '../../src/editor/duplicate-names.js';

describe('duplicateNamePaths', () => {
  it('shows paths only for names shared by 2+ docs', () => {
    const m = duplicateNamePaths([
      { uid: 'a', filename: 'Stocks DA.docx', handle: '/x/Stocks DA.docx' },
      { uid: 'b', filename: 'stocks da.docx', handle: '/y/Stocks DA.docx' },
      { uid: 'c', filename: 'Other.docx', handle: '/x/Other.docx' },
    ]);
    expect([...m.keys()].sort()).toEqual(['a', 'b']);
    expect(m.get('b')).toBe('/y/Stocks DA.docx');
  });
  it('skips never-saved docs and unique names', () => {
    const m = duplicateNamePaths([
      { uid: 'a', filename: 'Untitled', handle: null },
      { uid: 'b', filename: 'Untitled', handle: '/z/Untitled' },
    ]);
    expect([...m.keys()]).toEqual(['b']);
    expect(duplicateNamePaths([{ uid: 'a', filename: 'A', handle: '/a' }]).size).toBe(0);
  });
});
