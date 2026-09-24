// @vitest-environment jsdom
/**
 * The palette's `l ` (Logos) source: debounced network search with a
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

import { quickCardSearchUI } from '../../src/editor/quick-card-search-ui.js';
import { schema } from '../../src/schema/index.js';
import { showToast } from '../../src/editor/toast.js';

function openPalette(view: EditorView | null = null): void {
  quickCardSearchUI.open({ view, paneEl: null, runCommand: () => {}, openFilePath: () => {} });
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
const cardBody = {
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
  vi.useFakeTimers();
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/query?')) return new Response(JSON.stringify(searchBody), { status: 200 });
    if (url.includes('/card?')) return new Response(JSON.stringify(cardBody), { status: 200 });
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
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

describe('palette Logos source (l prefix)', () => {
  it('shows a prompt for an empty query and never hits the network', async () => {
    openPalette();
    type('l ');
    await flush();
    expect(emptyText()).toMatch(/Type to search Logos/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debounces: shows "Searching Logos…", sends one request for the final query, then renders rows', async () => {
    openPalette();
    type('l warm');
    type('l warming');
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
    type('l warming');
    await flush();
    expect(emptyText()).toMatch(/Couldn't reach Logos.*502/);
  });

  it('is listed in the no-prefix hint', () => {
    openPalette();
    type('');
    expect(emptyText()).toContain('l Logos');
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
    type('l warming');
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
});
