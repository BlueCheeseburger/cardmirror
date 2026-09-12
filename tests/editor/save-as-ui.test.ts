// @vitest-environment jsdom
/**
 * Save As dialog's radio-list redesign: the five save modes (As-Is /
 * Send Doc / Read Doc / Marked Doc / Custom Save) and the "previously
 * saved location" list are both selections now, not immediate-action
 * buttons — nothing writes anything until "Save As" is clicked (or
 * Enter is pressed). Custom Save's checkboxes show inline under its
 * own row instead of in a sub-dialog.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openSaveAs, type SaveAsResult } from '../../src/editor/save-as-ui.js';
import { settings } from '../../src/editor/settings.js';
import {
  recordSaveLocation,
  setSaveLocationsExpanded,
  listSaveLocations,
} from '../../src/editor/save-locations-store.js';

const q = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel);
const qa = (sel: string): Element[] => Array.from(document.querySelectorAll(sel));

/** The mode-section radio row whose label text matches — the row
 *  itself carries both the radio and its blurb. */
function modeRow(label: string): HTMLLabelElement {
  const row = qa('.pmd-save-as-radio-row').find(
    (el) => el.querySelector('.pmd-save-as-radio-row-label')?.textContent === label,
  );
  if (!row) throw new Error(`no mode row for "${label}"`);
  return row as HTMLLabelElement;
}

function modeRadio(label: string): HTMLInputElement {
  return modeRow(label).querySelector('input[type="radio"]')!;
}

/** Click a mode radio the way a user does — native click + change,
 *  not just flipping `.checked`. */
function selectMode(label: string): void {
  modeRadio(label).click();
}

function saveAsBtn(): HTMLButtonElement {
  return q<HTMLButtonElement>('.pmd-save-as-footer .pmd-save-as-btn-primary')!;
}

function cancelBtn(): HTMLButtonElement {
  return q<HTMLButtonElement>('.pmd-save-as-footer .pmd-save-as-btn-secondary')!;
}

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

