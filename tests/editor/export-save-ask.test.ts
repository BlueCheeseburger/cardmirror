// @vitest-environment jsdom
/**
 * Save Send / Read / Marked / Starred Doc: a kind of save with no set location
 * (a doc never saved in same-folder mode, or an unset fixed folder) still asks
 * where, whatever the Undo setting says. The Undo setting only changes the
 * notice after a save that went to its location.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('silent export saves keep asking when there is no set location', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/editor/index.ts'), 'utf8');
  const start = src.indexOf('async function runSilentExportFlow');
  const flow = src.slice(start, src.indexOf('export async function runSaveSendDocFlow', start));

  it('falls back to the Save As dialog when the destination is not resolvable, with no Downloads route', () => {
    expect(flow).toContain('if (electron && destResolvable)');
    expect(flow).toMatch(/else \{[\s\S]*getHost\(\)\.saveAs\(/);
    expect(flow).not.toMatch(/useDownloads|Downloads/);
  });

  it('only a save that created a new file at its location gets the Undo notice', () => {
    expect(flow).toContain("settings.get('exportSaveUndo') && created && savedHandle && electron?.trashExport");
  });
});

describe('the Undo setting keeps a value saved under its old name', () => {
  it('carries silentExportsToDownloads over, and prefers its own key once set', async () => {
    localStorage.clear();
    localStorage.setItem('pmd-settings', JSON.stringify({ silentExportsToDownloads: true }));
    vi.resetModules();
    const a = await import('../../src/editor/settings.js');
    expect(a.settings.get('exportSaveUndo')).toBe(true);
    localStorage.setItem('pmd-settings', JSON.stringify({ silentExportsToDownloads: true, exportSaveUndo: false }));
    vi.resetModules();
    const b = await import('../../src/editor/settings.js');
    expect(b.settings.get('exportSaveUndo')).toBe(false);
    localStorage.clear();
  });
});
