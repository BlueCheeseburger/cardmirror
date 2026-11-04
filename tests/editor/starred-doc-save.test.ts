/**
 * Starred Doc is a full save preset like Send / Read / Marked Doc: it has its
 * own filename prefix, destination, folder, format and card-number settings, and
 * a Save Starred Doc command. These pin that it stays level with the others.
 */

import { describe, expect, it } from 'vitest';
import { settings, SETTING_METADATA, effectiveDocTypeFormat } from '../../src/editor/settings.js';
import {
  RIBBON_COMMAND_IDS,
  RIBBON_COMMAND_LABELS,
  DEFAULT_RIBBON_KEYS,
} from '../../src/editor/ribbon-commands.js';
import { RIBBON_GROUPS } from '../../src/editor/ribbon-groups.js';

const SECTION = 'Send / Read / Marked / Starred docs';
const meta = (key: string) => SETTING_METADATA.find((m) => m.key === key)!;
const keys = SETTING_METADATA.map((m) => m.key as string);

describe('Starred Doc settings', () => {
  it('default like the other doc types, and the prefix is STARRED_', () => {
    expect(settings.get('starredDocPrefix')).toBe('STARRED_');
    expect(settings.get('starredDocDestination')).toBe('sameFolder');
    expect(settings.get('starredDocFolder')).toBe('');
    expect(settings.get('starredDocFormat')).toBe('docx');
    expect(settings.get('starredDocNumbering')).toBe('freeze');
  });

  it('are in the Files tab section, each of its kind, in the same order as the other doc types', () => {
    for (const k of ['starredDocPrefix', 'starredDocDestination', 'starredDocFolder', 'starredDocFormat', 'starredDocNumbering']) {
      expect(meta(k), k).toBeTruthy();
      expect(meta(k).category).toBe('files');
      expect(meta(k).section).toBe(SECTION);
    }
    expect(meta('starredDocPrefix').kind).toBe('text');
    expect(meta('starredDocPrefix').dependsOn).toBe('prefixPresetSaveFilenames');
    expect(meta('starredDocDestination').kind).toBe('starredDocDestination');
    expect(meta('starredDocFolder').kind).toBe('folder');
    expect(meta('starredDocFormat').kind).toBe('docTypeFormat');
    expect(meta('starredDocNumbering').kind).toBe('numberingExport');
    // Folder row follows the destination row; format and numbering follow the folder.
    expect(keys.indexOf('starredDocFolder')).toBe(keys.indexOf('starredDocDestination') + 1);
    expect(keys.indexOf('starredDocFormat')).toBe(keys.indexOf('starredDocFolder') + 1);
    expect(keys.indexOf('starredDocNumbering')).toBe(keys.indexOf('starredDocFormat') + 1);
    // The prefix sits with the other three prefixes.
    expect(keys.indexOf('starredDocPrefix')).toBe(keys.indexOf('markedDocPrefix') + 1);
  });

  it('the destination and folder are desktop-only, the format and numbering are not (the dialog fallback honors them)', () => {
    expect(meta('starredDocDestination').electronOnly).toBe(true);
    expect(meta('starredDocFolder').electronOnly).toBe(true);
    expect(meta('starredDocFormat').electronOnly).toBeFalsy();
    expect(meta('starredDocNumbering').electronOnly).toBeFalsy();
  });

  it('"Same as new documents" follows the new-document format', () => {
    settings.set('starredDocFormat', 'default');
    settings.set('defaultSaveFormat', 'cmir');
    expect(effectiveDocTypeFormat('starredDocFormat')).toBe('cmir');
    settings.set('starredDocFormat', 'docx');
    settings.set('defaultSaveFormat', 'docx');
    expect(effectiveDocTypeFormat('starredDocFormat')).toBe('docx');
  });

  it('the prefix toggle\'s description names Starred Doc', () => {
    expect(meta('prefixPresetSaveFilenames').description).toContain('Starred Doc');
  });
});

describe('Save Starred Doc command', () => {
  it('exists beside the other Save commands, unbound by default', () => {
    expect(RIBBON_COMMAND_IDS).toContain('saveStarredDoc');
    expect(RIBBON_COMMAND_IDS.indexOf('saveStarredDoc')).toBe(RIBBON_COMMAND_IDS.indexOf('saveMarkedCards') + 1);
    expect(RIBBON_COMMAND_LABELS['saveStarredDoc']).toBe('Save Starred Doc');
    expect(DEFAULT_RIBBON_KEYS['saveStarredDoc']).toBe('');
  });

  it('is offered in the ribbon command list next to Save Marked Cards', () => {
    const group = RIBBON_GROUPS.find((g) => (g.commands as string[]).includes('saveMarkedCards'))!;
    const cmds = group.commands as string[];
    expect(cmds.indexOf('saveStarredDoc')).toBe(cmds.indexOf('saveMarkedCards') + 1);
  });
});
