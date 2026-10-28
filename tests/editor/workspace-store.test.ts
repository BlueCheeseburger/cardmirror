// @vitest-environment jsdom
/**
 * Workspace store — the "reopen what I had open last time" snapshot.
 *
 * The interesting behaviours are the two-record dance: every window
 * reports into the LIVE map, and the first window of a session folds
 * that map into the LAST snapshot at boot and empties it. A fold that
 * finds nothing CLEARS the snapshot — closing everything before you
 * quit is taken at face value — except when the standing snapshot was
 * pinned by an explicit Save Workspace, which is the whole reason to
 * reach for that command.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { settings } from '../../src/editor/settings.js';
import {
  reportWindowWorkspace,
  rolloverLastWorkspace,
  lastWorkspace,
  saveWorkspaceNow,
  clearLastWorkspace,
  subscribeLastWorkspace,
  setWindowWorkspaceName,
  forgetWindowWorkspace,
  installWindowCloseForget,
} from '../../src/editor/workspace-store.js';

const LIVE_KEY = 'pmd-live-workspace';
const LAST_KEY = 'pmd-last-workspace';

beforeEach(() => {
  localStorage.clear();
  settings.set('lastWorkspaceEnabled', true);
  setWindowWorkspaceName(null);
});

function report(paths: string[]): void {
  reportWindowWorkspace(
    'windows',
    paths.map((path) => ({ path, filename: path.split('/').pop()!, format: 'cmir' as const })),
  );
}

/** Seed a LIVE entry as if it came from another window. */
function seedLive(
  id: string,
  updatedAt: number,
  paths: string[],
  mode: 'panes' | 'windows' = 'windows',
  extra: { name?: string | null; openedAt?: number } = {},
): void {
  const live = JSON.parse(localStorage.getItem(LIVE_KEY) ?? '{}');
  live[id] = {
    openedAt: extra.openedAt ?? updatedAt,
    updatedAt,
    mode,
    name: extra.name ?? null,
    docs: paths.map((path) => ({
      path,
      filename: path.split('/').pop()!,
      format: 'cmir',
      slot: null,
    })),
  };
  localStorage.setItem(LIVE_KEY, JSON.stringify(live));
}

