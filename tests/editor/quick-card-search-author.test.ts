// @vitest-environment jsdom
/**
 * `e a <name>` (author search) in Search Everything: the author's cards, then
 * the headings in the user's files that answer them, each group titled, the
 * responses labelled "RESPONSE TO <NAME>" with the attack word that matched.
 * Enter on a block heading inserts the whole block; on a tag, the card.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostState = vi.hoisted(() => ({
  files: [] as Array<{ path: string; relPath: string; mtimeMs: number; size: number }>,
  taglines: {} as Record<string, import('../../src/editor/tagline-search.js').TaglineRecord>,
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
    insertSpeechSlice: (_view: unknown, slice: unknown, _atEnd: boolean, after?: () => void) => {
      hostState.inserted.push(slice);
      after?.();
    },
  };
});
vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';
import { extractTaglines } from '../../src/editor/tagline-search.js';
import { DEFAULT_ATTACK_WORDS, parseAttackWords } from '../../src/editor/author-search.js';
import { quickCardSearchUI } from '../../src/editor/quick-card-search-ui.js';
import { settings } from '../../src/editor/settings.js';
import { showToast } from '../../src/editor/toast.js';

const n = schema.nodes;
const card = (tag: string, cite: string, body: string): PMNode =>
  n['card']!.createChecked(null, [
    n['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    n['cite_paragraph']!.create(null, schema.text(cite, [schema.marks['cite_mark']!.create()])),
    n['card_body']!.create(null, schema.text(body)),
  ]);
const block = (text: string): PMNode => n['block']!.create({ id: newHeadingId() }, schema.text(text));

function shellDoc(): PMNode {
  return n['doc']!.createChecked(null, [
    block('AT: Stein'),
    card('Stein is a hack: funded by industry', 'Park 20', 'park body words'),
    card('Stein fails on causation', 'Wu 21', 'wu body words'),
    block('Tariffs'),
    card('Tariffs raise prices', 'Stein 21', 'stein body words'),
  ]);
}

const fakeView = { editable: true, focus: () => {}, hasFocus: () => false } as unknown as EditorView;
const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.pmd-qcs-input')!;
function type(q: string): void {
  input().value = q;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}
const press = (key: string): void => {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pmd-qcs-row')];
const sections = (): string[] => [...document.querySelectorAll('.pmd-qcs-section')].map((e) => e.textContent ?? '');
const emptyText = (): string => document.querySelector('.pmd-qcs-empty')?.textContent ?? '';
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const badge = (row: HTMLElement): string => row.querySelector('.pmd-qcs-row-badge')?.textContent ?? '';

beforeEach(() => {
  const doc = shellDoc();
  hostState.files = [{ path: '/root/Shell.cmir', relPath: 'Shell.cmir', mtimeMs: 5, size: 1 }];
  hostState.taglines = { '/root/Shell.cmir': extractTaglines(doc) };
  hostState.bytesByPath = new Map([['/root/Shell.cmir', serializeNative(doc)]]);
  hostState.inserted = [];
  settings.set('fileSearchRoots', ['/root']);
  vi.mocked(showToast).mockClear();
  quickCardSearchUI.open({ view: fakeView, runCommand: () => {}, openFilePath: () => {} });
});
afterEach(() => {
  if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
  document.body.innerHTML = '';
});

describe('e a <name>', () => {
  it('asks for a name before anything is typed', async () => {
    type('e a ');
    await settle();
    expect(emptyText()).toMatch(/Type an author’s last name/);
  });

  it("lists the author's cards, then the responses to them, then headings that only name them", async () => {
    type('e a stein');
    await settle();
    await settle();
    expect(sections()).toEqual([
      'CARDS BY STEIN · 1',
      'RESPONSES TO STEIN · 2 (STRONGEST FIRST)',
      'HEADINGS THAT NAME STEIN · 1',
    ]);
    const r = rows();
    expect(r.map((x) => badge(x))).toEqual(['STEIN', 'RESPONSE TO STEIN', 'RESPONSE TO STEIN', 'NAMES STEIN']);
    expect(r[0]!.textContent).toContain('Tariffs raise prices');
    expect(r[1]!.textContent).toContain('Stein is a hack: funded by industry'); // two attack words: first
    expect(r[2]!.textContent).toContain('AT: Stein'); // one
    expect(r[3]!.textContent).toContain('Stein fails on causation'); // none: only names them
  });

  it('shows the attack words that matched, as chips', async () => {
    type('e a stein');
    await settle();
    await settle();
    const chips = (row: HTMLElement): (string | null)[] =>
      [...row.querySelectorAll('.pmd-qcs-chip-attack')].map((c) => c.textContent);
    expect(chips(rows()[1]!)).toEqual(['hack', 'funded']);
    expect(chips(rows()[2]!)).toEqual(['AT']);
    expect(chips(rows()[3]!)).toEqual([]);
  });

  it('says what each response inserts: the whole block, or the card', async () => {
    type('e a stein');
    await settle();
    await settle();
    const snippet = (row: HTMLElement): string => row.querySelector('.pmd-qcs-row-snippet')?.textContent ?? '';
    expect(snippet(rows()[1]!)).toBe('Tag in Shell · inserts the card');
    expect(snippet(rows()[2]!)).toBe('Block in Shell · inserts the whole block');
  });

  it('narrows to a year', async () => {
    type('e a stein 19');
    await settle();
    await settle();
    expect(rows().map((r) => badge(r))).not.toContain('STEIN'); // no Stein 19 card
  });

  it('Enter on a tag response inserts just that card, and keeps the bar open', async () => {
    type('e a stein');
    await settle();
    await settle();
    press('ArrowDown'); // from the Stein card to the hack heading
    press('Enter');
    await settle();
    await settle();
    expect(hostState.inserted).toHaveLength(1);
    const { content } = hostState.inserted[0] as {
      content: { size: number; textBetween(a: number, b: number, s?: string): string };
    };
    const text = content.textBetween(0, content.size, ' ');
    expect(text).toContain('Stein is a hack');
    expect(text).toContain('park body words');
    expect(text).not.toContain('wu body words');
    expect(quickCardSearchUI.isOpen()).toBe(true);
    expect(showToast).toHaveBeenCalledWith('Inserted "Stein is a hack: funded by industry".');
  });

  it('Enter on a block response inserts the whole block, everything under it', async () => {
    type('e a stein');
    await settle();
    await settle();
    press('ArrowDown');
    press('ArrowDown'); // the AT: Stein block
    press('Enter');
    await settle();
    await settle();
    expect(hostState.inserted).toHaveLength(1);
    const { content } = hostState.inserted[0] as {
      content: { size: number; textBetween(a: number, b: number, s?: string): string };
    };
    const text = content.textBetween(0, content.size, ' ');
    expect(text).toContain('AT: Stein');
    expect(text).toContain('park body words');
    expect(text).toContain('wu body words');
    expect(text).not.toContain('stein body words'); // the next block is not part of it
  });

  it('says how to set it up when no search folder is configured', async () => {
    settings.set('fileSearchRoots', []);
    type('e a stein');
    await settle();
    expect(emptyText()).toMatch(/add a file-search folder/);
  });

  it('says nothing matched when the author is unknown', async () => {
    type('e a nobody');
    await settle();
    await settle();
    expect(emptyText()).toMatch(/No cards by Nobody and no headings that name Nobody/);
  });
});

describe('the attack-word setting', () => {
  it('defaults to the built-in list', () => {
    expect(parseAttackWords(settings.get('authorAttackWords'))).toEqual([...DEFAULT_ATTACK_WORDS]);
  });
});
