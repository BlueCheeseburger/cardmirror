/**
 * Per-preset card-number handling for the derived saves (user request
 * 2026-09-19): Send and Marked Docs freeze by default and can be switched
 * to remove (Read Docs keep every heading, so they keep live numbering); the Custom save offers freeze / remove as an
 * exclusive pair.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { settings, SETTING_METADATA } from '../../src/editor/settings.js';

const KEYS = ['sendDocNumbering', 'markedDocNumbering'] as const;

afterEach(() => {
  for (const k of KEYS) settings.set(k, 'freeze');
});

describe('*DocNumbering settings', () => {
  it('default to freeze and accept remove', () => {
    for (const k of KEYS) expect(settings.get(k)).toBe('freeze');
    settings.set('sendDocNumbering', 'remove');
    expect(settings.get('sendDocNumbering')).toBe('remove');
    expect(settings.get('markedDocNumbering'), 'independent per preset').toBe('freeze');
  });

  it('sit directly under their doc type\'s format setting in the Files tab; Read Doc has none', () => {
    const keys = SETTING_METADATA.map((m) => m.key as string);
    expect(keys.indexOf('sendDocNumbering')).toBe(keys.indexOf('sendDocFormat') + 1);
    expect(keys.indexOf('markedDocNumbering')).toBe(keys.indexOf('markedDocFormat') + 1);
    expect(keys).not.toContain('readDocNumbering');
    for (const k of KEYS) {
      const meta = SETTING_METADATA.find((m) => m.key === k)!;
      expect(meta.kind).toBe('numberingExport');
      expect(meta.category).toBe('files');
      expect(meta.section).toBe('Send / Read / Marked docs');
    }
  });
});
