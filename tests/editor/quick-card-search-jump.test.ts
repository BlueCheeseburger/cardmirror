// @vitest-environment jsdom
/**
 * In-file right-click jump (2026-07-29): left-click on an in-file search
 * result inserts it; RIGHT-click clears the query and reveals the hit in
 * the file's outline browse — ancestors expanded, its row selected.
 * Drives the real singleton with a mocked Electron host serving a real
 * serialized .cmir fixture through the Tab dive.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostState = vi.hoisted(() => ({
  files: [] as Array<{ path: string; relPath: string; mtimeMs: number; size: number }>,
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

import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';
import { quickCardSearchUI } from '../../src/editor/quick-card-search-ui.js';
import { settings } from '../../src/editor/settings.js';

const n = schema.nodes;
function fixtureDoc(): PMNode {
  return n['doc']!.create(null, [
    n['pocket']!.create({ id: 'P' }, schema.text('THE POCKET')),
    n['block']!.create({ id: 'B' }, schema.text('HEG BLOCK')),
    n['card']!.create(null, [
      n['tag']!.create({ id: 'T1' }, schema.text('NEEDLE TAG ALPHA')),
      n['card_body']!.create(null, schema.text('body words')),
    ]),
    n['block']!.create({ id: 'B2' }, schema.text('OTHER BLOCK')),
    n['card']!.create(null, [
      n['tag']!.create({ id: 'T2' }, schema.text('OTHER TAG')),
      n['card_body']!.create(null, schema.text('more words')),
    ]),
  ]);
}

function openPalette(): void {
  quickCardSearchUI.open({
    view: null,
   
    runCommand: () => {},
    openFilePath: () => {},
  });
}

const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.pmd-qcs-input')!;

function type(q: string): void {
  const el = input();
  el.value = q;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressTab(): void {
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
}

const rowNames = (): string[] =>
  [...document.querySelectorAll('.pmd-qcs-row-name')].map((el) => el.textContent ?? '');

const activeRowName = (): string | null =>
  document.querySelector('.pmd-qcs-row-active .pmd-qcs-row-name')?.textContent ?? null;

/** Let async palette steps (list load, dive read/parse) settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  hostState.files = [{ path: '/root/Case.cmir', relPath: 'Case.cmir', mtimeMs: 5, size: 1 }];
  hostState.bytesByPath = new Map([['/root/Case.cmir', serializeNative(fixtureDoc())]]);
  settings.set('fileSearchRoots', ['/root']);
});

afterEach(() => {
  if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
  document.body.innerHTML = '';
});

/** Open, dive into the fixture file, and land in in-file mode. */
async function diveIntoCase(): Promise<void> {
  openPalette();
  await settle();
  type('f case');
  await settle(); // ranked rows arrive async from the (fake) service
  pressTab();
  await settle();
  await settle(); // read + parse round-trips
}

describe('palette in-file right-click jump', () => {
  it('right-click clears the query and reveals the hit in the outline, expanded + selected', async () => {
    await diveIntoCase();

    type('needle');
    const hit = [...document.querySelectorAll('.pmd-qcs-row')].find((r) =>
      r.textContent?.includes('NEEDLE TAG ALPHA'),
    )!;
    expect(hit).toBeTruthy();
    hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    // Query cleared → outline browse, with the hit's collapsed ancestor
    // (its block; default outline depth starts blocks closed) expanded.
    expect(input().value).toBe('');
    expect(rowNames()).toContain('THE POCKET');
    expect(rowNames()).toContain('NEEDLE TAG ALPHA');
    expect(activeRowName()).toBe('NEEDLE TAG ALPHA');
    // Sibling subtrees stay closed: the other block's tag is not revealed.
    expect(rowNames()).not.toContain('OTHER TAG');
  });

  it('right-click on an outline row still toggles collapse (unchanged behavior)', async () => {
    await diveIntoCase();
    // Empty query = outline browse; blocks start collapsed (depth 3).
    expect(rowNames()).toContain('HEG BLOCK');
    expect(rowNames()).not.toContain('NEEDLE TAG ALPHA');
    const blockRow = [...document.querySelectorAll('.pmd-qcs-row')].find((r) =>
      r.textContent?.includes('HEG BLOCK'),
    )!;
    blockRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(rowNames()).toContain('NEEDLE TAG ALPHA'); // expanded, not jumped
    expect(input().value).toBe(''); // and no query games
  });
});
