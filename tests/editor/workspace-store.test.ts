// @vitest-environment jsdom
/**
 * Workspace store — the "reopen what I had open last time" snapshot.
 *
 * The interesting behaviours are the two-record dance: every window
 * reports into the LIVE map, and the first window of a session folds
 * that map into the LAST snapshot at boot and empties it. Notably a
 * fold that finds nothing must KEEP the previous snapshot rather than
 * blank it (launch → close everything → quit shouldn't destroy the set
 * the user might still want back).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  reportWindowWorkspace,
  rolloverLastWorkspace,
  lastWorkspace,
  saveWorkspaceNow,
  clearLastWorkspace,
  subscribeLastWorkspace,
} from '../../src/editor/workspace-store.js';

const LIVE_KEY = 'pmd-live-workspace';
const LAST_KEY = 'pmd-last-workspace';

beforeEach(() => {
  localStorage.clear();
});

function report(paths: string[]): void {
  reportWindowWorkspace(
    'windows',
    paths.map((path) => ({ path, filename: path.split('/').pop()!, format: 'cmir' as const })),
  );
}

/** Seed a LIVE entry as if it came from another window. */
function seedLive(id: string, updatedAt: number, paths: string[], mode: 'panes' | 'windows' = 'windows'): void {
  const live = JSON.parse(localStorage.getItem(LIVE_KEY) ?? '{}');
  live[id] = {
    updatedAt,
    mode,
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

  it('a fold with nothing open keeps the previous snapshot', () => {
    report(['/w/a.cmir']);
    rolloverLastWorkspace();
    // Next session: nothing was open when it ended.
    const kept = rolloverLastWorkspace();
    expect(kept?.docs.map((d) => d.path)).toEqual(['/w/a.cmir']);
  });

  it('merges windows oldest-first and de-duplicates by path', () => {
    seedLive('win-new', Date.now() - 1_000, ['/w/b.cmir', '/w/a.cmir']);
    seedLive('win-old', Date.now() - 2_000, ['/w/a.cmir']);
    expect(rolloverLastWorkspace()?.docs.map((d) => d.path)).toEqual(['/w/a.cmir', '/w/b.cmir']);
  });

  it('takes its mode from the most recently updated window', () => {
    seedLive('win-old', Date.now() - 2_000, ['/w/a.cmir'], 'windows');
    seedLive('win-new', Date.now() - 1_000, ['/w/b.cmir'], 'panes');
    expect(rolloverLastWorkspace()?.mode).toBe('panes');
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

  it('ignores live entries older than the age cap', () => {
    seedLive('ancient', Date.now() - 400 * 24 * 60 * 60 * 1000, ['/w/gone.cmir']);
    expect(rolloverLastWorkspace()).toBeNull();
  });

  it('caps a snapshot at 24 documents', () => {
    report(Array.from({ length: 40 }, (_, i) => `/w/f${i}.cmir`));
    expect(rolloverLastWorkspace()?.docs).toHaveLength(24);
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

  it('survives a corrupt record', () => {
    localStorage.setItem(LIVE_KEY, '{not json');
    localStorage.setItem(LAST_KEY, '{not json');
    expect(lastWorkspace()).toBeNull();
    expect(rolloverLastWorkspace()).toBeNull();
  });
});
