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
});
