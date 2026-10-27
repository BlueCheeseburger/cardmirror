// @vitest-environment jsdom
/**
 * Home screen's Last-workspace section: one row per window that was open
 * when the app last closed, titled with the window's name or its document
 * count, with that window's documents listed (indented) beneath it. There
 * are no checkboxes and no All / None — the window is the unit, and
 * clicking its row reopens it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homeScreen, type HomeScreenCallbacks } from '../../src/editor/home-screen.js';
import { settings } from '../../src/editor/settings.js';
import type { WorkspaceWindow } from '../../src/editor/workspace-store.js';

const LAST_KEY = 'pmd-last-workspace';

function makeCallbacks(): HomeScreenCallbacks & { reopenWorkspaceWindow: ReturnType<typeof vi.fn> } {
  return {
    newDoc: vi.fn(),
    open: vi.fn(),
    openRecent: vi.fn(),
    manageQuickCards: vi.fn(),
    compareDocuments: vi.fn(),
    reopenWorkspaceWindow: vi.fn(),
  };
}

const doc = (path: string, format: 'cmir' | 'docx' = 'docx') => ({
  path,
  filename: path.split('/').pop()!,
  format,
  slot: null,
});

function seedWindows(windows: Array<{ name?: string | null; paths: string[]; mode?: 'panes' | 'windows' }>): void {
  const wins: WorkspaceWindow[] = windows.map((w) => ({
    name: w.name ?? null,
    mode: w.mode ?? 'panes',
    docs: w.paths.map((p) => doc(p)),
  }));
  localStorage.setItem(
    LAST_KEY,
    JSON.stringify({ savedAt: Date.now(), windows: wins, docs: wins.flatMap((w) => w.docs), pinned: false }),
  );
}

const section = (): HTMLElement => document.querySelector<HTMLElement>('.pmd-home-workspace-section')!;
const windowRows = (): HTMLElement[] => Array.from(section().querySelectorAll<HTMLElement>('.pmd-home-ws-window'));
const rowButton = (row: HTMLElement): HTMLButtonElement =>
  row.querySelector<HTMLButtonElement>('.pmd-home-workspace-open')!;
const titleOf = (row: HTMLElement): string => rowButton(row).querySelector('.pmd-home-recent-name')!.textContent!;
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
    expect(rowButton(unnamed!).querySelector('.pmd-home-recent-path')).toBeNull();
    expect(rowButton(named!).querySelector('.pmd-home-recent-path')!.textContent!.replace(/\u200e/g, '')).toBe('2 docs');
  });

  it('lists every document of a window under its row, by name without the extension', () => {
    const rows = windowRows();
    expect(docNames(rows[0]!)).toEqual(['Aff', 'Neg', 'Case']);
    expect(docNames(rows[1]!)).toEqual(['Cards', 'Impacts']);
    expect(docNames(rows[2]!)).toEqual(['Speech']);
  });

  it('has no checkboxes and no All / None buttons, and no per-document Reopen label', () => {
    expect(section().querySelectorAll('input')).toHaveLength(0);
    const labels = Array.from(section().querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).not.toContain('All');
    expect(labels).not.toContain('None');
    expect(section().textContent).not.toContain('Reopen');
  });

  it('clicking a window row reopens that window, and only that one', () => {
    rowButton(windowRows()[1]!).click();
    expect(cb.reopenWorkspaceWindow).toHaveBeenCalledTimes(1);
    const win = cb.reopenWorkspaceWindow.mock.calls[0]![0] as WorkspaceWindow;
    expect(win.name).toBe('Research');
    expect(win.docs.map((d) => d.path)).toEqual(['/w/Cards.docx', '/w/Impacts.docx']);
  });

  it('clicking a document line does nothing on its own', () => {
    windowRows()[0]!.querySelector<HTMLElement>('.pmd-home-ws-window-doc')!.click();
    expect(cb.reopenWorkspaceWindow).not.toHaveBeenCalled();
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
