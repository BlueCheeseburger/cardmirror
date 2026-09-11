// @vitest-environment jsdom
/**
 * The card-cutter experiment is console-gated: while it is off, NONE of
 * its commands may surface in the discovery surfaces (command bar,
 * keybindings editor, printed reference, custom-button and Morph pickers).
 * The context / guidance commands used to slip through (field report
 * 2026-09-09) — only the launcher was gated.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { settings } from '../../src/editor/settings.js';
import { isRibbonCommandAvailable, availableRibbonCommandIds } from '../../src/editor/ribbon-availability.js';
import { RIBBON_GROUPS } from '../../src/editor/ribbon-groups.js';

const cutterGroup = RIBBON_GROUPS.find((g) => g.title === 'Card cutter')!;

afterEach(() => settings.set('cardCutterEnabled', false));

describe('card-cutter gate', () => {
  it('the ribbon group holds the three commands', () => {
    expect(cutterGroup).toBeTruthy();
    expect([...cutterGroup.commands]).toEqual(['openCardCutter', 'addCutterContext', 'openCutterGuidance']);
  });

  it('off (the default): every command in the group is unavailable and absent from the available list', () => {
    expect(settings.get('cardCutterEnabled')).toBe(false);
    for (const id of cutterGroup.commands) {
      expect(isRibbonCommandAvailable(id), id).toBe(false);
      expect(availableRibbonCommandIds(), id).not.toContain(id);
    }
  });

  it('on: every command in the group becomes available', () => {
    settings.set('cardCutterEnabled', true);
    for (const id of cutterGroup.commands) {
      expect(isRibbonCommandAvailable(id), id).toBe(true);
      expect(availableRibbonCommandIds(), id).toContain(id);
    }
  });
});
