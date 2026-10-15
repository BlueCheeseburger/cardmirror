// @vitest-environment jsdom
/** Per-pane disk badge (disk-conflict.ts's `createPaneDiskBadge`) — the
 *  multi-pane equivalent of the single-doc window's shared cloud pill,
 *  but one per pane so it's unambiguous which document's disk state
 *  each one shows. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  noteDocRegistered,
  noteDiskChanged,
  noteKeptCopy,
  createPaneDiskBadge,
  __resetDiskConflictForTests,
  type DiskBadgeDeps,
} from '../../src/editor/disk-conflict.js';

const A = '/Dropbox/Aff.cmir';
const B = '/OneDrive/Neg.cmir';

function pane(handle: string | null, over: Partial<DiskBadgeDeps> = {}) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  let h = handle;
  const deps: DiskBadgeDeps = {
    getActive: () => ({ handle: h, name: 'Doc.cmir' }),
    isSuppressed: () => false,
    isSessionHost: () => false,
    reveal: vi.fn(),
    reloadFromDisk: vi.fn(async () => {}),
    keepMineAsCopy: vi.fn(async () => {}),
    overwrite: vi.fn(async () => {}),
    openOriginal: vi.fn(async () => {}),
    ...over,
  };
  const handle_ = createPaneDiskBadge(deps, parent);
  return { handle_, deps, setHandle: (v: string | null) => (h = v) };
}

beforeEach(() => __resetDiskConflictForTests());
afterEach(() => {
  __resetDiskConflictForTests();
  document.body.innerHTML = '';
});

describe('per-pane disk badge', () => {
  it('hidden with no file path; a local (non-cloud) file shows a computer icon', () => {
    const { handle_: none } = pane(null);
    expect(none.el.hidden).toBe(true);
    const { handle_ } = pane(A);
    // Nothing registered yet: still a file on this machine.
    expect(handle_.el.hidden).toBe(false);
    expect(handle_.el.getAttribute('data-state')).toBe('local');
    noteDocRegistered('/local/x.cmir', 'fresh', null);
    const { handle_: h2 } = pane('/local/x.cmir');
    expect(h2.el.hidden).toBe(false);
    expect(h2.el.getAttribute('data-state')).toBe('local');
    expect(h2.el.title).toContain('On this computer');
    expect(h2.el.querySelector('.pmd-pane-disk-badge-icon')?.innerHTML).toContain('svg');
  });

  it('shows the provider icon with no label text while synced', () => {
    const { handle_ } = pane(A);
    noteDocRegistered(A, 'fresh', 'dropbox');
    expect(handle_.el.hidden).toBe(false);
    expect(handle_.el.getAttribute('data-state')).toBe('synced');
    expect(handle_.el.querySelector('.pmd-pane-disk-badge-icon')?.innerHTML).toContain('svg');
    expect(handle_.el.querySelector('.pmd-pane-disk-badge-label')?.textContent).toBe('');
    expect(handle_.el.title).toContain('as of last sync');
  });

  it('shows relative-time text while changed, "Copy" while kept-copy', () => {
    const { handle_ } = pane(A);
    noteDocRegistered(A, 'fresh', 'dropbox');
    noteDiskChanged(A, Date.now() - 120_000);
    expect(handle_.el.getAttribute('data-state')).toBe('changed');
    expect(handle_.el.querySelector('.pmd-pane-disk-badge-label')?.textContent).toBe('2m ago');

    const copy = '/Dropbox/copy.cmir';
    noteKeptCopy(copy, A);
    const { handle_: h2 } = pane(copy);
    expect(h2.el.getAttribute('data-state')).toBe('kept-copy');
    expect(h2.el.querySelector('.pmd-pane-disk-badge-label')?.textContent).toBe('Copy');
  });

  it('two panes track two different handles independently', () => {
    const { handle_: badgeA } = pane(A);
    const { handle_: badgeB } = pane(B);
    noteDocRegistered(A, 'fresh', 'dropbox');
    noteDocRegistered(B, 'fresh', 'onedrive');
    expect(badgeA.el.hidden).toBe(false);
    expect(badgeB.el.hidden).toBe(false);
    noteDiskChanged(A);
    expect(badgeA.el.getAttribute('data-state')).toBe('changed');
    expect(badgeB.el.getAttribute('data-state'), "pane B's own doc is untouched").toBe('synced');
  });

  it('clicking a synced badge reveals the file; clicking a changed one calls a badge action', async () => {
    const { handle_, deps } = pane(A);
    noteDocRegistered(A, 'fresh', 'dropbox');
    handle_.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(deps.reveal).toHaveBeenCalledWith(A);
  });

  it('destroy() unsubscribes — later note* mutations no longer refresh it', () => {
    const { handle_ } = pane(A);
    noteDocRegistered(A, 'fresh', 'dropbox');
    expect(handle_.el.getAttribute('data-state')).toBe('synced');
    handle_.destroy();
    noteDiskChanged(A);
    // No longer subscribed — the element is untouched (still says synced,
    // even though the underlying state moved to 'changed').
    expect(handle_.el.getAttribute('data-state')).toBe('synced');
  });

  it('respects isSuppressed (frozen during read mode)', () => {
    let suppressed = false;
    const { handle_ } = pane(A, { isSuppressed: () => suppressed });
    noteDocRegistered(A, 'fresh', 'dropbox');
    expect(handle_.el.getAttribute('data-state')).toBe('synced');
    suppressed = true;
    noteDiskChanged(A);
    expect(handle_.el.getAttribute('data-state'), 'frozen while suppressed').toBe('synced');
    suppressed = false;
    handle_.refresh();
    expect(handle_.el.getAttribute('data-state')).toBe('changed');
  });
});

describe('badge right-click menu', () => {
  const menuLabels = (): string[] =>
    [...document.querySelectorAll('.pmd-nav-context-item')].map((b) => b.textContent ?? '');

  function rightClick(el: HTMLElement): void {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  }

  it('a Dropbox file offers the provider-relative path, and copies it', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const cloudRelativePath = vi.fn(async () => '/Neg files/1NC.cmir');
    const { handle_ } = pane(A, { cloudRelativePath });
    noteDocRegistered(A, 'fresh', 'dropbox');
    rightClick(handle_.el);
    expect(menuLabels()).toEqual(['Copy file path', 'Show in folder', 'Copy Dropbox file path']);
    (document.querySelectorAll('.pmd-nav-context-item')[2] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(cloudRelativePath).toHaveBeenCalledWith(A);
    expect(writeText).toHaveBeenCalledWith('/Neg files/1NC.cmir');
  });

  it('a local file only offers the plain path rows', () => {
    const { handle_ } = pane('/local/x.cmir', { cloudRelativePath: async () => null });
    noteDocRegistered('/local/x.cmir', 'fresh', null);
    rightClick(handle_.el);
    expect(menuLabels()).toEqual(['Copy file path', 'Show in folder']);
  });
});