describe('workspace store', () => {
  it('folds the live map into a snapshot and empties it', () => {
    report(['/w/a.cmir', '/w/b.cmir']);
    const snapshot = rolloverLastWorkspace();
    expect(snapshot?.docs.map((d) => d.path)).toEqual(['/w/a.cmir', '/w/b.cmir']);
    expect(JSON.parse(localStorage.getItem(LIVE_KEY)!)).toEqual({});
    expect(lastWorkspace()?.docs).toHaveLength(2);
  });

  it('drops docs with no reopenable path', () => {
    reportWindowWorkspace('windows', [
      { path: '/w/saved.cmir', filename: 'saved.cmir', format: 'cmir' },
      { path: null, filename: 'untitled', format: null },
      { path: {}, filename: 'web-handle.cmir', format: 'cmir' },
      { path: '/w/nameless.cmir', filename: null, format: 'cmir' },
    ]);
    expect(rolloverLastWorkspace()?.docs.map((d) => d.path)).toEqual(['/w/saved.cmir']);
  });

  it('a fold with nothing open clears an automatic snapshot', () => {
    report(['/w/a.cmir']);
    rolloverLastWorkspace();
    // Next session: everything was closed before quitting.
    expect(rolloverLastWorkspace()).toBeNull();
    expect(lastWorkspace()).toBeNull();
  });

  it('a fold with nothing open keeps a pinned snapshot', () => {
    report(['/w/a.cmir']);
    expect(saveWorkspaceNow()?.pinned).toBe(true);
    report([]); // closed it again before quitting
    const kept = rolloverLastWorkspace();
    expect(kept?.docs.map((d) => d.path)).toEqual(['/w/a.cmir']);
    expect(kept?.pinned).toBe(true);
  });

  it('a session that ends with docs open replaces even a pinned snapshot', () => {
    report(['/w/pinned.cmir']);
    saveWorkspaceNow();
    report(['/w/later.cmir']);
    const rolled = rolloverLastWorkspace();
    expect(rolled?.docs.map((d) => d.path)).toEqual(['/w/later.cmir']);
    expect(rolled?.pinned).toBe(false);
  });

  it('keeps windows apart, oldest first, and de-duplicates by path', () => {
    seedLive('win-new', Date.now() - 1_000, ['/w/b.cmir', '/w/a.cmir']);
    seedLive('win-old', Date.now() - 2_000, ['/w/a.cmir']);
    const snapshot = rolloverLastWorkspace()!;
    expect(snapshot.windows.map((w) => w.docs.map((d) => d.path))).toEqual([['/w/a.cmir'], ['/w/b.cmir']]);
    expect(snapshot.docs.map((d) => d.path)).toEqual(['/w/a.cmir', '/w/b.cmir']);
  });

  it('lists windows in the order they were opened, not the order they last changed', () => {
    const now = Date.now();
    // "first" opened earlier but its doc set changed more recently.
    seedLive('first', now - 100, ['/w/a.cmir'], 'panes', { openedAt: now - 9_000 });
    seedLive('second', now - 5_000, ['/w/b.cmir'], 'panes', { openedAt: now - 8_000 });
    expect(rolloverLastWorkspace()!.windows.map((w) => w.docs[0]!.path)).toEqual(['/w/a.cmir', '/w/b.cmir']);
  });

  it('a window keeps its place in the list when it opens another doc', () => {
    reportWindowWorkspace('panes', [{ path: '/w/a.cmir', filename: 'a.cmir', format: 'cmir', slot: 'slot1' }]);
    // Another window opens after this one ...
    seedLive('later', Date.now() + 5_000, ['/w/later.cmir'], 'panes', { openedAt: Date.now() + 5_000 });
    // ... then this window opens a second doc: it must not hop behind it.
    reportWindowWorkspace('panes', [
      { path: '/w/a.cmir', filename: 'a.cmir', format: 'cmir', slot: 'slot1' },
      { path: '/w/b.cmir', filename: 'b.cmir', format: 'cmir', slot: 'slot2' },
    ]);
    expect(rolloverLastWorkspace()!.windows.map((w) => w.docs.length)).toEqual([2, 1]);
  });

  it('records each window\'s own layout and name', () => {
    seedLive('win-a', Date.now() - 2_000, ['/w/a.cmir', '/w/b.cmir'], 'panes', { name: 'Prep' });
    seedLive('win-b', Date.now() - 1_000, ['/w/c.cmir'], 'windows');
    const { windows } = rolloverLastWorkspace()!;
    expect(windows.map((w) => [w.name, w.mode, w.docs.length])).toEqual([
      ['Prep', 'panes', 2],
      [null, 'windows', 1],
    ]);
  });

  it('setWindowWorkspaceName labels this window, and clears again', () => {
    setWindowWorkspaceName('  Aff blocks  ');
    report(['/w/a.cmir']);
    expect(JSON.parse(localStorage.getItem(LIVE_KEY)!)).toEqual({
      [Object.keys(JSON.parse(localStorage.getItem(LIVE_KEY)!))[0]!]: expect.objectContaining({ name: 'Aff blocks' }),
    });
    // Renaming rewrites the entry in place, no new report needed.
    setWindowWorkspaceName('Neg blocks');
    expect(rolloverLastWorkspace()!.windows[0]!.name).toBe('Neg blocks');
    report(['/w/a.cmir']);
    setWindowWorkspaceName(null);
    expect(rolloverLastWorkspace()!.windows[0]!.name).toBeNull();
  });

  it('drops a window left with nothing after de-duplication', () => {
    seedLive('a', Date.now() - 2_000, ['/w/a.cmir']);
    seedLive('b', Date.now() - 1_000, ['/w/a.cmir']); // stale duplicate
    expect(rolloverLastWorkspace()!.windows).toHaveLength(1);
  });

  it('preserves slot assignments through a fold', () => {
    reportWindowWorkspace('panes', [
      { path: '/w/a.cmir', filename: 'a.cmir', format: 'cmir', slot: 'slot2' },
    ]);
    expect(rolloverLastWorkspace()?.docs[0]!.slot).toBe('slot2');
  });

  it('an explicit save writes the snapshot without emptying the live map', () => {
    report(['/w/a.cmir']);
    expect(saveWorkspaceNow()?.docs).toHaveLength(1);
    expect(Object.keys(JSON.parse(localStorage.getItem(LIVE_KEY)!))).toHaveLength(1);
    expect(lastWorkspace()?.docs.map((d) => d.path)).toEqual(['/w/a.cmir']);
  });

  it('an explicit save with nothing open is a no-op', () => {
    report(['/w/a.cmir']);
    saveWorkspaceNow();
    report([]); // this window closed its doc
    expect(saveWorkspaceNow()).toBeNull();
    expect(lastWorkspace()?.docs.map((d) => d.path)).toEqual(['/w/a.cmir']);
  });

  it('a snapshot written before pinning existed reads as unpinned', () => {
    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        mode: 'windows',
        docs: [{ path: '/w/old.cmir', filename: 'old.cmir', format: 'cmir', slot: null }],
      }),
    );
    expect(lastWorkspace()?.pinned).toBe(false);
    expect(rolloverLastWorkspace()).toBeNull();
  });

  it('ignores live entries older than the age cap', () => {
    seedLive('ancient', Date.now() - 400 * 24 * 60 * 60 * 1000, ['/w/gone.cmir']);
    expect(rolloverLastWorkspace()).toBeNull();
  });

  it('caps a snapshot at 24 documents, across windows', () => {
    seedLive('a', Date.now() - 3_000, Array.from({ length: 20 }, (_, i) => `/w/a${i}.cmir`));
    seedLive('b', Date.now() - 2_000, Array.from({ length: 20 }, (_, i) => `/w/b${i}.cmir`));
    seedLive('c', Date.now() - 1_000, ['/w/c.cmir']);
    const snapshot = rolloverLastWorkspace()!;
    expect(snapshot.docs).toHaveLength(24);
    expect(snapshot.windows.map((w) => w.docs.length)).toEqual([20, 4]);
  });

  it('notifies subscribers on save, clear, and another window’s write', () => {
    const seen: Array<number | null> = [];
    subscribeLastWorkspace((s) => seen.push(s ? s.docs.length : null));
    report(['/w/a.cmir']);
    saveWorkspaceNow();
    clearLastWorkspace();
    expect(lastWorkspace()).toBeNull();
    // A write from ANOTHER window arrives as a DOM storage event.
    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        mode: 'windows',
        docs: [{ path: '/w/z.cmir', filename: 'z.cmir', format: 'cmir', slot: null }],
      }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: LAST_KEY }));
    expect(seen).toEqual([1, null, 1]);
  });

  it('reads a snapshot written before windows were kept apart', () => {
    const doc = (p: string) => ({ path: p, filename: p.split('/').pop(), format: 'cmir', slot: null });
    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({ savedAt: 1, mode: 'windows', docs: [doc('/w/a.cmir'), doc('/w/b.cmir')], excluded: ['/w/a.cmir'] }),
    );
    // One document per window in single-doc mode ...
    expect(lastWorkspace()!.windows.map((w) => w.docs.length)).toEqual([1, 1]);
    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({ savedAt: 1, mode: 'panes', docs: [doc('/w/a.cmir'), doc('/w/b.cmir')] }),
    );
    // ... and one window holding them all in three-pane mode.
    const panes = lastWorkspace()!;
    expect(panes.windows).toHaveLength(1);
    expect(panes.windows[0]!.mode).toBe('panes');
    expect(panes.docs).toHaveLength(2);
  });

  it('forgetting this window drops only its own entry', () => {
    seedLive('other', Date.now() - 1_000, ['/w/other.cmir']);
    report(['/w/mine.cmir']);
    forgetWindowWorkspace();
    expect(rolloverLastWorkspace()?.docs.map((d) => d.path)).toEqual(['/w/other.cmir']);
  });

  it('a window closing on its own forgets its entry; a quitting app keeps it', () => {
    report(['/w/a.cmir']);
    let quitting = false;
    const uninstall = installWindowCloseForget(() => quitting);
    try {
      quitting = true;
      window.dispatchEvent(new Event('pagehide'));
      expect(Object.keys(JSON.parse(localStorage.getItem(LIVE_KEY)!))).toHaveLength(1);
      quitting = false;
      window.dispatchEvent(new Event('pagehide'));
      expect(JSON.parse(localStorage.getItem(LIVE_KEY)!)).toEqual({});
    } finally {
      uninstall();
    }
  });

  it('keeps the entry when the quit question cannot be answered', () => {
    report(['/w/a.cmir']);
    const uninstall = installWindowCloseForget(() => {
      throw new Error('old preload');
    });
    try {
      window.dispatchEvent(new Event('pagehide'));
      expect(Object.keys(JSON.parse(localStorage.getItem(LIVE_KEY)!))).toHaveLength(1);
    } finally {
      uninstall();
    }
  });

  it('with the setting off (the default) nothing is recorded, offered, or saved', () => {
    settings.set('lastWorkspaceEnabled', false);
    report(['/w/a.cmir']);
    expect(localStorage.getItem(LIVE_KEY)).toBeNull();
    expect(saveWorkspaceNow()).toBeNull();
    expect(rolloverLastWorkspace()).toBeNull();
    // A snapshot left over from when it was on stays hidden until it is on again.
    settings.set('lastWorkspaceEnabled', true);
    report(['/w/a.cmir']);
    rolloverLastWorkspace();
    expect(lastWorkspace()?.docs).toHaveLength(1);
    settings.set('lastWorkspaceEnabled', false);
    expect(lastWorkspace()).toBeNull();
  });

  it('survives a corrupt record', () => {
    localStorage.setItem(LIVE_KEY, '{not json');
    localStorage.setItem(LAST_KEY, '{not json');
    expect(lastWorkspace()).toBeNull();
    expect(rolloverLastWorkspace()).toBeNull();
  });
});
