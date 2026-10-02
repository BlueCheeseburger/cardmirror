/** Mod-Shift-X is Strikethrough by default; the AI cite creator that used it is unbound. */
import { describe, it, expect } from 'vitest';
import { DEFAULT_RIBBON_KEYS } from '../../src/editor/ribbon-commands.js';

describe('Mod-Shift-X', () => {
  it('belongs to Strikethrough, and nothing else', () => {
    expect(DEFAULT_RIBBON_KEYS.toggleStrikethrough).toBe('Mod-Shift-x');
    expect(DEFAULT_RIBBON_KEYS.aiCreateCite).toBe('');
    const owners = Object.entries(DEFAULT_RIBBON_KEYS).filter(([, k]) =>
      (Array.isArray(k) ? k : [k]).some((key) => key.toLowerCase() === 'mod-shift-x'),
    );
    expect(owners.map(([id]) => id)).toEqual(['toggleStrikethrough']);
  });
});
