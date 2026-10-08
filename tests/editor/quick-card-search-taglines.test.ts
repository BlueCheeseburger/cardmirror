// @vitest-environment jsdom
/**
 * `f c <words>` in Search Everything: card taglines inside the files already
 * in the file index. `f <words>` keeps searching file names. Enter reads the
 * file and inserts that whole card; Tab dives into the file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostState = vi.hoisted(() => ({
  files: [] as Array<{ path: string; relPath: string; mtimeMs: number; size: number }>,
  taglines: {} as Record<string, { tags: string[]; cites: string[] }>,
  bytesByPath: new Map<string, Uint8Array>(),
  inserted: [] as unknown[],
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

vi.mock('../../src/editor/speech-doc-send.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/speech-doc-send.js')>();
  return {
    ...mod,
    insertSpeechSlice: (_view: unknown, slice: unknown) => {
      hostState.inserted.push(slice);
    },
  };
});
vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';
import { extractTaglines } from '../../src/editor/tagline-search.js';
import { quickCardSearchUI } from '../../src/editor/quick-card-search-ui.js';
import { settings } from '../../src/editor/settings.js';
import { showToast } from '../../src/editor/toast.js';
import type { EditorView } from 'prosemirror-view';

const n = schema.nodes;
function fixtureDoc(): PMNode {
  return n['doc']!.create(null, [
    n['card']!.create(null, [
      n['tag']!.create({ id: 'T1' }, schema.text('Heg decline causes war')),
      n['card_body']!.create(null, schema.text('first body words')),
    ]),
    n['card']!.create(null, [
      n['tag']!.create({ id: 'T2' }, schema.text('Warming is fast')),
      n['card_body']!.create(null, schema.text('second body words')),
    ]),
  ]);
}

const fakeView = { editable: true, focus: () => {}, hasFocus: () => false } as unknown as EditorView;

function openPalette(): void {
  quickCardSearchUI.open({ view: fakeView, runCommand: () => {}, openFilePath: () => {} });
}
const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.pmd-qcs-input')!;
function type(q: string): void {
  input().value = q;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}
const press = (key: string): void => {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pmd-qcs-row')];
const emptyText = (): string => document.querySelector('.pmd-qcs-empty')?.textContent ?? '';
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  const doc = fixtureDoc();
  hostState.files = [{ path: '/root/Case.cmir', relPath: 'Case.cmir', mtimeMs: 5, size: 1 }];
  hostState.taglines = { '/root/Case.cmir': extractTaglines(doc) };
  hostState.bytesByPath = new Map([['/root/Case.cmir', serializeNative(doc)]]);
  hostState.inserted = [];
  settings.set('fileSearchRoots', ['/root']);
  vi.mocked(showToast).mockClear();
});

afterEach(() => {
  if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
  document.body.innerHTML = '';
});

describe('palette `f c` (card taglines in indexed files)', () => {
  it('lists matching taglines with the file on the right', async () => {
    openPalette();
    await settle();
    type('f c warming');
    await settle();
    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0]!.textContent).toContain('Warming is fast');
    expect(r[0]!.textContent).toContain('Case');
    expect(r[0]!.textContent).toContain('CARD');
  });

  it('shows a hint before anything is typed after `f c `', async () => {
    openPalette();
    await settle();
    type('f c ');
    await settle();
    expect(rows()).toHaveLength(0);
    expect(emptyText()).toContain('tagline');
  });

  it('keeps `f <words>` as a file-name search', async () => {
    openPalette();
    await settle();
    type('f case');
    await settle();
    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0]!.textContent).toContain('Case');
    expect(r[0]!.textContent).not.toContain('CARD');
  });

  it('Enter reads the file and inserts that whole card', async () => {
    openPalette();
    await settle();
    type('f c warming');
    await settle();
    press('Enter');
    await settle();
    await settle();
    expect(hostState.inserted).toHaveLength(1);
    const { content } = hostState.inserted[0] as {
      content: { size: number; textBetween(a: number, b: number, s?: string): string };
    };
    const text = content.textBetween(0, content.size, ' ');
    expect(text).toContain('Warming is fast');
    expect(text).toContain('second body words');
    expect(text).not.toContain('first body words');
    expect(quickCardSearchUI.isOpen()).toBe(false);
  });

  it('toasts instead of inserting when the card is gone from the file', async () => {
    openPalette();
    await settle();
    type('f c warming');
    await settle();
    // The file changed since it was indexed: the tagline no longer exists.
    hostState.bytesByPath.set(
      '/root/Case.cmir',
      serializeNative(n['doc']!.create(null, [
        n['card']!.create(null, [
          n['tag']!.create({ id: 'X' }, schema.text('Something else')),
          n['card_body']!.create(null, schema.text('body')),
        ]),
      ])),
    );
    press('Enter');
    await settle();
    await settle();
    expect(hostState.inserted).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith('That card is no longer in "Case".');
  });

  it('Tab dives into the tagline’s file', async () => {
    openPalette();
    await settle();
    type('f c warming');
    await settle();
    press('Tab');
    await settle();
    await settle();
    expect(input().placeholder).toBe('Search in Case…');
  });
});
