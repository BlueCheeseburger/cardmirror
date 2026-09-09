/**
 * Per-type format for the silent saves (user request 2026-09-09): Send
 * Doc format / Marked Cards format follow the new-document default unless
 * pinned; only the one-keystroke commands read them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { settings, effectiveDocTypeFormat, SETTING_METADATA } from '../../src/editor/settings.js';

afterEach(() => {
  settings.set('sendDocFormat', 'default');
  settings.set('readDocFormat', 'default');
  settings.set('markedDocFormat', 'default');
  settings.set('defaultSaveFormat', 'docx');
});

describe('doc-type formats', () => {
  it('default to following the new-document format', () => {
    expect(settings.get('sendDocFormat')).toBe('default');
    expect(settings.get('markedDocFormat')).toBe('default');
    settings.set('defaultSaveFormat', 'cmir');
    expect(effectiveDocTypeFormat('sendDocFormat')).toBe('cmir');
    expect(effectiveDocTypeFormat('markedDocFormat')).toBe('cmir');
    settings.set('defaultSaveFormat', 'docx');
    expect(effectiveDocTypeFormat('sendDocFormat')).toBe('docx');
  });

  it('the read format resolves like the others', () => {
    settings.set('defaultSaveFormat', 'cmir');
    expect(effectiveDocTypeFormat('readDocFormat')).toBe('cmir');
    settings.set('readDocFormat', 'docx');
    expect(effectiveDocTypeFormat('readDocFormat')).toBe('docx');
  });

  it('the Save Read Doc command exists, sits beside Save Send Doc, and is unbound by default', async () => {
    const rc = await import('../../src/editor/ribbon-commands.js');
    expect(rc.RIBBON_COMMAND_IDS).toContain('saveReadDoc');
    expect(rc.RIBBON_COMMAND_IDS.indexOf('saveReadDoc')).toBe(rc.RIBBON_COMMAND_IDS.indexOf('saveSendDoc') + 1);
    expect(rc.RIBBON_COMMAND_LABELS['saveReadDoc']).toBe('Save Read Doc');
    expect(rc.DEFAULT_RIBBON_KEYS['saveReadDoc']).toBe('');
    expect(rc.DEFAULT_RIBBON_KEYS['saveSendDoc']).toBe('Mod-Alt-s');
  });

  it('a pinned choice wins over the new-document format, per type', () => {
    settings.set('defaultSaveFormat', 'cmir');
    settings.set('sendDocFormat', 'docx');
    expect(effectiveDocTypeFormat('sendDocFormat')).toBe('docx');
    expect(effectiveDocTypeFormat('markedDocFormat')).toBe('cmir');
    settings.set('markedDocFormat', 'docx');
    settings.set('defaultSaveFormat', 'docx');
    settings.set('sendDocFormat', 'cmir');
    expect(effectiveDocTypeFormat('sendDocFormat')).toBe('cmir');
    expect(effectiveDocTypeFormat('markedDocFormat')).toBe('docx');
  });

  it('live in the Send / Read / Marked docs section, everywhere (the fallback dialog honors them on the web too)', () => {
    for (const key of ['sendDocFormat', 'readDocFormat', 'markedDocFormat'] as const) {
      const meta = SETTING_METADATA.find((m) => m.key === key)!;
      expect(meta, key).toBeTruthy();
      expect(meta.kind).toBe('docTypeFormat');
      expect(meta.category).toBe('files');
      expect(meta.section).toBe('Send / Read / Marked docs');
      expect(meta.electronOnly).toBeFalsy();
    }
    // Each format row follows its command's folder row.
    const keys = SETTING_METADATA.map((m) => m.key);
    expect(keys.indexOf('sendDocFormat')).toBe(keys.indexOf('sendDocFolder') + 1);
    expect(keys.indexOf('readDocFormat')).toBe(keys.indexOf('readDocFolder') + 1);
    expect(keys.indexOf('markedDocFormat')).toBe(keys.indexOf('markedCardsFolder') + 1);
    // Read Doc rows follow the Send Doc rows and precede Marked Cards.
    expect(keys.indexOf('readDocDestination')).toBe(keys.indexOf('sendDocFormat') + 1);
    expect(keys.indexOf('markedCardsDestination')).toBe(keys.indexOf('readDocFormat') + 1);
  });

  it('only the silent commands read them; Save As keeps the new-document default', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/editor/index.ts'), 'utf8');
    const flow = (name: string): string => {
      const start = src.indexOf(`async function ${name}(`);
      expect(start, name).toBeGreaterThan(0);
      return src.slice(start, src.indexOf('\n}\n', start));
    };
    expect(flow('runSilentExportFlow')).toContain('effectiveDocTypeFormat(spec.formatKey)');
    expect(flow('runSaveSendDocFlow')).toContain("formatKey: 'sendDocFormat'");
    expect(flow('runSaveReadDocFlow')).toContain("formatKey: 'readDocFormat'");
    expect(flow('runSaveReadDocFlow')).toContain('readMode: true');
    expect(flow('runSaveMarkedCardsFlow')).toContain("effectiveDocTypeFormat('markedDocFormat')");
    expect(flow('runSaveAsFlowInner')).toContain("settings.get('defaultSaveFormat')");
    expect(flow('runSaveAsFlowInner')).not.toContain('effectiveDocTypeFormat');
  });
});
