// @vitest-environment jsdom

/**
 * Home screen's unified Recent list: recently opened single files and
 * recently closed multi-pane workspaces render as ONE interleaved,
 * newest-first list (home-screen.ts's renderRecents()) instead of a
 * file living in "Recent" and a workspace living in a separate
 * (previously never-mounted) "Recent Workspaces" section.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homeScreen, type HomeScreenCallbacks } from '../../src/editor/home-screen.js';
import type { RecentFile } from '../../src/editor/recents-store.js';
import type { RecentWorkspace } from '../../src/editor/recent-workspaces-store.js';

const FILES_KEY = 'pmd-recent-files';
const WORKSPACES_KEY = 'pmd-recent-workspaces';

function seedFile(f: RecentFile): void {
  const existing: RecentFile[] = JSON.parse(localStorage.getItem(FILES_KEY) ?? '[]');
  localStorage.setItem(FILES_KEY, JSON.stringify([f, ...existing]));
}

function seedWorkspace(w: RecentWorkspace): void {
  const existing: RecentWorkspace[] = JSON.parse(localStorage.getItem(WORKSPACES_KEY) ?? '[]');
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify([w, ...existing]));
}

function makeCallbacks(): HomeScreenCallbacks & {
  openRecent: ReturnType<typeof vi.fn>;
  reopenRecentWorkspace: ReturnType<typeof vi.fn>;
} {
  return {
    newDoc: vi.fn(),
    newSpeechDoc: vi.fn(),
    open: vi.fn(),
    openRecent: vi.fn(),
    manageQuickCards: vi.fn(),
    reopenRecentWorkspace: vi.fn(),
  };
}

const recentsEl = (): HTMLElement => document.querySelector<HTMLElement>('.pmd-home-recents')!;
const rows = (): Element[] => Array.from(recentsEl().children);

describe('home screen — unified Recent list', () => {
  let cb: ReturnType<typeof makeCallbacks>;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    homeScreen.hide();
  });

  it('interleaves files and workspaces newest-first by their own timestamp', () => {
    seedFile({ handle: '/f/old.cmir', filename: 'old.cmir', format: 'cmir', lastOpenedAt: 1000 });
    seedWorkspace({
      id: '/w/a.cmir /w/b.cmir',
      docs: [
        { handle: '/w/a.cmir', filename: 'a.cmir', format: 'cmir' },
        { handle: '/w/b.cmir', filename: 'b.cmir', format: 'cmir' },
      ],
      closedAt: 2000,
    });
    seedFile({ handle: '/f/new.cmir', filename: 'new.cmir', format: 'cmir', lastOpenedAt: 3000 });

    cb = makeCallbacks();
    homeScreen.mount(document.body, cb);
    homeScreen.show();

    const list = rows();
    expect(list).toHaveLength(3);
    // Newest (3000, a file) first, then the workspace (2000), then the
    // oldest file (1000) — ordering crosses the file/workspace boundary.
    expect(list[0]!.className).toContain('pmd-home-recent');
    expect(list[0]!.textContent).toContain('new.cmir');
    expect(list[1]!.className).toContain('pmd-home-recent-workspace');
    expect(list[2]!.textContent).toContain('old.cmir');
  });

  it('clicking a workspace row calls reopenRecentWorkspace with that entry', () => {
    const ws: RecentWorkspace = {
      id: '/w/a.cmir /w/b.cmir',
      docs: [
        { handle: '/w/a.cmir', filename: 'a.cmir', format: 'cmir' },
        { handle: '/w/b.cmir', filename: 'b.cmir', format: 'cmir' },
      ],
      closedAt: 1000,
    };
    seedWorkspace(ws);
    cb = makeCallbacks();
    homeScreen.mount(document.body, cb);
    homeScreen.show();

    recentsEl().querySelector<HTMLButtonElement>('.pmd-home-workspace-open')!.click();
    expect(cb.reopenRecentWorkspace).toHaveBeenCalledTimes(1);
    expect(cb.reopenRecentWorkspace.mock.calls[0]![0].id).toBe(ws.id);
  });

  it('the workspace row\'s "forget" button removes it without reopening', () => {
    seedWorkspace({
      id: '/w/a.cmir /w/b.cmir',
      docs: [
        { handle: '/w/a.cmir', filename: 'a.cmir', format: 'cmir' },
        { handle: '/w/b.cmir', filename: 'b.cmir', format: 'cmir' },
      ],
      closedAt: 1000,
    });
    cb = makeCallbacks();
    homeScreen.mount(document.body, cb);
    homeScreen.show();

    recentsEl().querySelector<HTMLButtonElement>('.pmd-home-session-forget')!.click();
    expect(cb.reopenRecentWorkspace).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
    expect(recentsEl().textContent).toContain('Nothing recent yet.');
  });

  it('omits workspace rows entirely when the host has no reopenRecentWorkspace callback', () => {
    seedWorkspace({
      id: '/w/a.cmir /w/b.cmir',
      docs: [
        { handle: '/w/a.cmir', filename: 'a.cmir', format: 'cmir' },
        { handle: '/w/b.cmir', filename: 'b.cmir', format: 'cmir' },
      ],
      closedAt: 1000,
    });
    seedFile({ handle: '/f/a.cmir', filename: 'a.cmir', format: 'cmir', lastOpenedAt: 2000 });
    cb = makeCallbacks();
    cb.reopenRecentWorkspace = undefined as unknown as ReturnType<typeof vi.fn>;
    delete (cb as Partial<HomeScreenCallbacks>).reopenRecentWorkspace;
    homeScreen.mount(document.body, cb);
    homeScreen.show();

    expect(rows()).toHaveLength(1);
    expect(recentsEl().querySelector('.pmd-home-recent-workspace')).toBeNull();
  });

  it('shows "Nothing recent yet." only when both lists are empty', () => {
    cb = makeCallbacks();
    homeScreen.mount(document.body, cb);
    homeScreen.show();
    expect(recentsEl().textContent).toContain('Nothing recent yet.');
  });

  it('Clear empties both the files and workspaces lists', () => {
    seedFile({ handle: '/f/a.cmir', filename: 'a.cmir', format: 'cmir', lastOpenedAt: 1000 });
    seedWorkspace({
      id: '/w/a.cmir /w/b.cmir',
      docs: [
        { handle: '/w/a.cmir', filename: 'a.cmir', format: 'cmir' },
        { handle: '/w/b.cmir', filename: 'b.cmir', format: 'cmir' },
      ],
      closedAt: 2000,
    });
    cb = makeCallbacks();
    homeScreen.mount(document.body, cb);
    homeScreen.show();
    expect(rows()).toHaveLength(2);

    // The "Last workspace" section's own "Forget" button reuses the same
    // .pmd-home-recents-clear class for its chromeless styling — scope
    // the query to the Recent section so this doesn't grab that one.
    document
      .querySelector<HTMLButtonElement>('.pmd-home-recents-section .pmd-home-recents-clear')!
      .click();
    expect(rows()).toHaveLength(1);
    expect(recentsEl().textContent).toContain('Nothing recent yet.');
    expect(localStorage.getItem(FILES_KEY)).toBe('[]');
    expect(localStorage.getItem(WORKSPACES_KEY)).toBe('[]');
  });
});
