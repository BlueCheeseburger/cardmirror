import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isLaySpeakingForPath, setLaySpeakingForPath } from '../../src/editor/lay-speaking-store.js';

function installStorage(): void {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
}

describe('lay-speaking-store', () => {
  beforeEach(installStorage);

  it('defaults to flow and remembers lay per path', () => {
    expect(isLaySpeakingForPath('/a.docx')).toBe(false);
    setLaySpeakingForPath('/a.docx', true);
    expect(isLaySpeakingForPath('/a.docx')).toBe(true);
    expect(isLaySpeakingForPath('/b.docx')).toBe(false);
    setLaySpeakingForPath('/a.docx', false);
    expect(isLaySpeakingForPath('/a.docx')).toBe(false);
  });

  it('ignores non-string paths', () => {
    setLaySpeakingForPath(null, true);
    expect(isLaySpeakingForPath(null)).toBe(false);
    expect(localStorage.getItem('pmd-lay-speaking-paths')).toBeNull();
  });

  it('a file you switched keeps its own choice whatever the default is', () => {
    setLaySpeakingForPath('/lay.docx', true);
    setLaySpeakingForPath('/flow.docx', false);
    // Default flow: untouched files follow it, touched ones keep theirs.
    expect(isLaySpeakingForPath('/new.docx', false)).toBe(false);
    expect(isLaySpeakingForPath('/lay.docx', false)).toBe(true);
    // Default lay: an untouched file follows it; a file left on flow stays on flow.
    expect(isLaySpeakingForPath('/new.docx', true)).toBe(true);
    expect(isLaySpeakingForPath('/flow.docx', true)).toBe(false);
    expect(isLaySpeakingForPath('/lay.docx', true)).toBe(true);
  });

  it('a file with no path (new or unsaved) takes the default', () => {
    expect(isLaySpeakingForPath(null, true)).toBe(true);
    expect(isLaySpeakingForPath(undefined, false)).toBe(false);
    expect(isLaySpeakingForPath('', true)).toBe(true);
  });

  it('switching back and forth leaves one entry per file', () => {
    setLaySpeakingForPath('/a.docx', true);
    setLaySpeakingForPath('/a.docx', false);
    setLaySpeakingForPath('/a.docx', true);
    expect(JSON.parse(localStorage.getItem('pmd-lay-speaking-paths')!)).toEqual(['/a.docx']);
    expect(JSON.parse(localStorage.getItem('pmd-flow-speaking-paths')!)).toEqual([]);
  });

  it('files remembered as lay by an older version still open on lay', () => {
    localStorage.setItem('pmd-lay-speaking-paths', JSON.stringify(['/old.docx']));
    expect(isLaySpeakingForPath('/old.docx', false)).toBe(true);
    expect(isLaySpeakingForPath('/old.docx', true)).toBe(true);
  });
});
