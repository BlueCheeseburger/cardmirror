// @vitest-environment jsdom
/**
 * The skip-names spellcheck setting: on by default, listed in the settings
 * screen, and togglable whether or not Editor spellcheck is on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { settings, SETTING_METADATA } from '../../src/editor/settings.js';

describe('spellcheckSkipNames setting', () => {
  beforeEach(() => {
    localStorage.clear();
    settings.replaceAll({});
  });

  it('is on by default', () => {
    expect(settings.get('spellcheckSkipNames')).toBe(true);
  });

  it('has a toggle in the settings list that is not gated on Editor spellcheck', () => {
    const meta = SETTING_METADATA.find((m) => m.key === 'spellcheckSkipNames');
    expect(meta?.kind).toBe('toggle');
    expect(meta?.dependsOn).toBeUndefined();
  });

  it('turns off, and an older save without the key still reads as on', () => {
    settings.set('spellcheckSkipNames', false);
    expect(settings.get('spellcheckSkipNames')).toBe(false);
    settings.replaceAll({ editorSpellcheck: true });
    expect(settings.get('spellcheckSkipNames')).toBe(true);
  });
});
