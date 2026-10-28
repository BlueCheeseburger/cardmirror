// @vitest-environment jsdom
/**
 * Home screen's Last-workspace section: an Open button over one row per
 * window that was open when the app last closed. Each window row has a
 * tick box and is titled with the window's name or its document count,
 * with that window's documents listed (indented) beneath it. Open reopens
 * the ticked windows. There are no per-document boxes and no All / None.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homeScreen, type HomeScreenCallbacks } from '../../src/editor/home-screen.js';
import { settings } from '../../src/editor/settings.js';
import type { WorkspaceWindow } from '../../src/editor/workspace-store.js';

const LAST_KEY = 'pmd-last-workspace';

function makeCallbacks(): HomeScreenCallbacks & { reopenWorkspaceWindows: ReturnType<typeof vi.fn> } {
  return {
    newDoc: vi.fn(),
    open: vi.fn(),
    openRecent: vi.fn(),
    manageQuickCards: vi.fn(),
    compareDocuments: vi.fn(),
    reopenWorkspaceWindows: vi.fn(),
  };
}

const doc = (path: string, format: 'cmir' | 'docx' = 'docx') => ({
  path,
  filename: path.split('/').pop()!,
  format,
  slot: null,
});

// A distinct savedAt per seed, so each counts as a new snapshot.
let savedAtCounter = Date.now();

function seedWindows(windows: Array<{ name?: string | null; paths: string[]; mode?: 'panes' | 'windows' }>): void {
  const wins: WorkspaceWindow[] = windows.map((w) => ({
    name: w.name ?? null,
    mode: w.mode ?? 'panes',
    docs: w.paths.map((p) => doc(p)),
  }));
  localStorage.setItem(
    LAST_KEY,
    JSON.stringify({ savedAt: ++savedAtCounter, windows: wins, docs: wins.flatMap((w) => w.docs), pinned: false }),
  );
}

const section = (): HTMLElement => document.querySelector<HTMLElement>('.pmd-home-workspace-section')!;
const windowRows = (): HTMLElement[] => Array.from(section().querySelectorAll<HTMLElement>('.pmd-home-ws-window'));
const headOf = (row: HTMLElement): HTMLElement => row.querySelector<HTMLElement>('.pmd-home-ws-head')!;
const boxOf = (row: HTMLElement): HTMLInputElement => headOf(row).querySelector<HTMLInputElement>('input')!;
const titleOf = (row: HTMLElement): string => headOf(row).querySelector('.pmd-home-recent-name')!.textContent!;
const openBtn = (): HTMLButtonElement => section().querySelector<HTMLButtonElement>('.pmd-home-ws-open')!;
const tick = (row: HTMLElement, on: boolean): void => {
  const box = boxOf(row);
  box.checked = on;
  box.dispatchEvent(new Event('change'));
};
const docNames = (row: HTMLElement): string[] =>
  Array.from(row.querySelectorAll('.pmd-home-ws-window-doc .pmd-home-recent-name')).map((e) => e.textContent!);

describe('home screen — last workspace', () => {
  let cb: ReturnType<typeof makeCallbacks>;

  beforeEach(() => {
    localStorage.clear();
    settings.set('lastWorkspaceEnabled', true);
    document.body.innerHTML = '';
    seedWindows([
      { paths: ['/w/Aff.docx', '/w/Neg.docx', '/w/Case.docx'] },
      { name: 'Research', paths: ['/w/Cards.docx', '/w/Impacts.docx'] },
      { paths: ['/w/Speech.docx'] },
    ]);
    cb = makeCallbacks();
    homeScreen.mount(document.body, cb);
    homeScreen.show();
  });

  afterEach(() => {
    homeScreen.hide();
  });

  it('shows one row per window, titled by its name or its document count', () => {
    expect(windowRows().map(titleOf)).toEqual(['3 docs', 'Research', '1 doc']);
  });

  it('shows a named window\'s count beside its name', () => {
    const [unnamed, named] = windowRows();
    expect(headOf(unnamed!).querySelector('.pmd-home-recent-path')).toBeNull();
    expect(headOf(named!).querySelector('.pmd-home-recent-path')!.textContent!.replace(/\u200e/g, '')).toBe('2 docs');
  });

  it('lists every document of a window under its row, by name without the extension', () => {
    const rows = windowRows();
    expect(docNames(rows[0]!)).toEqual(['Aff', 'Neg', 'Case']);
    expect(docNames(rows[1]!)).toEqual(['Cards', 'Impacts']);
    expect(docNames(rows[2]!)).toEqual(['Speech']);
  });

  it('puts a tick box on each window — all ticked — and none on the documents', () => {
    expect(windowRows().map((r) => boxOf(r).checked)).toEqual([true, true, true]);
    expect(section().querySelectorAll('input')).toHaveLength(3);
    expect(section().querySelectorAll('.pmd-home-ws-window-doc input')).toHaveLength(0);
    const labels = Array.from(section().querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).not.toContain('All');
    expect(labels).not.toContain('None');
  });

  it('Open counts the ticked windows and reopens exactly those, in order', () => {
    expect(openBtn().textContent).toBe('Open 3 windows');
    tick(windowRows()[1]!, false);
    expect(openBtn().textContent).toBe('Open 2 windows');
    openBtn().click();
    expect(cb.reopenWorkspaceWindows).toHaveBeenCalledTimes(1);
    const wins = cb.reopenWorkspaceWindows.mock.calls[0]![0] as WorkspaceWindow[];
    expect(wins.map((w) => w.docs.length)).toEqual([3, 1]);
    expect(wins.some((w) => w.name === 'Research')).toBe(false);
  });

  it('says "1 window" for one, and disables Open when nothing is ticked', () => {
    tick(windowRows()[0]!, false);
    tick(windowRows()[1]!, false);
    expect(openBtn().textContent).toBe('Open 1 window');
    tick(windowRows()[2]!, false);
    expect(openBtn().disabled).toBe(true);
    expect(openBtn().textContent).toContain('no windows ticked');
    openBtn().click();
    expect(cb.reopenWorkspaceWindows).not.toHaveBeenCalled();
  });

  it('clicking a document line does nothing on its own', () => {
    windowRows()[0]!.querySelector<HTMLElement>('.pmd-home-ws-window-doc')!.click();
    expect(cb.reopenWorkspaceWindows).not.toHaveBeenCalled();
    expect(boxOf(windowRows()[0]!).checked).toBe(true);
  });

  it('keeps the ticks through a re-show, and starts a new snapshot all ticked', () => {
    tick(windowRows()[0]!, false);
    homeScreen.hide();
    homeScreen.show();
    expect(windowRows().map((r) => boxOf(r).checked)).toEqual([false, true, true]);
    expect(openBtn().textContent).toBe('Open 2 windows');

    seedWindows([{ paths: ['/w/x.docx'] }, { paths: ['/w/y.docx'] }]);
    homeScreen.hide();
    homeScreen.show();
    expect(windowRows().map((r) => boxOf(r).checked)).toEqual([true, true]);
  });

  it('Forget clears the saved workspace and hides the section', () => {
    section().querySelector<HTMLButtonElement>('.pmd-home-recents-clear')!.click();
    expect(section().hidden).toBe(true);
    expect(localStorage.getItem(LAST_KEY)).toBeNull();
  });

  it('hides the section while the setting is off, even with a snapshot', () => {
    settings.set('lastWorkspaceEnabled', false);
    homeScreen.hide();
    homeScreen.show();
    expect(section().hidden).toBe(true);
    settings.set('lastWorkspaceEnabled', true);
    homeScreen.hide();
    homeScreen.show();
    expect(section().hidden).toBe(false);
  });

  it('hides the section entirely when there is no snapshot', () => {
    localStorage.clear();
    homeScreen.hide();
    homeScreen.show();
    expect(section().hidden).toBe(true);
  });
});
