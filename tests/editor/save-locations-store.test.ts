// @vitest-environment jsdom
/**
 * Remembered save folders (save-locations-store.ts) — the list behind
 * the Save As dialog's "Save in a previously saved location" section.
 * Ordering, pinning, the unpinned cap, and the path helpers that build
 * the destination a click writes into.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  listSaveLocations,
  recordSaveLocation,
  toggleSaveLocationPin,
  removeSaveLocation,
  saveLocationsExpanded,
  setSaveLocationsExpanded,
  dirnameOf,
  joinPath,
} from '../../src/editor/save-locations-store.js';

const dirs = (): string[] => listSaveLocations().map((l) => l.dir);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('save locations store', () => {
  it('lists most-recently-saved-into first', () => {
    recordSaveLocation('/w/first');
    vi.advanceTimersByTime(10);
    recordSaveLocation('/w/second');
    expect(dirs()).toEqual(['/w/second', '/w/first']);
  });

  it('re-saving into a known folder refreshes its recency instead of duplicating', () => {
    recordSaveLocation('/w/a');
    vi.advanceTimersByTime(10);
    recordSaveLocation('/w/b');
    vi.advanceTimersByTime(10);
    recordSaveLocation('/w/a');
    expect(dirs()).toEqual(['/w/a', '/w/b']);
  });

  it('normalizes a trailing separator so the same folder is one entry', () => {
    recordSaveLocation('/w/a');
    recordSaveLocation('/w/a/');
    expect(dirs()).toEqual(['/w/a']);
  });

  it('ignores an empty path', () => {
    recordSaveLocation('');
    recordSaveLocation('   ');
    expect(dirs()).toEqual([]);
  });

  it('pins to the top, above more recently used folders, and unpins back into recency order', () => {
    recordSaveLocation('/w/old');
    vi.advanceTimersByTime(10);
    recordSaveLocation('/w/new');
    expect(dirs()).toEqual(['/w/new', '/w/old']);

    toggleSaveLocationPin('/w/old');
    expect(dirs()).toEqual(['/w/old', '/w/new']);
    expect(listSaveLocations()[0]!.pinnedAt).not.toBeNull();

    toggleSaveLocationPin('/w/old');
    expect(dirs()).toEqual(['/w/new', '/w/old']);
  });

  it('orders multiple pins most-recently-pinned first', () => {
    recordSaveLocation('/w/a');
    recordSaveLocation('/w/b');
    toggleSaveLocationPin('/w/a');
    vi.advanceTimersByTime(10);
    toggleSaveLocationPin('/w/b');
    expect(dirs()).toEqual(['/w/b', '/w/a']);
  });

  it('a pin survives saving into that folder again', () => {
    recordSaveLocation('/w/a');
    toggleSaveLocationPin('/w/a');
    recordSaveLocation('/w/a');
    expect(listSaveLocations()[0]).toMatchObject({ dir: '/w/a' });
    expect(listSaveLocations()[0]!.pinnedAt).not.toBeNull();
  });

  it('caps unpinned folders at 8, rotating the oldest out', () => {
    for (let i = 1; i <= 10; i++) {
      recordSaveLocation(`/w/${i}`);
      vi.advanceTimersByTime(10);
    }
    expect(dirs()).toHaveLength(8);
    expect(dirs()[0]).toBe('/w/10');
    expect(dirs()).not.toContain('/w/1');
    expect(dirs()).not.toContain('/w/2');
  });

  it('pinned folders are exempt from the cap — they never rotate out', () => {
    recordSaveLocation('/w/keep');
    toggleSaveLocationPin('/w/keep');
    for (let i = 1; i <= 12; i++) {
      vi.advanceTimersByTime(10);
      recordSaveLocation(`/w/${i}`);
    }
    expect(dirs()).toContain('/w/keep');
    expect(dirs()[0]).toBe('/w/keep');
    // Still capped overall: the pin is extra, not a bigger window.
    expect(dirs()).toHaveLength(9);
  });

  it('removeSaveLocation forgets a folder, pinned or not', () => {
    recordSaveLocation('/w/a');
    toggleSaveLocationPin('/w/a');
    removeSaveLocation('/w/a');
    expect(dirs()).toEqual([]);
  });

  it('survives a corrupt or non-array blob rather than throwing', () => {
    localStorage.setItem('pmd-save-locations', '{"not":"an array"}');
    expect(dirs()).toEqual([]);
    localStorage.setItem('pmd-save-locations', 'not json at all');
    expect(dirs()).toEqual([]);
    // And a partially-bad array keeps only the well-formed entries.
    localStorage.setItem(
      'pmd-save-locations',
      JSON.stringify([{ dir: '/w/ok', lastSavedAt: 1, pinnedAt: null }, { dir: 5 }, null]),
    );
    expect(dirs()).toEqual(['/w/ok']);
  });

  it('the disclosure state starts closed and then persists', () => {
    expect(saveLocationsExpanded()).toBe(false);
    setSaveLocationsExpanded(true);
    expect(saveLocationsExpanded()).toBe(true);
    setSaveLocationsExpanded(false);
    expect(saveLocationsExpanded()).toBe(false);
  });
});

describe('path helpers', () => {
  it('dirnameOf takes the directory part of POSIX and Windows paths', () => {
    expect(dirnameOf('/w/round3/1nc.docx')).toBe('/w/round3');
    expect(dirnameOf('C:\\Debate\\Round 3\\1nc.docx')).toBe('C:\\Debate\\Round 3');
    // A file at the root keeps the root separator rather than going empty.
    expect(dirnameOf('/1nc.docx')).toBe('/');
    expect(dirnameOf('1nc.docx')).toBe('');
  });

  it('joinPath keeps the separator style the directory already uses', () => {
    expect(joinPath('/w/round3', '1nc.docx')).toBe('/w/round3/1nc.docx');
    expect(joinPath('C:\\Debate', '1nc.docx')).toBe('C:\\Debate\\1nc.docx');
  });

  it('joinPath does not double the separator at a root or a trailing slash', () => {
    expect(joinPath('/', '1nc.docx')).toBe('/1nc.docx');
    expect(joinPath('/w/round3/', '1nc.docx')).toBe('/w/round3/1nc.docx');
    expect(joinPath('C:\\', '1nc.docx')).toBe('C:\\1nc.docx');
  });
});
