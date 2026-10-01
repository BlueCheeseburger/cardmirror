// @vitest-environment jsdom
/**
 * Reload From Disk: the reload button (single-doc tray, left of the cloud
 * pill; per-pane footer, left of the cloud badge) and the command that
 * share one flow — ask before discarding unsaved edits, refuse for a
 * co-editing host, and say so for a document with no file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const promptForRouteChoice = vi.fn(async (_opts: unknown): Promise<string | null> => 'reload');
vi.mock('../../src/editor/text-prompt.js', () => ({
  promptForRouteChoice: (opts: unknown) => promptForRouteChoice(opts),
}));
const showToast = vi.fn();
vi.mock('../../src/editor/toast.js', () => ({ showToast: (m: string) => showToast(m) }));

import {
  noteDocRegistered,
  installDiskBadge,
  createPaneDiskBadge,
  reloadFromDiskWithPrompt,
  reloadActiveDocFromDisk,
  __resetDiskConflictForTests,
  type DiskBadgeDeps,
} from '../../src/editor/disk-conflict.js';
import { DEFAULT_RIBBON_KEYS } from '../../src/editor/ribbon-commands.js';

const A = '/Dropbox/Aff.cmir';
const L = '/local/Neg.cmir';

function deps(over: Partial<DiskBadgeDeps> & { handle?: string | null } = {}): DiskBadgeDeps & {
  reloadFromDisk: ReturnType<typeof vi.fn>;
  setHandle: (h: string | null) => void;
} {
  let handle: string | null = over.handle === undefined ? A : over.handle;
  const reloadFromDisk = vi.fn(async (_h: string) => {});
  return {
    getActive: () => ({ handle, name: 'Aff.cmir' }),
    isSuppressed: () => false,
    isSessionHost: () => false,
    isDirty: () => false,
    reveal: vi.fn(),
    keepMineAsCopy: vi.fn(async () => {}),
    overwrite: vi.fn(async () => {}),
    openOriginal: vi.fn(async () => {}),
    ...over,
    reloadFromDisk: over.reloadFromDisk ? (over.reloadFromDisk as ReturnType<typeof vi.fn>) : reloadFromDisk,
    setHandle: (h) => {
      handle = h;
    },
  };
}

beforeEach(() => {
  __resetDiskConflictForTests();
  promptForRouteChoice.mockClear();
  promptForRouteChoice.mockImplementation(async () => 'reload');
  showToast.mockClear();
});
afterEach(() => {
  __resetDiskConflictForTests();
  document.body.innerHTML = '';
});

describe('reloadFromDiskWithPrompt', () => {
  it('reloads a clean document straight away', async () => {
    const d = deps();
    await reloadFromDiskWithPrompt(d);
    expect(promptForRouteChoice).not.toHaveBeenCalled();
    expect(d.reloadFromDisk).toHaveBeenCalledWith(A);
  });

  it('asks before discarding unsaved edits, and stops on cancel', async () => {
    const d = deps({ isDirty: () => true });
    promptForRouteChoice.mockImplementationOnce(async () => null);
    await reloadFromDiskWithPrompt(d);
    expect(promptForRouteChoice).toHaveBeenCalledTimes(1);
    expect(d.reloadFromDisk).not.toHaveBeenCalled();
    await reloadFromDiskWithPrompt(d);
    expect(d.reloadFromDisk).toHaveBeenCalledWith(A);
  });

  it('refuses for a co-editing host', async () => {
    const d = deps({ isSessionHost: () => true });
    await reloadFromDiskWithPrompt(d);
    expect(d.reloadFromDisk).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('co-editing session'));
  });

  it('says so for a document with no file', async () => {
    const d = deps({ handle: null });
    await reloadFromDiskWithPrompt(d);
    expect(d.reloadFromDisk).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('save it first'));
  });
});

describe('the command', () => {
  it('reports false when no badge is installed', async () => {
    expect(await reloadActiveDocFromDisk()).toBe(false);
  });

  it('reloads through the installed badge deps', async () => {
    const d = deps();
    installDiskBadge(d, { parent: document.body });
    expect(await reloadActiveDocFromDisk()).toBe(true);
    expect(d.reloadFromDisk).toHaveBeenCalledWith(A);
  });

  it('is bound to Mod-r by default', () => {
    expect(DEFAULT_RIBBON_KEYS.reloadFromDisk).toBe('Mod-r');
    const taken = Object.entries(DEFAULT_RIBBON_KEYS).filter(([, k]) =>
      (Array.isArray(k) ? k : [k]).some((key) => key.toLowerCase() === 'mod-r'),
    );
    expect(taken.map(([id]) => id)).toEqual(['reloadFromDisk']);
  });
});

describe('single-doc tray button', () => {
  it('sits left of the cloud pill and shows for a saved local file too', () => {
    const d = deps({ handle: L });
    noteDocRegistered(L, 'fresh', null);
    installDiskBadge(d, { parent: document.body });
    const tray = document.querySelector('.pmd-pill-tray-right')!;
    const [first, second] = Array.from(tray.children) as HTMLElement[];
    expect(first!.classList.contains('pmd-reload-pill')).toBe(true);
    expect(second!.classList.contains('pmd-disk-badge')).toBe(true);
    expect(first!.hidden).toBe(false); // saved local file: reload yes…
    expect(second!.hidden).toBe(true); // …cloud pill no
    expect(document.documentElement.classList.contains('pmd-disk-pill-active')).toBe(true);
  });

  it('hides for an unsaved document and follows the active document', async () => {
    const d = deps({ handle: null });
    installDiskBadge(d, { parent: document.body });
    const reload = document.querySelector('.pmd-reload-pill') as HTMLElement;
    expect(reload.hidden).toBe(true);
    expect(document.documentElement.classList.contains('pmd-disk-pill-active')).toBe(false);
    noteDocRegistered(A, 'fresh', 'dropbox');
    d.setHandle(A);
    const { refreshDiskBadge } = await import('../../src/editor/disk-conflict.js');
    refreshDiskBadge();
    expect(reload.hidden).toBe(false);
  });

  it('clicking it runs the reload flow', async () => {
    const d = deps();
    noteDocRegistered(A, 'fresh', 'dropbox');
    installDiskBadge(d, { parent: document.body });
    (document.querySelector('.pmd-reload-bar') as HTMLElement).click();
    await vi.waitFor(() => expect(d.reloadFromDisk).toHaveBeenCalledWith(A));
  });
});

describe('per-pane footer button', () => {
  it('is added before the cloud badge, shows for any saved file, and goes away with the pane', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const d = deps({ handle: L });
    noteDocRegistered(L, 'fresh', null);
    const handle = createPaneDiskBadge(d, parent);
    const kids = Array.from(parent.children) as HTMLElement[];
    expect(kids[0]!.className).toBe('pmd-pane-reload-btn');
    expect(kids[1]).toBe(handle.el);
    expect(kids[0]!.hidden).toBe(false);
    expect(handle.el.hidden).toBe(true);
    handle.destroy();
    expect(parent.children.length).toBe(0);
  });

  it('hidden for an unsaved doc; click reloads', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const d = deps({ handle: null });
    createPaneDiskBadge(d, parent);
    const btn = parent.querySelector('.pmd-pane-reload-btn') as HTMLButtonElement;
    expect(btn.hidden).toBe(true);
    d.setHandle(A);
    noteDocRegistered(A, 'fresh', 'dropbox'); // refreshes every pane badge
    expect(btn.hidden).toBe(false);
    btn.click();
    await vi.waitFor(() => expect(d.reloadFromDisk).toHaveBeenCalledWith(A));
  });
});
