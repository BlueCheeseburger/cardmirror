// @vitest-environment jsdom
/**
 * The palette's `g ` (Logos) source: debounced network search with a
 * searching state, rows badged LOGOS with the cite as a snippet, the
 * empty/error states, and Enter fetching the full card and inserting it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

vi.mock('../../src/editor/host/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/host/index.js')>();
  return { ...mod, getElectronHost: () => null };
});
vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../src/editor/card-preview-modal.js', () => ({ openCardPreview: vi.fn(() => true) }));

import { quickCardSearchUI } from '../../src/editor/quick-card-search-ui.js';
import { schema } from '../../src/schema/index.js';
import { showToast } from '../../src/editor/toast.js';
import { settings } from '../../src/editor/settings.js';
import { getRibbonCommand, type AnyCommandId } from '../../src/editor/ribbon-commands.js';
import { openCardPreview } from '../../src/editor/card-preview-modal.js';
import { Slice } from 'prosemirror-model';

function openPalette(
  view: EditorView | null = null,
  runCommand: (id: AnyCommandId) => void = () => {},
): void {
  quickCardSearchUI.open({ view, paneEl: null, runCommand, openFilePath: () => {} });
}

function type(q: string): void {
  const input = document.querySelector<HTMLInputElement>('.pmd-qcs-input')!;
  input.value = q;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const emptyText = (): string => document.querySelector('.pmd-qcs-empty')?.textContent ?? '';
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pmd-qcs-row')];

const searchBody = {
  results: [
    { id: 'c1', tag: 'Warming causes extinction', cite: 'Mann 24 (Michael, climatologist)', division: 'hspolicy', year: '24', school: 'Lowell', side: 'N' },
  ],
};
let cardBody: Record<string, unknown>;
const baseCard = {
  id: 'c1',
  tag: 'Warming causes extinction',
  cite: 'Mann 24 (Michael, climatologist)',
  cite_emphasis: [[0, 7]],
  body: ['Warming is an existential threat.'],
  underlines: [[2, 0, 7]],
  highlights: [[2, 0, 7]],
  emphasis: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cardBody = { ...baseCard };
  vi.useFakeTimers();
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/query?')) return new Response(JSON.stringify(searchBody), { status: 200 });
    if (url.includes('/card?')) return new Response(JSON.stringify(cardBody), { status: 200 });
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  settings.set('logosImportCondense', 'none');
  settings.set('logosImportShrink', 'none');
  settings.set('logosImportHighlight', '');
  if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Run the debounce, then let the fetch promise chain resolve. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
}

describe('palette Logos source (g prefix)', () => {
  it('shows a prompt for an empty query and never hits the network', async () => {
    openPalette();
    type('g ');
    await flush();
    expect(emptyText()).toMatch(/Type to search Logos/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debounces: shows "Searching Logos…", sends one request for the final query, then renders rows', async () => {
    openPalette();
    type('g warm');
    type('g warming');
    expect(emptyText()).toBe('Searching Logos…');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('search=warming');
    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0]!.textContent).toContain('LOGOS');
    expect(r[0]!.textContent).toContain('Warming causes extinction');
    expect(r[0]!.textContent).toContain('HS 24 · Lowell · Neg');
    expect(r[0]!.querySelector('.pmd-qcs-row-snippet')?.textContent).toContain('Mann 24');
  });

  it('reports a failed search in the results area', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
    openPalette();
    type('g warming');
    await flush();
    expect(emptyText()).toMatch(/Couldn't reach Logos.*502/);
  });

  it('`l` is no longer a Logos prefix (the old letter read as I or 1)', async () => {
    openPalette();
    type('l warming');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is listed in the no-prefix hint', () => {
    openPalette();
    type('');
    expect(emptyText()).toContain('g Logos');
  });

  it('Enter fetches the full card and inserts it as a card', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView(host, {
      state: EditorState.create({
        doc: schema.nodes['doc']!.create(null, [schema.nodes['paragraph']!.create()]),
        schema,
      }),
    });
    openPalette(view);
    type('g warming');
    await flush();
    document
      .querySelector('.pmd-qcs-input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/card?id=c1');
    expect(showToast).not.toHaveBeenCalled();
    let card: import('prosemirror-model').Node | null = null;
    view.state.doc.descendants((n) => {
      if (!card && n.type.name === 'card') card = n;
      return !card;
    });
    expect(card).not.toBeNull();
    expect(card!.child(0).textContent).toBe('Warming causes extinction');
    expect(card!.textContent).toContain('Warming is an existential threat.');
    view.destroy();
  });

  function mkView(): EditorView {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new EditorView(host, {
      state: EditorState.create({
        doc: schema.nodes['doc']!.create(null, [schema.nodes['paragraph']!.create()]),
        schema,
      }),
    });
  }

  async function insertFirstResult(view: EditorView, runCommand?: (id: AnyCommandId) => void): Promise<void> {
    openPalette(view, runCommand);
    type('g warming');
    await flush();
    document
      .querySelector('.pmd-qcs-input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.advanceTimersByTimeAsync(50);
  }

  function firstCard(view: EditorView): import('prosemirror-model').Node {
    let card: import('prosemirror-model').Node | null = null;
    view.state.doc.descendants((n) => {
      if (!card && n.type.name === 'card') card = n;
      return !card;
    });
    return card!;
  }

  it('uses the Logos highlight color setting, falling back to the default highlight color', async () => {
    settings.set('logosImportHighlight', 'green');
    const view = mkView();
    await insertFirstResult(view);
    const colors = new Set<string>();
    firstCard(view).descendants((n) => {
      for (const m of n.marks) if (m.type.name === 'highlight') colors.add(String(m.attrs['color']));
      return true;
    });
    expect([...colors]).toEqual(['green']);
    view.destroy();
  });

  it('runs the chosen condense then shrink on the inserted card body, then returns the caret below the card', async () => {
    cardBody = { ...baseCard, body: ['First paragraph of evidence.', 'Second paragraph of evidence.'], underlines: [], highlights: [] };
    settings.set('logosImportCondense', 'condenseNoIntegrity');
    settings.set('logosImportShrink', 'shrink');
    const view = mkView();
    const ran: { id: string; selected: string }[] = [];
    await insertFirstResult(view, (id) => {
      const { from, to } = view.state.selection;
      ran.push({ id, selected: view.state.doc.textBetween(from, to, '|') });
      getRibbonCommand(id)(view.state, view.dispatch, view);
    });
    expect(ran.map((r) => r.id)).toEqual(['condenseNoIntegrity', 'shrink']);
    // Condense saw both body paragraphs selected; shrink saw the merged one.
    expect(ran[0]!.selected).toBe('First paragraph of evidence.|Second paragraph of evidence.');
    expect(ran[1]!.selected).toBe('First paragraph of evidence. Second paragraph of evidence.');
    const card = firstCard(view);
    const bodies: string[] = [];
    card.forEach((c) => {
      if (c.type.name === 'card_body') bodies.push(c.textContent);
    });
    expect(bodies).toEqual(['First paragraph of evidence. Second paragraph of evidence.']);
    let shrunk = false;
    card.descendants((n) => {
      if (n.marks.some((m) => m.type.name === 'font_size')) shrunk = true;
      return true;
    });
    expect(shrunk).toBe(true);
    // Caret back in the blank line after the card, nothing selected.
    const { $from, empty } = view.state.selection;
    expect(empty).toBe(true);
    expect($from.parent.type.name).toBe('paragraph');
    expect($from.parent.content.size).toBe(0);
    view.destroy();
  });

  it('runs nothing when both are off', async () => {
    const view = mkView();
    const runCommand = vi.fn();
    await insertFirstResult(view, runCommand);
    expect(runCommand).not.toHaveBeenCalled();
    view.destroy();
  });

  it('right-click previews the full card without inserting it, and keeps the palette open', async () => {
    settings.set('logosImportHighlight', 'cyan');
    const view = mkView();
    openPalette(view);
    type('g warming');
    await flush();
    const row = rows()[0]!;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    await vi.advanceTimersByTimeAsync(50);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/card?id=c1');
    expect(openCardPreview).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(openCardPreview).mock.calls[0]![0];
    expect(opts.title).toBe('Warming causes extinction');
    expect(opts.subtitle).toBe('HS 24 · Lowell · Neg');
    const previewed = Slice.fromJSON(schema, opts.sliceJson as never).content.firstChild!;
    expect(previewed.type.name).toBe('card');
    expect(previewed.textContent).toContain('Warming is an existential threat.');
    let color = '';
    previewed.descendants((n) => {
      for (const m of n.marks) if (m.type.name === 'highlight') color = String(m.attrs['color']);
      return true;
    });
    expect(color).toBe('cyan');
    // Nothing was inserted, and the palette is still up.
    let cards = 0;
    view.state.doc.descendants((n) => {
      if (n.type.name === 'card') cards++;
      return true;
    });
    expect(cards).toBe(0);
    expect(quickCardSearchUI.isOpen()).toBe(true);
    view.destroy();
  });

  it('a click inside an open card preview does not close the palette', async () => {
    openPalette();
    const overlay = document.createElement('div');
    overlay.className = 'pmd-card-preview-overlay';
    const inner = document.createElement('button');
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    inner.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(quickCardSearchUI.isOpen()).toBe(true);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(quickCardSearchUI.isOpen()).toBe(false);
  });
});
