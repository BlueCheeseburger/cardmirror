// @vitest-environment jsdom
/**
 * The Compare choices in the two disk-conflict dialogs: "Compare with the
 * original" on a conflicted copy, "See what changed" on a file changed under
 * the editor. The dialogs themselves are stubbed; this drives the real
 * badge click logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const promptMock = vi.fn();
vi.mock('../../src/editor/text-prompt.js', () => ({
  promptForRouteChoice: (...args: unknown[]) => promptMock(...args),
}));
const openDocDiffMock = vi.fn(async (_preload?: unknown) => {});
vi.mock('../../src/editor/doc-diff-ui.js', () => ({
  openDocDiff: (preload?: unknown) => openDocDiffMock(preload),
}));

import {
  noteDocRegistered,
  noteDiskChanged,
  noteKeptCopy,
  createPaneDiskBadge,
  __resetDiskConflictForTests,
  type DiskBadgeDeps,
} from '../../src/editor/disk-conflict.js';
import { schema, newHeadingId } from '../../src/schema/index.js';

const ORIG = '/Dropbox/Sameer-IRS DA.docx';
const COPY = '/Dropbox/Sameer-IRS DA (Sam’s conflicted copy).docx';

const liveDoc = schema.nodes['doc']!.createChecked(null, [
  schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
    schema.nodes['card_body']!.create(null, schema.text('mine')),
  ]),
]);
const fileBytes = new Uint8Array([1, 2, 3]);

function pane(handle: string, name: string, over: Partial<DiskBadgeDeps> = {}) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const deps: DiskBadgeDeps = {
    getActive: () => ({ handle, name }),
    isSuppressed: () => false,
    isSessionHost: () => false,
    reveal: vi.fn(),
    reloadFromDisk: vi.fn(async () => {}),
    keepMineAsCopy: vi.fn(async () => {}),
    overwrite: vi.fn(async () => {}),
    openOriginal: vi.fn(async () => {}),
    getLiveDoc: vi.fn(() => liveDoc),
    readFile: vi.fn(async () => ({ name: 'x.docx', bytes: fileBytes })),
    ...over,
  };
  const badge = createPaneDiskBadge(deps, parent);
  const click = async () => {
    badge.el.click();
    await vi.waitFor(() => expect(promptMock).toHaveBeenCalled());
  };
  return { badge, deps, click };
}

const choiceValues = (): string[] =>
  (promptMock.mock.calls[0]![0] as { choices: Array<{ value: string }> }).choices.map((c) => c.value);

beforeEach(() => {
  __resetDiskConflictForTests();
  promptMock.mockReset();
  openDocDiffMock.mockClear();
});
afterEach(() => {
  __resetDiskConflictForTests();
  document.body.innerHTML = '';
});

describe('conflicted copy: Compare with the original', () => {
  function setup(over: Partial<DiskBadgeDeps> = {}) {
    noteDocRegistered(ORIG, 'fresh', 'dropbox');
    noteDocRegistered(COPY, 'fresh', 'dropbox');
    noteKeptCopy(COPY, ORIG);
    return pane(COPY, 'Sameer-IRS DA (conflicted copy).docx', over);
  }

  it('offers Compare between Open the original and Reveal', async () => {
    promptMock.mockResolvedValueOnce(null);
    const { click } = setup();
    await click();
    expect(choiceValues()).toEqual(['original', 'compare', 'reveal']);
  });

  it('compares the original on disk (left) with this window’s live copy (right)', async () => {
    promptMock.mockResolvedValueOnce('compare').mockResolvedValueOnce(null);
    const { click, deps } = setup();
    await click();
    await vi.waitFor(() => expect(openDocDiffMock).toHaveBeenCalledTimes(1));
    expect(deps.readFile).toHaveBeenCalledWith(ORIG);
    const arg = openDocDiffMock.mock.calls[0]![0] as {
      a: { name: string; bytes: Uint8Array };
      b: { name: string; doc: unknown };
    };
    expect(arg.a.bytes).toBe(fileBytes);
    expect(arg.a.name).toBe('Sameer-IRS DA.docx (original)');
    expect(arg.b.doc).toBe(liveDoc);
    expect(arg.b.name).toContain('(this copy)');
  });

  it('comes back to the choices when the comparison is closed', async () => {
    promptMock.mockResolvedValueOnce('compare').mockResolvedValueOnce(null);
    const { click } = setup();
    await click();
    await vi.waitFor(() => expect(promptMock).toHaveBeenCalledTimes(2));
  });

  it('hides Compare where the host can’t read files or hand over the live doc', async () => {
    promptMock.mockResolvedValueOnce(null);
    const { click } = setup({ getLiveDoc: undefined, readFile: undefined });
    await click();
    expect(choiceValues()).toEqual(['original', 'reveal']);
  });

  it('a missing original says so and does not open Compare or re-ask', async () => {
    promptMock.mockResolvedValueOnce('compare');
    const { click } = setup({ readFile: vi.fn(async () => null) });
    await click();
    await new Promise((r) => setTimeout(r, 20));
    expect(openDocDiffMock).not.toHaveBeenCalled();
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('moved or deleted');
  });
});

describe('changed on disk: See what changed', () => {
  function setup(over: Partial<DiskBadgeDeps> = {}) {
    noteDocRegistered(ORIG, 'fresh', 'dropbox');
    noteDiskChanged(ORIG, Date.now());
    return pane(ORIG, 'Sameer-IRS DA.docx', over);
  }

  it('is the first choice, ahead of the three ways to resolve it', async () => {
    promptMock.mockResolvedValueOnce(null);
    const { click } = setup();
    await click();
    expect(choiceValues()).toEqual(['compare', 'theirs', 'mine', 'both']);
  });

  it('compares the file on disk (left) with the live document (right), then asks again', async () => {
    promptMock.mockResolvedValueOnce('compare').mockResolvedValueOnce(null);
    const { click, deps } = setup();
    await click();
    await vi.waitFor(() => expect(promptMock).toHaveBeenCalledTimes(2));
    expect(deps.readFile).toHaveBeenCalledWith(ORIG);
    const arg = openDocDiffMock.mock.calls[0]![0] as { a: { name: string }; b: { name: string; doc: unknown } };
    expect(arg.a.name).toBe('Sameer-IRS DA.docx (on disk)');
    expect(arg.b.name).toBe('Sameer-IRS DA.docx (your version)');
    expect(arg.b.doc).toBe(liveDoc);
    // Comparing changes nothing.
    expect(deps.reloadFromDisk).not.toHaveBeenCalled();
    expect(deps.overwrite).not.toHaveBeenCalled();
    expect(deps.keepMineAsCopy).not.toHaveBeenCalled();
  });

  it('does not re-ask once the conflict has been resolved meanwhile', async () => {
    const { click, deps } = setup();
    promptMock.mockImplementationOnce(async () => {
      noteDocRegistered(ORIG, 'fresh', 'dropbox'); // the file settled back while the dialog was up
      return 'compare';
    });
    openDocDiffMock.mockImplementationOnce(async () => {
      const mod = await import('../../src/editor/disk-conflict.js');
      mod.noteReloaded(ORIG);
    });
    await click();
    await new Promise((r) => setTimeout(r, 20));
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(deps.readFile).toHaveBeenCalled();
  });

  it('leaves the old three choices when Compare isn’t available', async () => {
    promptMock.mockResolvedValueOnce(null);
    const { click } = setup({ getLiveDoc: undefined });
    await click();
    expect(choiceValues()).toEqual(['theirs', 'mine', 'both']);
  });
});
