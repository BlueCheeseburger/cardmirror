// @vitest-environment jsdom
/**
 * Bulk convert: "Choose files…" takes several files at once. Each is converted,
 * files that share a name are kept apart, and the Output choice applies to the
 * whole set (loose files, or one .zip).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  picked: [] as Array<{ name: string; bytes: Uint8Array; handle: string }>,
  writes: [] as Array<{ path: string; size: number }>,
  existing: new Set<string>(),
}));

vi.mock('../../src/editor/host/index.js', () => ({
  getHost: () => ({
    openFiles: async () => state.picked,
    openFile: async () => state.picked[0] ?? null,
  }),
  getElectronHost: () => ({
    pickDirectory: async () => '/dest',
    writeFileAtPath: async (path: string, bytes: Uint8Array) => {
      if (state.existing.has(path)) return 'collision';
      state.writes.push({ path, size: bytes.byteLength });
      return 'ok';
    },
  }),
}));
vi.mock('../../src/editor/native-to-docx.js', () => ({
  nativeBytesToDocx: async (bytes: Uint8Array) => new Uint8Array([...bytes, 1]),
}));

import { describeInput, openBulkConvert, uniqueBatchName } from '../../src/editor/bulk-convert-ui.js';

const btn = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('.pmd-bulk-btn')].find((b) => b.textContent === label)!;
const radioFor = (text: string): HTMLInputElement =>
  [...document.querySelectorAll<HTMLLabelElement>('.pmd-bulk-radio')]
    .find((l) => l.textContent === text)!
    .querySelector('input')!;
const status = (): string => document.querySelector('.pmd-bulk-status')?.textContent ?? '';
const paths = (): string[] => [...document.querySelectorAll('.pmd-bulk-path')].map((e) => e.textContent ?? '');
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const file = (name: string, handle: string) => ({ name, bytes: new Uint8Array([9, 9]), handle });

beforeEach(() => {
  state.picked = [];
  state.writes = [];
  state.existing = new Set();
  openBulkConvert();
  radioFor('.cmir → .docx').checked = true;
  radioFor('.cmir → .docx').dispatchEvent(new Event('change', { bubbles: true }));
});
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.body.innerHTML = '';
});

async function pick(files: typeof state.picked): Promise<void> {
  state.picked = files;
  btn('Choose files…').click();
  await settle();
  btn('Choose destination…').click();
  await settle();
}

describe('Choose files…', () => {
  it('shows how many files were picked and enables Convert', async () => {
    await pick([file('1NC.cmir', '/a/1NC.cmir'), file('2NC.cmir', '/a/2NC.cmir'), file('Cap K.cmir', '/a/Cap K.cmir')]);
    expect(paths()[0]).toBe('3 files: 1NC.cmir, 2NC.cmir, Cap K.cmir');
    expect(btn('Convert').disabled).toBe(false);
  });

  it('converts every picked file into the destination', async () => {
    await pick([file('1NC.cmir', '/a/1NC.cmir'), file('2NC.cmir', '/b/2NC.cmir')]);
    btn('Convert').click();
    await settle();
    await settle();
    expect(state.writes.map((w) => w.path)).toEqual(['/dest/1NC.docx', '/dest/2NC.docx']);
    expect(status()).toBe('Done — 2 converted.');
  });

  it('keeps two files with the same name apart instead of overwriting or skipping one', async () => {
    await pick([file('Neg.cmir', '/a/Neg.cmir'), file('Neg.cmir', '/b/Neg.cmir')]);
    btn('Convert').click();
    await settle();
    await settle();
    expect(state.writes.map((w) => w.path)).toEqual(['/dest/Neg.docx', '/dest/Neg (2).docx']);
  });

  it('leaves a file already in the destination alone and says so', async () => {
    state.existing.add('/dest/2NC.docx');
    await pick([file('1NC.cmir', '/a/1NC.cmir'), file('2NC.cmir', '/a/2NC.cmir')]);
    btn('Convert').click();
    await settle();
    await settle();
    expect(state.writes.map((w) => w.path)).toEqual(['/dest/1NC.docx']);
    expect(status()).toBe('Done — 1 converted, 1 skipped (already in the destination).');
  });

  it('writes one zip for the whole set when Output is a single .zip', async () => {
    await pick([file('1NC.cmir', '/a/1NC.cmir'), file('2NC.cmir', '/a/2NC.cmir')]);
    radioFor('Save as a single .zip').checked = true;
    btn('Convert').click();
    await settle();
    await settle();
    expect(state.writes.map((w) => w.path)).toEqual(['/dest/Converted files.zip']);
    expect(status()).toBe('Done — 2 converted.');
  });

  it('a single file still reads as before', async () => {
    await pick([file('1NC.cmir', '/a/1NC.cmir')]);
    expect(paths()[0]).toBe('File: /a/1NC.cmir');
    btn('Convert').click();
    await settle();
    await settle();
    expect(status()).toBe('Converted “1NC.cmir”.');
  });
});

describe('helpers', () => {
  it('uniqueBatchName numbers repeats before the extension, ignoring case', () => {
    const used = new Set<string>();
    expect(uniqueBatchName(used, 'A.docx')).toBe('A.docx');
    expect(uniqueBatchName(used, 'a.DOCX')).toBe('a (2).DOCX');
    expect(uniqueBatchName(used, 'A.docx')).toBe('A (3).docx');
  });

  it('describeInput lists the first three names and counts the rest', () => {
    const f = (name: string) => ({ path: `/x/${name}`, name, bytes: new Uint8Array() });
    expect(describeInput(null)).toBe('None selected');
    expect(describeInput({ kind: 'files', files: ['a', 'b', 'c', 'd', 'e'].map((n) => f(`${n}.cmir`)) })).toBe(
      '5 files: a.cmir, b.cmir, c.cmir, and 2 more',
    );
  });
});
