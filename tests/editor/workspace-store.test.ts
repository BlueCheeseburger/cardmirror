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

const LIVE_KEY = 'pmd-live-workspace'; // the pre-update single map (still read)
const LIVE_PREFIX = 'pmd-live-workspace:'; // one key per window
const LAST_KEY = 'pmd-last-workspace';

/** Every window's live entry, whichever way it is stored. */
function liveMap(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const legacy = localStorage.getItem(LIVE_KEY);
  if (legacy) Object.assign(out, JSON.parse(legacy));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (key.startsWith(LIVE_PREFIX)) out[key.slice(LIVE_PREFIX.length)] = JSON.parse(localStorage.getItem(key)!);
  }
  return out;
}

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

/** Mark a seeded LIVE entry as closed on its own at `closedAt`. */
function seedClosed(id: string, closedAt: number): void {
  const live = JSON.parse(localStorage.getItem(LIVE_KEY) ?? '{}');
  live[id].closedAt = closedAt;
  localStorage.setItem(LIVE_KEY, JSON.stringify(live));
}

describe('workspace store', () => {
  it('folds the live map into a snapshot and empties it', () => {
    report(['/w/a.cmir', '/w/b.cmir']);
    const snapshot = rolloverLastWorkspace();
    expect(snapshot?.docs.map((d) => d.path)).toEqual(['/w/a.cmir', '/w/b.cmir']);
    expect(liveMap()).toEqual({});
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
    // Next session: documents were open, and everything was closed before quitting.
    report(['/w/b.cmir']);
    forgetWindowWorkspace();
    expect(rolloverLastWorkspace()).toBeNull();
    expect(lastWorkspace()).toBeNull();
  });

  it('a session that never held a document does not wipe the snapshot on offer', () => {
    report(['/w/a.cmir', '/w/b.cmir']);
    rolloverLastWorkspace();
    // Next session: launched, looked at the Home screen, quit (an update
    // restart, say) without reopening anything.
    const again = rolloverLastWorkspace();
    expect(again?.docs.map((d) => d.path)).toEqual(['/w/a.cmir', '/w/b.cmir']);
    expect(lastWorkspace()?.docs).toHaveLength(2);
    // …and again: still there until the user reopens or clears it.
    expect(rolloverLastWorkspace()?.docs).toHaveLength(2);
  });

  it('once a session has held documents, the next fold is back to face value', () => {
    report(['/w/a.cmir']);
    rolloverLastWorkspace();
    rolloverLastWorkspace(); // an empty session keeps it
    report(['/w/c.cmir']); // the next one opens something…
    forgetWindowWorkspace(); // …and closes it again
    expect(rolloverLastWorkspace()).toBeNull();
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
    expect(Object.values(liveMap())).toEqual([expect.objectContaining({ name: 'Aff blocks' })]);
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
    expect(Object.keys(liveMap())).toHaveLength(1);
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
    // Unpinned: a session that held documents and closed them clears it.
    report(['/w/x.cmir']);
    forgetWindowWorkspace();
    expect(rolloverLastWorkspace()).toBeNull();
  });

  it('ignores live entries older than the age cap', () => {
    seedLive('ancient', Date.now() - 400 * 24 * 60 * 60 * 1000, ['/w/gone.cmir']);
    expect(rolloverLastWorkspace()).toBeNull();
  });

  it('keeps a big session whole: 40 documents across windows are all offered', () => {
    seedLive('a', Date.now() - 3_000, Array.from({ length: 20 }, (_, i) => `/w/a${i}.cmir`));
    seedLive('b', Date.now() - 2_000, Array.from({ length: 20 }, (_, i) => `/w/b${i}.cmir`));
    seedLive('c', Date.now() - 1_000, ['/w/c.cmir']);
    const snapshot = rolloverLastWorkspace()!;
    expect(snapshot.docs).toHaveLength(41);
    expect(snapshot.windows.map((w) => w.docs.length)).toEqual([20, 20, 1]);
  });

  it('still caps a runaway snapshot at 120 documents', () => {
    seedLive('a', Date.now() - 3_000, Array.from({ length: 100 }, (_, i) => `/w/a${i}.cmir`));
    seedLive('b', Date.now() - 2_000, Array.from({ length: 100 }, (_, i) => `/w/b${i}.cmir`));
    const snapshot = rolloverLastWorkspace()!;
    expect(snapshot.docs).toHaveLength(120);
    expect(snapshot.windows.map((w) => w.docs.length)).toEqual([100, 20]);
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

  it('a window closing on its own is marked closed; a quitting app stamps the quit', () => {
    report(['/w/a.cmir']);
    let quitting = false;
    const uninstall = installWindowCloseForget(() => quitting);
    try {
      quitting = true;
      window.dispatchEvent(new Event('pagehide'));
      const afterQuit = liveMap();
      expect(Object.values(afterQuit)).toHaveLength(1);
      expect((Object.values(afterQuit)[0] as { closedAt?: number }).closedAt).toBeUndefined();
      expect(typeof JSON.parse(localStorage.getItem('pmd-live-quit-at')!)).toBe('number');
      quitting = false;
      window.dispatchEvent(new Event('pagehide'));
      const afterClose = liveMap();
      expect(typeof (Object.values(afterClose)[0] as { closedAt?: number }).closedAt).toBe('number');
    } finally {
      uninstall();
    }
  });

  it('closing every window by hand still offers all of them, names included', () => {
    const now = Date.now();
    seedLive('a', now - 50_000, ['/w/a.cmir'], 'windows', { name: 'Round 1', openedAt: now - 90_000 });
    seedLive('b', now - 40_000, ['/w/b.cmir'], 'windows', { name: 'Round 2', openedAt: now - 80_000 });
    seedClosed('a', now - 20_000);
    seedClosed('b', now - 10_000);
    const snap = rolloverLastWorkspace()!;
    expect(snap.windows.map((w) => w.name)).toEqual(['Round 1', 'Round 2']);
  });

  it('a window closed long before the session ended stays out while others stay open', () => {
    const now = Date.now();
    seedLive('gone', now - 3_600_000, ['/w/gone.cmir'], 'windows', { openedAt: now - 7_000_000 });
    seedClosed('gone', now - 3_000_000);
    seedLive('kept', now - 1_000, ['/w/kept.cmir']);
    expect(rolloverLastWorkspace()?.docs.map((d) => d.path)).toEqual(['/w/kept.cmir']);
  });

  it('windows closed by hand just before a quit join the windows still open at it', () => {
    const now = Date.now();
    seedLive('closed', now - 60_000, ['/w/closed.cmir'], 'windows', { openedAt: now - 120_000 });
    seedClosed('closed', now - 30_000);
    seedLive('open', now - 5_000, ['/w/open.cmir']);
    localStorage.setItem('pmd-live-quit-at', String(now - 1_000));
    expect(rolloverLastWorkspace()?.docs.map((d) => d.path)).toEqual(['/w/closed.cmir', '/w/open.cmir']);
  });

  it('a closed window whose document an open window now holds is not listed twice', () => {
    const now = Date.now();
    seedLive('old', now - 60_000, ['/w/a.cmir'], 'windows', { openedAt: now - 120_000 });
    seedClosed('old', now - 30_000);
    seedLive('new', now - 5_000, ['/w/a.cmir']);
    localStorage.setItem('pmd-live-quit-at', String(now));
    expect(rolloverLastWorkspace()?.windows).toHaveLength(1);
  });

  it('Save Workspace never includes a window that was closed', () => {
    const now = Date.now();
    seedLive('closed', now - 60_000, ['/w/closed.cmir']);
    seedClosed('closed', now - 30_000);
    seedLive('open', now - 5_000, ['/w/open.cmir']);
    expect(saveWorkspaceNow()?.docs.map((d) => d.path)).toEqual(['/w/open.cmir']);
  });

  it('keeps the entry when the quit question cannot be answered', () => {
    report(['/w/a.cmir']);
    const uninstall = installWindowCloseForget(() => {
      throw new Error('old preload');
    });
    try {
      window.dispatchEvent(new Event('pagehide'));
      expect(Object.keys(liveMap())).toHaveLength(1);
    } finally {
      uninstall();
    }
  });

  it('with the setting off (the default) nothing is recorded, offered, or saved', () => {
    settings.set('lastWorkspaceEnabled', false);
    report(['/w/a.cmir']);
    expect(liveMap()).toEqual({});
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

describe('workspace store: one key per window', () => {
  it('this window writes only its own key, so another window\'s entry cannot be erased', () => {
    // Another window's entry, written to its own key a moment earlier.
    localStorage.setItem(
      LIVE_PREFIX + 'other',
      JSON.stringify({
        openedAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        mode: 'panes',
        name: null,
        docs: [{ path: '/w/other.cmir', filename: 'other.cmir', format: 'cmir', slot: 'slot1' }],
      }),
    );
    // This window reports, renames, and reports again.
    report(['/w/mine.cmir']);
    setWindowWorkspaceName('Mine');
    report(['/w/mine.cmir', '/w/mine2.cmir']);
    const keys = Object.keys(liveMap());
    expect(keys).toHaveLength(2);
    expect(keys).toContain('other');
    const snapshot = rolloverLastWorkspace()!;
    expect(snapshot.windows.map((w) => w.docs.map((d) => d.path))).toEqual([
      ['/w/other.cmir'],
      ['/w/mine.cmir', '/w/mine2.cmir'],
    ]);
  });

  it('each window\'s entry lives under its own key', () => {
    report(['/w/a.cmir']);
    const own = [...Array(localStorage.length).keys()]
      .map((i) => localStorage.key(i)!)
      .filter((k) => k.startsWith(LIVE_PREFIX));
    expect(own).toHaveLength(1);
    expect(localStorage.getItem(LIVE_KEY)).toBeNull(); // the old single map is not written
  });

  it('still reads windows left in the old single map by a session from before the update', () => {
    seedLive('legacy-a', Date.now() - 2_000, ['/w/old-a.cmir']);
    seedLive('legacy-b', Date.now() - 1_000, ['/w/old-b.cmir']);
    report(['/w/new.cmir']);
    const snapshot = rolloverLastWorkspace()!;
    expect(snapshot.docs.map((d) => d.path).sort()).toEqual(['/w/new.cmir', '/w/old-a.cmir', '/w/old-b.cmir']);
    // The roll-over empties both shapes.
    expect(liveMap()).toEqual({});
    expect(localStorage.getItem(LIVE_KEY)).toBeNull();
  });

  it('a closed mark goes on this window\'s own key and leaves the others alone', () => {
    seedLive('other', Date.now() - 1_000, ['/w/other.cmir']);
    report(['/w/mine.cmir']);
    const uninstall = installWindowCloseForget(() => false);
    try {
      window.dispatchEvent(new Event('pagehide'));
    } finally {
      uninstall();
    }
    const map = liveMap();
    expect(Object.keys(map)).toHaveLength(2);
    expect(map['other']!['closedAt']).toBeUndefined();
    expect(typeof Object.values(map).find((e) => e['closedAt'] !== undefined)?.['closedAt']).toBe('number');
  });
});
