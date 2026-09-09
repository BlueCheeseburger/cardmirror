// @vitest-environment jsdom
/**
 * Home screen's Last-workspace checklist. The set is always listed in
 * full rather than folded away — reopening 15 documents wholesale is
 * rarely what the user wants — so the interesting behaviour is that
 * the Reopen button carries exactly the ticked subset, and that All /
 * None flip every row at once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homeScreen, type HomeScreenCallbacks } from '../../src/editor/home-screen.js';
import { saveWorkspaceNow, reportWindowWorkspace } from '../../src/editor/workspace-store.js';

function makeCallbacks(): HomeScreenCallbacks & { reopenWorkspace: ReturnType<typeof vi.fn> } {
  return {
    newDoc: vi.fn(),
    newSpeechDoc: vi.fn(),
    open: vi.fn(),
    openRecent: vi.fn(),
    manageQuickCards: vi.fn(),
    reopenWorkspace: vi.fn(),
  };
}

function seedWorkspace(paths: string[]): void {
  reportWindowWorkspace(
    'windows',
    paths.map((path) => ({ path, filename: path.split('/').pop()!, format: 'cmir' as const })),
  );
  saveWorkspaceNow();
}

const items = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>('.pmd-home-workspace-item input'));
const openBtn = (): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>('.pmd-home-workspace-open')!;
const selectBtn = (label: string): HTMLButtonElement =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.pmd-home-workspace-select')).find(
    (b) => b.textContent === label,
  )!;

describe('home screen — last workspace', () => {
  let cb: ReturnType<typeof makeCallbacks>;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    seedWorkspace(['/w/a.cmir', '/w/b.cmir', '/w/c.cmir']);
    cb = makeCallbacks();
    homeScreen.mount(document.body, cb);
    homeScreen.show();
  });

  afterEach(() => {
    homeScreen.hide();
  });

  it('lists every document, all ticked, with a Reopen button for the lot', () => {
    expect(items()).toHaveLength(3);
    expect(items().every((b) => b.checked)).toBe(true);
    expect(openBtn().textContent).toContain('Reopen 3 documents');
  });

  it('reopens only the ticked documents', () => {
    const [, second] = items();
    second!.checked = false;
    second!.dispatchEvent(new Event('change'));
    expect(openBtn().textContent).toContain('Reopen 2 documents');
    openBtn().click();
    expect(cb.reopenWorkspace).toHaveBeenCalledTimes(1);
    expect(cb.reopenWorkspace.mock.calls[0]![0].docs.map((d: { path: string }) => d.path)).toEqual([
      '/w/a.cmir',
      '/w/c.cmir',
    ]);
  });

  it('None clears every tick and disables Reopen; All puts them back', () => {
    selectBtn('None').click();
    expect(items().some((b) => b.checked)).toBe(false);
    expect(openBtn().disabled).toBe(true);
    expect(openBtn().textContent).toContain('Nothing selected');
    openBtn().click();
    expect(cb.reopenWorkspace).not.toHaveBeenCalled();

    selectBtn('All').click();
    expect(items().every((b) => b.checked)).toBe(true);
    expect(openBtn().disabled).toBe(false);
    openBtn().click();
    expect(cb.reopenWorkspace.mock.calls[0]![0].docs).toHaveLength(3);
  });

  it('keeps the ticks through a re-show, and resets them for a new snapshot', () => {
    const [first] = items();
    first!.checked = false;
    first!.dispatchEvent(new Event('change'));
    homeScreen.hide();
    homeScreen.show();
    expect(items()[0]!.checked).toBe(false);

    // A different snapshot underneath: every document starts ticked.
    seedWorkspace(['/w/x.cmir', '/w/y.cmir']);
    homeScreen.hide();
    homeScreen.show();
    expect(items()).toHaveLength(2);
    expect(items().every((b) => b.checked)).toBe(true);
  });

  it('hides the section entirely when there is no snapshot', () => {
    localStorage.clear();
    homeScreen.hide();
    homeScreen.show();
    expect(
      document.querySelector<HTMLElement>('.pmd-home-workspace-section')!.hidden,
    ).toBe(true);
  });
});
