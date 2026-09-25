// @vitest-environment jsdom
/**
 * The palette's `p ` source (fork): open docs in every pane of every
 * window plus named windows, filtered by doc name or window name, with
 * Enter switching to the pick. Also the palette's width, which no longer
 * shrinks to fit a narrow pane.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostState = vi.hoisted(() => ({ host: null as unknown }));
vi.mock('../../src/editor/host/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/host/index.js')>();
  return { ...mod, getElectronHost: () => hostState.host };
});
vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

import { quickCardSearchUI, searchOpenDocsSource } from '../../src/editor/quick-card-search-ui.js';
import { setLocalOpenDocsProvider, type OpenDocEntry } from '../../src/editor/open-docs.js';
import { showToast } from '../../src/editor/toast.js';

function openPalette(paneEl: HTMLElement | null = null): void {
  quickCardSearchUI.open({ view: null, paneEl, runCommand: () => {}, openFilePath: () => {} });
}

function type(q: string): void {
  const input = document.querySelector<HTMLInputElement>('.pmd-qcs-input')!;
  input.value = q;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(): void {
  document
    .querySelector<HTMLInputElement>('.pmd-qcs-input')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

const emptyText = (): string => document.querySelector('.pmd-qcs-empty')?.textContent ?? '';
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pmd-qcs-row')];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const doc = (over: Partial<OpenDocEntry>): OpenDocEntry => ({
  uid: 'u',
  filename: 'x.cmir',
  windowId: 1,
  windowName: null,
  isOwnWindow: false,
  ...over,
});

describe('searchOpenDocsSource', () => {
  const docs = [
    doc({ uid: 'a', filename: '1AC.cmir', windowId: 1, windowName: 'Aff', isOwnWindow: true }),
    doc({ uid: 'b', filename: '2AC Blocks.docx', windowId: 1, windowName: 'Aff', isOwnWindow: true }),
    doc({ uid: 'c', filename: '1NC.cmir', windowId: 2, windowName: 'Neg' }),
    doc({ uid: 'd', filename: null, windowId: 3, windowName: null }),
  ];

  it('matches a doc by name, extension dropped, case-insensitive', () => {
    const r = searchOpenDocsSource(docs, '2ac');
    expect(r.map((x) => x.name)).toEqual(['2AC Blocks']);
    expect(r[0]!.source).toBe('opendoc');
    expect(r[0]!.meta).toBe('“Aff” (this window)');
  });

  it("a window's name finds the window and every doc in it", () => {
    const r = searchOpenDocsSource(docs, 'neg');
    expect(r.map((x) => [x.source, x.name])).toEqual([
      ['openwindow', 'Neg'],
      ['opendoc', '1NC'],
    ]);
    expect(r[0]!.meta).toBe('1NC');
  });

  it('every word must match, across doc and window name', () => {
    expect(searchOpenDocsSource(docs, 'aff 1ac').map((x) => x.name)).toEqual(['1AC']);
    expect(searchOpenDocsSource(docs, 'neg 1ac')).toEqual([]);
  });

  it('an empty query lists every doc and every named window; unnamed docs read Untitled', () => {
    const r = searchOpenDocsSource(docs, '');
    expect(r.filter((x) => x.source === 'opendoc')).toHaveLength(4);
    expect(r.filter((x) => x.source === 'openwindow').map((x) => x.name).sort()).toEqual(['Aff', 'Neg']);
    expect(r.find((x) => x.openDoc?.uid === 'd')!.name).toBe('Untitled');
    expect(r.find((x) => x.openDoc?.uid === 'd')!.meta).toBe('another window');
  });
});

describe('palette open-docs source (p prefix)', () => {
  let activate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hostState.host = null;
    activate = vi.fn(async () => true);
    setLocalOpenDocsProvider({
      list: async () => [
        { uid: 'one', filename: '1AC.cmir' },
        { uid: 'two', filename: '2AC.cmir' },
      ],
      activate,
      windowName: () => 'Aff',
    });
  });

  afterEach(() => {
    if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
    setLocalOpenDocsProvider(null);
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('is listed in the no-prefix hint', () => {
    openPalette();
    type('');
    expect(emptyText()).toContain('p open docs');
  });

  it('"p 2ac" + Enter switches to that doc', async () => {
    openPalette();
    type('p 2ac');
    await flush();
    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0]!.textContent).toContain('OPEN');
    expect(r[0]!.textContent).toContain('2AC');
    pressEnter();
    await flush();
    expect(activate).toHaveBeenCalledWith('two');
    expect(quickCardSearchUI.isOpen()).toBe(false);
  });

  it('asks the desktop host for every window, and raises another window’s doc there', async () => {
    const activateDoc = vi.fn(async () => true);
    hostState.host = {
      listDocs: async () => [
        { uid: 'n1', filename: '1NC.cmir', windowId: 7, windowTitle: 'Neg', windowName: 'Neg', isSpeech: false, isOwnWindow: false, isFocusedWindow: false },
      ],
      activateDoc,
    };
    openPalette();
    type('p neg');
    await flush();
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('WIN'),
      expect.stringContaining('1NC'),
    ]);
    type('p 1nc');
    pressEnter();
    await flush();
    expect(activateDoc).toHaveBeenCalledWith('n1');
    expect(activate).not.toHaveBeenCalled();
  });

  it('toasts when the picked doc has closed in the meantime', async () => {
    activate.mockResolvedValue(false);
    openPalette();
    type('p 1ac');
    await flush();
    pressEnter();
    await flush();
    expect(showToast).toHaveBeenCalledWith('That document is no longer open.');
  });
});

describe('palette width', () => {
  afterEach(() => {
    if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
    document.body.innerHTML = '';
  });

  it('stays full width over a narrow pane instead of shrinking to fit it', () => {
    const pane = document.createElement('div');
    document.body.appendChild(pane);
    pane.getBoundingClientRect = () =>
      ({ left: 0, width: 300, top: 0, height: 500, right: 300, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    openPalette(pane);
    const root = document.querySelector<HTMLElement>('.pmd-qcs')!;
    expect(root.style.width).toBe('540px');
    // Centered over the pane (x=150) would push the bar off the left
    // edge, so the center shifts inward: 12px margin + half of 540.
    expect(root.style.left).toBe('282px');
  });
});