describe('Save As — mode selection', () => {
  it('lists all five modes, As-Is selected by default', async () => {
    const p = open();
    const labels = qa('.pmd-save-as-radio-row .pmd-save-as-radio-row-label')
      .map((el) => el.textContent)
      .filter((t) => t !== 'CardMirror native (.cmir)' && t !== 'Microsoft Word (.docx)');
    expect(labels).toEqual(['As-Is', 'Send Doc', 'Read Doc', 'Marked Doc', 'Custom Save']);
    expect(modeRadio('As-Is').checked).toBe(true);
    cancelAll();
    await p;
  });

  it('selecting a mode does not save anything by itself', async () => {
    const p = open();
    selectMode('Send Doc');
    // Still open, still unresolved — nothing committed.
    expect(q('.pmd-save-as-dialog')).not.toBeNull();
    cancelAll();
    expect(await p).toBeNull();
  });

  it('Save As with the default selection saves As-Is, no destination', async () => {
    const p = open();
    saveAsBtn().click();
    const result = await p;
    expect(result).toMatchObject({
      filename: 'R2 1NR.docx',
      includeComments: true,
      includeAnalytics: true,
      includeUndertags: true,
      readMode: false,
      markedCardsOnly: false,
    });
    expect(result?.destinationDir).toBeUndefined();
  });

  it('Enter in the Name field submits with the current selection, like Save As', async () => {
    const p = open();
    selectMode('Marked Doc');
    const form = q<HTMLFormElement>('.pmd-save-as-body')!;
    form.requestSubmit();
    expect(await p).toMatchObject({ markedCardsOnly: true, includeUndertags: true });
  });

  it('Send Doc excludes analytics/undertags/comments and takes its prefix', async () => {
    settings.set('prefixPresetSaveFilenames', true);
    const p = open();
    selectMode('Send Doc');
    saveAsBtn().click();
    const result = await p;
    expect(result).toMatchObject({
      includeComments: false,
      includeAnalytics: false,
      includeUndertags: false,
      readMode: false,
    });
    expect(result?.filename.startsWith(settings.get('sendDocPrefix'))).toBe(true);
  });

  it('Read Doc sets readMode and excludes the include-* layers', async () => {
    const p = open();
    selectMode('Read Doc');
    saveAsBtn().click();
    expect(await p).toMatchObject({
      readMode: true,
      includeComments: false,
      includeAnalytics: false,
      includeUndertags: false,
      markedCardsOnly: false,
    });
  });

  it('Custom Save reveals its checkboxes only while selected', async () => {
    const p = open();
    const options = q<HTMLElement>('.pmd-save-as-custom-options')!;
    expect(options.hidden).toBe(true);

    selectMode('Custom Save');
    expect(options.hidden).toBe(false);
    const boxes = qa('.pmd-save-as-custom-options .pmd-save-as-option input') as HTMLInputElement[];
    expect(boxes).toHaveLength(5);
    // Defaults match As-Is: the three content layers on, the two
    // private ones off.
    expect(boxes.map((b) => b.checked)).toEqual([true, true, true, false, false]);

    selectMode('As-Is');
    expect(options.hidden).toBe(true);
    cancelAll();
    await p;
  });

  it('Custom Save commits exactly the checked boxes, no prefix', async () => {
    const p = open();
    selectMode('Custom Save');
    const boxes = qa('.pmd-save-as-custom-options .pmd-save-as-option input') as HTMLInputElement[];
    boxes[1]!.checked = false; // drop analytics
    boxes[4]!.checked = true; // bake AI comments in
    saveAsBtn().click();

    const result = await p;
    expect(result).toMatchObject({
      filename: 'R2 1NR.docx',
      includeComments: true,
      includeAnalytics: false,
      includeUndertags: true,
      includeAiThreads: true,
      readMode: false,
      markedCardsOnly: false,
    });
  });

  it('an empty filename is refused — Save As is a no-op', async () => {
    const p = open();
    const input = q<HTMLInputElement>('.pmd-save-as-input')!;
    input.value = '   ';
    saveAsBtn().click();
    expect(q('.pmd-save-as-dialog')).not.toBeNull(); // still open
    cancelAll();
    expect(await p).toBeNull();
  });

  it('Escape cancels with null, whatever was selected', async () => {
    const p = open();
    selectMode('Marked Doc');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await p).toBeNull();
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

  it('"Choose location when saving" is selected by default — no destination', async () => {
    recordSaveLocation('/w/round3');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    const dialogRadio = q<HTMLInputElement>('.pmd-save-as-location-dialog-row input');
    expect(dialogRadio?.checked).toBe(true);
    saveAsBtn().click();
    expect((await p)?.destinationDir).toBeUndefined();
  });

  it('selecting a folder + Save As resolves with it as the destination', async () => {
    recordSaveLocation('/w/round3');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    q<HTMLInputElement>('.pmd-save-as-location input[type="radio"]')!.click();
    saveAsBtn().click();
    const result = await p;
    expect(result).toMatchObject({
      filename: 'R2 1NR.docx',
      destinationDir: '/w/round3',
      includeComments: true,
      includeAnalytics: true,
      includeUndertags: true,
    });
  });

  it('a selected location combines with the selected save mode', async () => {
    recordSaveLocation('/w/round3');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    selectMode('Send Doc');
    q<HTMLInputElement>('.pmd-save-as-location input[type="radio"]')!.click();
    saveAsBtn().click();
    expect(await p).toMatchObject({
      destinationDir: '/w/round3',
      includeComments: false,
      includeAnalytics: false,
      includeUndertags: false,
    });
  });

  it('reselecting "Choose location when saving" clears a picked folder', async () => {
    recordSaveLocation('/w/round3');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    q<HTMLInputElement>('.pmd-save-as-location input[type="radio"]')!.click();
    q<HTMLInputElement>('.pmd-save-as-location-dialog-row input')!.click();
    saveAsBtn().click();
    expect((await p)?.destinationDir).toBeUndefined();
  });

  it('the destination survives a format change', async () => {
    recordSaveLocation('/w/round3');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    const cmir = qa('.pmd-save-as-radio-list input[type="radio"]').find(
      (el) => (el as HTMLInputElement).value === 'cmir',
    ) as HTMLInputElement;
    cmir.checked = true;
    cmir.dispatchEvent(new Event('change'));
    q<HTMLInputElement>('.pmd-save-as-location input[type="radio"]')!.click();
    saveAsBtn().click();

    expect(await p).toMatchObject({ filename: 'R2 1NR.cmir', destinationDir: '/w/round3' });
  });

  it('pinning re-orders the row to the top, preserves selection, and does not close the dialog', async () => {
    recordSaveLocation('/w/old');
    recordSaveLocation('/w/new');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    const pathText = (): string[] =>
      qa('.pmd-save-as-location-path').map((el) => el.textContent!.replace(/‎/g, ''));
    expect(pathText()).toEqual(['/w/new', '/w/old']);

    // Select the older one, then pin it: it jumps to the top, and
    // stays selected.
    const oldRadio = qa('.pmd-save-as-location').find((row) =>
      row.querySelector('.pmd-save-as-location-path')?.textContent?.includes('/w/old'),
    )!.querySelector<HTMLInputElement>('input[type="radio"]')!;
    oldRadio.click();
    (qa('.pmd-save-as-location-pin')[1] as HTMLButtonElement).click();

    expect(pathText()).toEqual(['/w/old', '/w/new']);
    expect(listSaveLocations()[0]!.pinnedAt).not.toBeNull();
    expect(q('.pmd-save-as-dialog')).not.toBeNull();

    const stillChecked = qa('.pmd-save-as-location').find((row) =>
      row.querySelector('.pmd-save-as-location-path')?.textContent?.includes('/w/old'),
    )!.querySelector<HTMLInputElement>('input[type="radio"]')!;
    expect(stillChecked.checked).toBe(true);

    saveAsBtn().click();
    expect((await p)?.destinationDir).toBe('/w/old');
  });

  it('clicking pin never selects that row as the destination', async () => {
    recordSaveLocation('/w/round3');
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });

    q<HTMLButtonElement>('.pmd-save-as-location-pin')!.click();
    saveAsBtn().click();
    // The dialog-row default stayed selected — pinning is not selecting.
    expect((await p)?.destinationDir).toBeUndefined();
  });

  it('says so when there is nothing remembered yet, but the dialog option is still there', async () => {
    setSaveLocationsExpanded(true);
    const p = open({ allowSaveLocations: true });
    expect(q('.pmd-save-as-locations-empty')).not.toBeNull();
    expect(qa('.pmd-save-as-location')).toHaveLength(0);
    expect(q('.pmd-save-as-location-dialog-row')).not.toBeNull();
    cancelAll();
    await p;
  });
});
