// @vitest-environment jsdom
/**
 * Recent-workspaces store — the "reopen these N docs together"
 * suggestion, mirroring recents-store.test.ts's cap / de-dup /
 * cross-window-sync coverage. See recent-workspaces-store.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  listRecentWorkspaces,
  recordRecentWorkspace,
  removeRecentWorkspace,
  subscribeRecentWorkspaces,
  type RecentWorkspace,
  type RecentWorkspaceDoc,
} from '../../src/editor/recent-workspaces-store.js';

const KEY = 'pmd-recent-workspaces';

beforeEach(() => {
  localStorage.clear();
});

function docs(...paths: string[]): RecentWorkspaceDoc[] {
  return paths.map((p) => ({ handle: p, filename: p.split('/').pop()!, format: 'cmir' as const }));
}

describe('recent workspaces store', () => {
  it('does not record a single-doc "workspace" — nothing to suggest beyond plain Recents', () => {
    recordRecentWorkspace(docs('/w/a.cmir'));
    expect(listRecentWorkspaces()).toEqual([]);
  });

  it('records a 2+ doc workspace, newest first', () => {
    recordRecentWorkspace(docs('/w/aff.docx', '/w/neg.docx'));
    const items = listRecentWorkspaces();
    expect(items).toHaveLength(1);
    expect(items[0]!.docs.map((d) => d.handle)).toEqual(['/w/aff.docx', '/w/neg.docx']);
  });

  it('re-closing the same set of docs moves the entry to the front instead of duplicating', () => {
    recordRecentWorkspace(docs('/w/a.cmir', '/w/b.cmir'));
    recordRecentWorkspace(docs('/w/c.cmir', '/w/d.cmir'));
    recordRecentWorkspace(docs('/w/a.cmir', '/w/b.cmir'));
    const items = listRecentWorkspaces();
    expect(items).toHaveLength(2);
    expect(items[0]!.docs.map((d) => d.handle)).toEqual(['/w/a.cmir', '/w/b.cmir']);
  });

  it('same doc set in a different pane order still de-dupes (identity ignores order)', () => {
    recordRecentWorkspace(docs('/w/a.cmir', '/w/b.cmir'));
    recordRecentWorkspace(docs('/w/b.cmir', '/w/a.cmir'));
    expect(listRecentWorkspaces()).toHaveLength(1);
  });

  it('caps at 5, oldest rotated out', () => {
    for (let i = 1; i <= 6; i++) {
      recordRecentWorkspace(docs(`/w/${i}-a.cmir`, `/w/${i}-b.cmir`));
    }
    const items = listRecentWorkspaces();
    expect(items).toHaveLength(5);
    expect(items[0]!.docs[0]!.handle).toBe('/w/6-a.cmir');
    expect(items.some((w) => w.docs[0]!.handle === '/w/1-a.cmir')).toBe(false);
  });

  it('removeRecentWorkspace drops by id', () => {
    recordRecentWorkspace(docs('/w/a.cmir', '/w/b.cmir'));
    const id = listRecentWorkspaces()[0]!.id;
    removeRecentWorkspace(id);
    expect(listRecentWorkspaces()).toEqual([]);
  });

  it('a storage event for our key re-notifies subscribers (cross-window write)', () => {
    const seen: RecentWorkspace[][] = [];
    const unsubscribe = subscribeRecentWorkspaces((items) => seen.push(items));
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          id: '/w/x.cmir /w/y.cmir',
          docs: docs('/w/x.cmir', '/w/y.cmir'),
          closedAt: 5,
        },
      ]),
    );
    expect(seen).toHaveLength(0);
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.map((w) => w.id)).toEqual(['/w/x.cmir /w/y.cmir']);
    unsubscribe();
  });

  it('ignores storage events for unrelated keys', () => {
    let calls = 0;
    const unsubscribe = subscribeRecentWorkspaces(() => calls++);
    window.dispatchEvent(new StorageEvent('storage', { key: 'pmd-settings' }));
    expect(calls).toBe(0);
    unsubscribe();
  });
});
