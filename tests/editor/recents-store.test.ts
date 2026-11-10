// @vitest-environment jsdom
/**
 * Recents store — cap, de-dup-to-front, and the cross-window storage
 * sync (2026-07-29): a write in ANOTHER window arrives as a DOM
 * `storage` event and must re-notify this window's subscribers, so a
 * home screen sitting visible repaints live.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  listRecents,
  recordRecent,
  removeRecent,
  clearRecents,
  subscribeRecents,
  type RecentFile,
} from '../../src/editor/recents-store.js';

const KEY = 'pmd-recent-files';

beforeEach(() => {
  localStorage.clear();
});

function record(handle: string): void {
  recordRecent({ handle, filename: handle.split('/').pop()!, format: 'cmir' });
}

describe('recents store', () => {
  it('caps at 10, newest first, oldest rotated out', () => {
    for (let i = 1; i <= 12; i++) {
      record(`/r/file-${i}.cmir`);
    }
    const items = listRecents();
    expect(items).toHaveLength(10);
    expect(items[0]!.handle).toBe('/r/file-12.cmir');
    expect(items[9]!.handle).toBe('/r/file-3.cmir');
  });

  it('re-recording moves the entry to the front without duplicating', () => {
    record('/r/a.cmir');
    record('/r/b.cmir');
    record('/r/a.cmir');
    const items = listRecents();
    expect(items.map((r) => r.handle)).toEqual(['/r/a.cmir', '/r/b.cmir']);
  });

  it('removeRecent drops by handle', () => {
    record('/r/a.cmir');
    record('/r/b.cmir');
    removeRecent('/r/a.cmir');
    expect(listRecents().map((r) => r.handle)).toEqual(['/r/b.cmir']);
  });

  it('a storage event for our key re-notifies subscribers (cross-window write)', () => {
    const seen: RecentFile[][] = [];
    const unsubscribe = subscribeRecents((items) => seen.push(items));
    // Simulate another window's write: localStorage changes underneath
    // us (no local notify), then the storage event arrives.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { handle: '/r/other-window.cmir', filename: 'other-window.cmir', format: 'cmir', lastOpenedAt: 5 },
      ]),
    );
    expect(seen).toHaveLength(0); // nothing yet — no event, no local write
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.map((r) => r.handle)).toEqual(['/r/other-window.cmir']);
    unsubscribe();
  });

  it('ignores storage events for unrelated keys', () => {
    let calls = 0;
    const unsubscribe = subscribeRecents(() => calls++);
    window.dispatchEvent(new StorageEvent('storage', { key: 'pmd-settings' }));
    expect(calls).toBe(0);
    // A null key is a wholesale localStorage.clear() — recents were part
    // of it, so that DOES notify.
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(calls).toBe(1);
    unsubscribe();
  });

  it('clearRecents empties the list and notifies locally', () => {
    record('/r/a.cmir');
    let last: RecentFile[] | null = null;
    const unsubscribe = subscribeRecents((items) => (last = items));
    clearRecents();
    expect(listRecents()).toEqual([]);
    expect(last).toEqual([]);
    unsubscribe();
  });
});

describe('recordClosedDocs', () => {
  it('puts a closing window\'s saved docs first, in the window\'s order, skipping unsaved ones', async () => {
    const { recordClosedDocs, recordRecent, listRecents, clearRecents } = await import(
      '../../src/editor/recents-store.js'
    );
    clearRecents();
    recordRecent({ handle: '/old.docx', filename: 'old', format: 'docx' });
    recordClosedDocs([
      { handle: '/a.docx', filename: 'a', format: 'docx' },
      { handle: null, filename: 'Untitled', format: null },
      { handle: '/b.cmir', filename: 'b', format: 'cmir' },
    ]);
    expect(listRecents().map((r) => r.filename)).toEqual(['a', 'b', 'old']);
  });

  it('moves an already-listed doc to the top', async () => {
    const { recordClosedDocs, recordRecent, listRecents, clearRecents } = await import(
      '../../src/editor/recents-store.js'
    );
    clearRecents();
    recordRecent({ handle: '/x.docx', filename: 'x', format: 'docx' });
    recordRecent({ handle: '/y.docx', filename: 'y', format: 'docx' });
    recordClosedDocs([{ handle: '/x.docx', filename: 'x', format: 'docx' }]);
    expect(listRecents().map((r) => r.filename)).toEqual(['x', 'y']);
  });
});
