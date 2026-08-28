import { describe, it, expect } from 'vitest';
import { SettingsStore } from '../../src/editor/settings.js';

// SettingsStore tolerates the absence of localStorage / window (its
// load + persist are try/caught), so a fresh instance boots to DEFAULTS
// in the node test env — same setup as settings-backup.test.ts.

describe('docTheme (independent document background)', () => {
  it('defaults to light, matching the pre-existing themeAppliesToDocument=false behavior', () => {
    const s = new SettingsStore();
    expect(s.get('docTheme')).toBe('light');
  });

  it('accepts all three values', () => {
    const s = new SettingsStore();
    for (const v of ['light', 'dark', 'followApp'] as const) {
      s.set('docTheme', v);
      expect(s.get('docTheme')).toBe(v);
    }
  });

  describe('migration from the legacy themeAppliesToDocument boolean', () => {
    it('true migrates to followApp (old "doc follows chrome theme" behavior)', () => {
      const s = new SettingsStore();
      s.replaceAll({ themeAppliesToDocument: true });
      expect(s.get('docTheme')).toBe('followApp');
    });

    it('false migrates to light (old default: doc always stays light)', () => {
      const s = new SettingsStore();
      s.replaceAll({ themeAppliesToDocument: false });
      expect(s.get('docTheme')).toBe('light');
    });

    it('absent (pre-existing install with neither key) defaults to light', () => {
      const s = new SettingsStore();
      s.replaceAll({});
      expect(s.get('docTheme')).toBe('light');
    });

    it('an explicit docTheme value wins once the legacy boolean is genuinely absent', () => {
      // A real post-migration install never persists themeAppliesToDocument
      // again (it's not in DEFAULTS or the Settings type), so this is the
      // realistic shape: only docTheme present.
      const s = new SettingsStore();
      s.replaceAll({ docTheme: 'dark' });
      expect(s.get('docTheme')).toBe('dark');
    });

    it('a malformed docTheme value (no legacy key) falls back to light', () => {
      const s = new SettingsStore();
      s.replaceAll({ docTheme: 'bogus' });
      expect(s.get('docTheme')).toBe('light');
    });
  });
});
