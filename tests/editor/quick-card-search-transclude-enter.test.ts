// @vitest-environment jsdom
/**
 * "Insert Linked Copy from a File" opens the palette in transclude mode. There,
 * Enter on a file goes INSIDE it (like Tab) so a heading can be picked; it used
 * to open the document, which for a file that was already open only said
 * "<name> is already open".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostState = vi.hoisted(() => ({
  files: [] as Array<{ path: string; relPath: string; mtimeMs: number; size: number }>,
  taglines: {} as Record<string, import('../../src/editor/tagline-search.js').TaglineRecord>,
  bytesByPath: new Map<string, Uint8Array>(),
}));

vi.mock('../../src/editor/host/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/host/index.js')>();
  return {
    ...mod,
    getElectronHost: () => ({
      readFileAtPath: async (p: string) => {
        const bytes = hostState.bytesByPath.get(p);
        if (!bytes) return null;
        return { name: p.split('/').pop()!, bytes, handle: p, format: 'cmir' as const };
      },
    }),
  };
});
vi.mock('../../src/editor/file-search-client.js', async () => {
  const { makeFakeFileIndexClient } = await import('./_fake-file-index.js');
  return {
    getFileIndexClient: async () => makeFakeFileIndexClient(hostState),
    setFileIndexClientForTests: () => {},
  };
});
vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';
import { extractTaglines } from '../../src/editor/tagline-search.js';
import { quickCardSearchUI } from '../../src/editor/quick-card-search-ui.js';
import { settings } from '../../src/editor/settings.js';

const n = schema.nodes;
const doc = (): PMNode =>
  n['doc']!.createChecked(null, [
    n['block']!.create({ id: newHeadingId() }, schema.text('Cap K')),
    n['card']!.createChecked(null, [
      n['tag']!.create({ id: newHeadingId() }, schema.text('Cap bad')),
      n['cite_paragraph']!.create(null, schema.text('Smith 20', [schema.marks['cite_mark']!.create()])),
      n['card_body']!.create(null, schema.text('body words here')),
    ]),
  ]);

const fakeView = { editable: true, focus: () => {}, hasFocus: () => false } as unknown as EditorView;
const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.pmd-qcs-input')!;
function type(q: string): void {
  input().value = q;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}
const press = (key: string): void => {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const hints = (): string => document.querySelector('.pmd-qcs-hints')?.textContent ?? '';
const rowTexts = (): string[] =>
  [...document.querySelectorAll('.pmd-qcs-row')].map((r) => r.textContent ?? '');

let opened: string[];
beforeEach(() => {
  const d = doc();
  hostState.files = [{ path: '/root/Cap K.cmir', relPath: 'Cap K.cmir', mtimeMs: 5, size: 1 }];
  hostState.taglines = { '/root/Cap K.cmir': extractTaglines(d) };
  hostState.bytesByPath = new Map([['/root/Cap K.cmir', serializeNative(d)]]);
  settings.set('fileSearchRoots', ['/root']);
  opened = [];
});
afterEach(() => {
  if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
  document.body.innerHTML = '';
});

describe('Enter on a file while inserting a linked copy from a file', () => {
  it('goes inside the file instead of opening it', async () => {
    quickCardSearchUI.open({
      view: fakeView,
      runCommand: () => {},
      openFilePath: (p) => opened.push(p),
      transcludeMode: true,
      docPath: '/root/1NC.cmir',
    });
    type('f cap');
    await settle();
    await settle();
    expect(hints()).toContain('↵ search inside');
    press('Enter');
    await settle();
    await settle();
    expect(opened).toEqual([]);
    // Now inside the file: its headings are listed.
    expect(rowTexts().some((t) => t.includes('Cap K'))).toBe(true);
  });

  it('still opens the file on Enter in the normal palette', async () => {
    quickCardSearchUI.open({
      view: fakeView,
      runCommand: () => {},
      openFilePath: (p) => opened.push(p),
    });
    type('f cap');
    await settle();
    await settle();
    expect(hints()).toContain('↵ open');
    press('Enter');
    await settle();
    expect(opened).toEqual(['/root/Cap K.cmir']);
  });
});
