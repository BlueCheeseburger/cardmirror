// @vitest-environment jsdom
/**
 * A document with no unsaved edits follows the file when someone else
 * saves it (disk-auto-apply.ts + the scheduler in disk-conflict.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo } from 'prosemirror-history';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { serializeNativeAsync } from '../../src/index.js';

let diskBytes: Uint8Array | null = null;
vi.mock('../../src/editor/host/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/host/index.js')>();
  return {
    ...mod,
    getElectronHost: () => ({
      readFileAtPath: async (handle: string) =>
        diskBytes ? { bytes: diskBytes, name: 'Aff.cmir', handle, format: 'cmir' as const } : null,
    }),
  };
});

import {
  autoApplyDiskChange,
  patchViewToDoc,
  DISK_SYNC_META,
  type AutoApplyTarget,
} from '../../src/editor/disk-auto-apply.js';
import {
  noteDocRegistered,
  noteDiskChanged,
  diskInfoFor,
  setAutoApplyHandler,
  AUTO_APPLY_SETTLE_MS,
  __resetDiskConflictForTests,
} from '../../src/editor/disk-conflict.js';
import { settings } from '../../src/editor/settings.js';

const H = '/Dropbox/Aff.cmir';

function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
const docOf = (...cards: PMNode[]): PMNode => schema.nodes['doc']!.createChecked(null, cards);

function mount(doc: PMNode): { view: EditorView; metas: unknown[] } {
  const metas: unknown[] = [];
  const view: EditorView = new EditorView(document.body.appendChild(document.createElement('div')), {
    state: EditorState.create({ doc, plugins: [history()] }),
    dispatchTransaction(tr) {
      metas.push(tr.getMeta(DISK_SYNC_META));
      view.updateState(view.state.apply(tr));
    },
  });
  return { view, metas };
}

const c1 = card('One', 'first body');
const c2 = card('Two', 'second body');
const c2b = card('Two', 'second body, edited by them');

function target(view: EditorView, over: Partial<AutoApplyTarget> = {}): AutoApplyTarget & { cleaned: number; claimed: number } {
  const t = {
    view,
    format: 'cmir' as const,
    isDirty: () => false,
    isSuppressed: () => false,
    inSession: () => false,
    hasLiveLinks: () => false,
    markClean: () => {
      t.cleaned++;
    },
    claimBaseline: async () => {
      t.claimed++;
    },
    cleaned: 0,
    claimed: 0,
    ...over,
  };
  return t;
}

async function writeDisk(doc: PMNode): Promise<void> {
  diskBytes = await serializeNativeAsync(doc, { docId: 'doc-1' });
}

beforeEach(() => {
  diskBytes = null;
  __resetDiskConflictForTests();
});
afterEach(() => {
  __resetDiskConflictForTests();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('patchViewToDoc', () => {
  it('replaces only the differing span, keeping the caret and skipping history', () => {
    const { view } = mount(docOf(c1, c2));
    // Caret inside the FIRST card, which the change doesn't touch.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    const caret = view.state.selection.from;
    expect(patchViewToDoc(view, docOf(c1, c2b))).toBe(true);
    expect(view.state.doc.eq(docOf(c1, c2b))).toBe(true);
    expect(view.state.selection.from).toBe(caret);
    // The patch is not an undoable edit.
    expect(undo(view.state, () => {})).toBe(false);
  });

  it('marks the transaction so dispatchers skip dirty and autosave', () => {
    const { view, metas } = mount(docOf(c1, c2));
    patchViewToDoc(view, docOf(c1, c2b));
    expect(metas.at(-1)).toBe(true);
  });

  it('does nothing when the documents already match', () => {
    const { view, metas } = mount(docOf(c1, c2));
    expect(patchViewToDoc(view, docOf(c1, c2))).toBe(false);
    expect(metas).toEqual([]);
  });

  it('handles an insertion and a removal', () => {
    const { view } = mount(docOf(c1));
    patchViewToDoc(view, docOf(c1, c2));
    expect(view.state.doc.childCount).toBe(2);
    patchViewToDoc(view, docOf(c2));
    expect(view.state.doc.eq(docOf(c2))).toBe(true);
  });
});

describe('autoApplyDiskChange', () => {
  it('applies the file to a clean document and claims the new baseline', async () => {
    const { view } = mount(docOf(c1, c2));
    await writeDisk(docOf(c1, c2b));
    const t = target(view);
    expect(await autoApplyDiskChange(H, t)).toBe('applied');
    expect(view.state.doc.textContent).toContain('edited by them');
    expect(t.cleaned).toBe(1);
    expect(t.claimed).toBe(1);
  });

  it('reports a sync-client touch (same content) as unchanged, without a dispatch', async () => {
    const { view, metas } = mount(docOf(c1, c2));
    await writeDisk(docOf(c1, c2));
    expect(await autoApplyDiskChange(H, target(view))).toBe('unchanged');
    expect(metas).toEqual([]);
  });

  it('leaves the pill alone for unsaved edits, a session, live links or an unreadable file', async () => {
    const { view } = mount(docOf(c1, c2));
    await writeDisk(docOf(c1, c2b));
    expect(await autoApplyDiskChange(H, target(view, { isDirty: () => true }))).toBe('skipped');
    expect(await autoApplyDiskChange(H, target(view, { inSession: () => true }))).toBe('skipped');
    expect(await autoApplyDiskChange(H, target(view, { hasLiveLinks: () => true }))).toBe('skipped');
    expect(view.state.doc.textContent).not.toContain('edited by them');
    diskBytes = null;
    expect(await autoApplyDiskChange(H, target(view))).toBe('skipped');
    diskBytes = new TextEncoder().encode('not a cardmirror file');
    expect(await autoApplyDiskChange(H, target(view))).toBe('skipped');
  });

  it('defers during read mode / the timer, then applies once it clears', async () => {
    const { view } = mount(docOf(c1, c2));
    await writeDisk(docOf(c1, c2b));
    let suppressed = true;
    const t = target(view, { isSuppressed: () => suppressed });
    expect(await autoApplyDiskChange(H, t)).toBe('deferred');
    expect(view.state.doc.textContent).not.toContain('edited by them');
    suppressed = false;
    expect(await autoApplyDiskChange(H, t)).toBe('applied');
  });

  it('skips when the user starts editing while the file is being read', async () => {
    const { view } = mount(docOf(c1, c2));
    await writeDisk(docOf(c1, c2b));
    let dirty = false;
    const t = target(view, { isDirty: () => dirty });
    // Flip dirty right after the first guard check passes (the read is async).
    const original = t.isDirty;
    let calls = 0;
    t.isDirty = () => {
      calls++;
      if (calls >= 2) dirty = true;
      return original();
    };
    expect(await autoApplyDiskChange(H, t)).toBe('skipped');
    expect(view.state.doc.textContent).not.toContain('edited by them');
  });
});

describe('scheduling from the change poller', () => {
  it('applies after the settle delay and clears the amber state', async () => {
    vi.useFakeTimers();
    noteDocRegistered(H, 'fresh', 'dropbox');
    const handler = vi.fn(async () => 'applied' as const);
    setAutoApplyHandler(handler);
    noteDiskChanged(H);
    expect(diskInfoFor(H)?.state).toBe('changed');
    expect(handler).not.toHaveBeenCalled(); // waits for the sync client to finish writing
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_SETTLE_MS + 10);
    expect(handler).toHaveBeenCalledWith(H);
    expect(diskInfoFor(H)?.state).toBe('synced');
  });

  it('keeps the pill when the handler skips', async () => {
    vi.useFakeTimers();
    noteDocRegistered(H, 'fresh', 'dropbox');
    setAutoApplyHandler(async () => 'skipped');
    noteDiskChanged(H);
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_SETTLE_MS + 10);
    expect(diskInfoFor(H)?.state).toBe('changed');
  });

  it('retries a deferred change until read mode / the timer clears', async () => {
    vi.useFakeTimers();
    noteDocRegistered(H, 'fresh', 'dropbox');
    let suppressed = true;
    const handler = vi.fn(async () => (suppressed ? ('deferred' as const) : ('applied' as const)));
    setAutoApplyHandler(handler);
    noteDiskChanged(H);
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_SETTLE_MS + 10);
    expect(diskInfoFor(H)?.state).toBe('changed');
    suppressed = false;
    await vi.advanceTimersByTimeAsync(6000);
    expect(diskInfoFor(H)?.state).toBe('synced');
  });

  it('does nothing when the setting is off', async () => {
    vi.useFakeTimers();
    settings.set('autoApplyDiskChanges', false);
    noteDocRegistered(H, 'fresh', 'dropbox');
    const handler = vi.fn(async () => 'applied' as const);
    setAutoApplyHandler(handler);
    noteDiskChanged(H);
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_SETTLE_MS + 10);
    expect(handler).not.toHaveBeenCalled();
    expect(diskInfoFor(H)?.state).toBe('changed');
    settings.set('autoApplyDiskChanges', true);
  });

  it('is on by default', async () => {
    localStorage.clear();
    vi.resetModules();
    const fresh = await import('../../src/editor/settings.js');
    expect(fresh.settings.get('autoApplyDiskChanges')).toBe(true);
  });
});
