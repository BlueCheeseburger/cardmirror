// @vitest-environment jsdom
/**
 * Save As dialog's reworked bottom half: Custom Save moved out of an
 * inline checkbox block into the preset row (opening its own
 * sub-dialog), and the space it left became the "previously saved
 * location" list, where a click saves straight into that folder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openSaveAs, type SaveAsResult } from '../../src/editor/save-as-ui.js';
import {
  recordSaveLocation,
  setSaveLocationsExpanded,
  listSaveLocations,
} from '../../src/editor/save-locations-store.js';

const q = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel);
const qa = (sel: string): Element[] => Array.from(document.querySelectorAll(sel));
const presetByLabel = (label: string): HTMLButtonElement =>
  qa('.pmd-save-as-preset-btn').find((b) => b.textContent === label) as HTMLButtonElement;

function open(opts: { allowSaveLocations?: boolean } = {}): Promise<SaveAsResult | null> {
  return openSaveAs({
    initialFilename: 'R2 1NR',
    defaultFormat: 'docx',
    ...opts,
  });
}

/** Close whatever dialog is up so a failed expectation can't leak an
 *  overlay (and its document-level key listener) into the next test. */
function cancelAll(): void {
  for (const btn of qa('.pmd-save-as-footer .pmd-save-as-btn-secondary')) {
    (btn as HTMLButtonElement).click();
  }
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  cancelAll();
  document.body.innerHTML = '';
});

describe('Save As — preset row', () => {
  it('offers Custom Save as the fifth preset, after Marked Doc', async () => {
    const p = open();
    const labels = qa('.pmd-save-as-preset-btn').map((b) => b.textContent);
    expect(labels).toEqual(['As-Is', 'Send Doc', 'Read Doc', 'Marked Doc', 'Custom Save']);
    // No inline checkboxes left in the main dialog — they moved.
    expect(qa('.pmd-save-as-option')).toHaveLength(0);
    cancelAll();
    expect(await p).toBeNull();
  });

  it('Custom Save opens a sub-dialog and resolves with its checkbox state', async () => {
    const p = open();
    presetByLabel('Custom Save').click();

    const sub = q<HTMLElement>('.pmd-save-as-custom-dialog');
    expect(sub).not.toBeNull();
    const boxes = Array.from(
      sub!.querySelectorAll<HTMLInputElement>('.pmd-save-as-option input'),
    );
    expect(boxes).toHaveLength(5);
    // Defaults: the three content layers on, the two private ones off.
    expect(boxes.map((b) => b.checked)).toEqual([true, true, true, false, false]);

    boxes[1]!.checked = false; // drop analytics
    boxes[4]!.checked = true; // bake AI comments in
    sub!.querySelector<HTMLFormElement>('form')!.requestSubmit();

    const result = await p;
    expect(result).toMatchObject({
      filename: 'R2 1NR.docx',
      format: 'docx',
      includeComments: true,
      includeAnalytics: false,
      includeUndertags: true,
      includeAiThreads: true,
      readMode: false,
      markedCardsOnly: false,
    });
    // Saving from the sub-dialog closes both, not just itself.
    expect(q('.pmd-save-as-custom-dialog')).toBeNull();
    expect(q('.pmd-save-as-dialog')).toBeNull();
  });

  it('cancelling the sub-dialog leaves the Save As dialog up and unresolved', async () => {
    const p = open();
    presetByLabel('Custom Save').click();
    const sub = q<HTMLElement>('.pmd-save-as-custom-dialog')!;
    sub.querySelector<HTMLButtonElement>('.pmd-save-as-btn-secondary')!.click();

    expect(q('.pmd-save-as-custom-dialog')).toBeNull();
    expect(q('.pmd-save-as-dialog')).not.toBeNull();

    // Still live: the outer dialog can still save.
    presetByLabel('As-Is').click();
    expect(await p).toMatchObject({ filename: 'R2 1NR.docx', includeAnalytics: true });
  });

  it('a preset carries no destination — those go through the OS picker', async () => {
    const p = open();
    presetByLabel('As-Is').click();
    expect((await p)?.destinationDir).toBeUndefined();
  });
});

describe('Save As — previously saved locations', () => {
  it('is omitted entirely when the host cannot write to a bare folder', async () => {
    recordSaveLocation('/w/round3');
    const p = open({ allowSaveLocations: false });
    expect(q('.pmd-save-as-locations')).toBeNull();
    cancelAll();
    await p;
  });

  it('starts collapsed for a new user and expands on click', async () => {
    recordSaveLocation('/w/round3');
    const p = open({ allowSaveLocations: true });

    const section = q<HTMLElement>('.pmd-save-as-locations')!;
    const toggle = q<HTMLButtonElement>('.pmd-save-as-locations-toggle')!;
    const list = q<HTMLElement>('.pmd-save-as-locations-list')!;
    expect(list.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(list.hidden).toBe(false);
    expect(section.classList.contains('pmd-save-as-locations-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    cancelAll();
    await p;
  });

  it('remembers the open/closed state across dialogs', async () => {
    recordSaveLocation('/w/round3');
    const first = open({ allowSaveLocations: true });
    q<HTMLButtonElement>('.pmd-save-as-locations-toggle')!.click(); // open it
    cancelAll();
    await first;

    const second = open({ allowSaveLocations: true });
    expect(q<HTMLElement>('.pmd-save-as-locations-list')!.hidden).toBe(false);
    cancelAll();
    await second;
  });

  it('clicking a folder resolves with it as the destination, As-Is', async () => {
    recordSaveLocation('/w/round3');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    q<HTMLButtonElement>('.pmd-save-as-location-open')!.click();
    const result = await p;
    expect(result).toMatchObject({
      filename: 'R2 1NR.docx',
      destinationDir: '/w/round3',
      includeComments: true,
      includeAnalytics: true,
      includeUndertags: true,
      readMode: false,
      markedCardsOnly: false,
    });
  });

  it('the destination follows a format change, like the presets do', async () => {
    recordSaveLocation('/w/round3');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    const cmir = qa('.pmd-save-as-format-row input')[0] as HTMLInputElement;
    cmir.checked = true;
    cmir.dispatchEvent(new Event('change'));
    q<HTMLButtonElement>('.pmd-save-as-location-open')!.click();

    expect(await p).toMatchObject({ filename: 'R2 1NR.cmir', destinationDir: '/w/round3' });
  });

  it('pinning re-orders the row to the top without closing the dialog', async () => {
    recordSaveLocation('/w/old');
    recordSaveLocation('/w/new');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    const pathText = (): string[] =>
      qa('.pmd-save-as-location-path').map((el) => el.textContent!.replace(/‎/g, ''));
    expect(pathText()).toEqual(['/w/new', '/w/old']);

    // Pin the older one: it jumps above the more recent folder.
    (qa('.pmd-save-as-location-pin')[1] as HTMLButtonElement).click();
    expect(pathText()).toEqual(['/w/old', '/w/new']);
    expect(listSaveLocations()[0]!.pinnedAt).not.toBeNull();
    expect(q('.pmd-save-as-dialog')).not.toBeNull();

    // The re-rendered row still saves into the right folder.
    q<HTMLButtonElement>('.pmd-save-as-location-open')!.click();
    expect((await p)?.destinationDir).toBe('/w/old');
  });

  it('says so when there is nothing remembered yet', async () => {
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });
    expect(q('.pmd-save-as-locations-empty')).not.toBeNull();
    expect(qa('.pmd-save-as-location')).toHaveLength(0);
    cancelAll();
    await p;
  });
});
