// @vitest-environment jsdom
/**
 * The palette's `e ` (evidence) prefix: one prefix for all the cards. Typed
 * alone it says it searches all evidence and lists the letters that narrow it
 * (`q` my cards, `g` Logos, `a` authors); with words it shows my cards first
 * and the Logos cards after them; a letter then a space narrows it to one
 * source.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/editor/host/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/host/index.js')>();
  return { ...mod, getElectronHost: () => null };
});
vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

import { quickCardSearchUI } from '../../src/editor/quick-card-search-ui.js';
import { quickCardsStore, type QuickCard } from '../../src/editor/quick-cards-store.js';
import type { EditorView } from 'prosemirror-view';

const fakeView = { editable: true, focus: () => {}, hasFocus: () => false } as unknown as EditorView;
const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.pmd-qcs-input')!;
function type(q: string): void {
  input().value = q;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}
const emptyEl = (): HTMLElement | null => document.querySelector('.pmd-qcs-empty');
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pmd-qcs-row')];
const badges = (): string[] => rows().map((r) => r.querySelector('.pmd-qcs-row-badge')?.textContent ?? '');

const quickCard = (name: string): QuickCard =>
  ({
    id: `qc-${name}`,
    name,
    tags: ['neg'],
    contentJson: { content: [], openStart: 0, openEnd: 0 },
    nameLower: name.toLowerCase(),
    tagsLower: ['neg'],
    textLower: name.toLowerCase(),
    sourceName: 'Somewhere',
    createdAt: 1,
    updatedAt: 1,
  }) as QuickCard;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async (url: string) =>
    url.includes('/query?')
      ? new Response(
          JSON.stringify({
            results: [
              { id: 'c1', tag: 'Warming causes extinction', cite: 'Mann 24', division: 'hspolicy', year: '24', school: 'Lowell', side: 'N' },
            ],
          }),
          { status: 200 },
        )
      : new Response('', { status: 404 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(quickCardsStore, 'list').mockReturnValue([quickCard('Warming quick card')]);
  quickCardSearchUI.open({ view: fakeView, runCommand: () => {}, openFilePath: () => {} });
});
afterEach(() => {
  if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const flush = (): Promise<void> => vi.advanceTimersByTimeAsync(600);

describe('the top-level legend', () => {
  it('lists e evidence, and no longer lists q or g separately', () => {
    type('');
    const text = emptyEl()!.textContent!;
    expect(text).toContain('e evidence');
    expect(text).not.toContain('q my cards');
    expect(text).not.toContain('g Logos');
  });
});

describe('after e ', () => {
  it('says it searches all evidence and lists only the letters that can follow', () => {
    type('e ');
    expect(emptyEl()!.querySelector('.pmd-qcs-empty-headline')?.textContent).toBe('Searching all evidence');
    const legend = emptyEl()!.querySelector('.pmd-qcs-empty-legend')!.textContent!;
    expect(legend).toContain('Add a letter to narrow your search');
    expect(legend).toContain('q my cards');
    expect(legend).toContain('g Logos');
    expect(legend).toContain('a authors');
    expect(legend).not.toContain('f files');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a lone letter (no space yet) as still being typed, not as a search', async () => {
    type('e q');
    await flush();
    expect(emptyEl()!.querySelector('.pmd-qcs-empty-headline')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('e <words>: all evidence', () => {
  it('shows my cards first, then the Logos cards when they arrive', async () => {
    type('e warming');
    // My cards at once; Logos still on its way.
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain('Warming quick card');
    expect(fetchMock).not.toHaveBeenCalled();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.textContent).toContain('Warming quick card');
    expect(rows()[1]!.textContent).toContain('Warming causes extinction');
    expect(badges()[1]).toBe('NEG');
  });

  it('says it is searching both while nothing has matched yet', () => {
    vi.spyOn(quickCardsStore, 'list').mockReturnValue([]);
    type('e nothing');
    expect(emptyEl()!.textContent).toBe('Searching your cards and Logos…');
  });

  it('reports a Logos failure beside the no-match text', async () => {
    vi.spyOn(quickCardsStore, 'list').mockReturnValue([]);
    fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
    type('e nothing');
    await flush();
    expect(emptyEl()!.textContent).toMatch(/No quick cards yet.*Couldn’t reach Logos.*502/);
  });
});

describe('e q / e g', () => {
  it('e q searches my cards only and never asks Logos', async () => {
    type('e q warming');
    await flush();
    expect(rows()).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('e g searches Logos only', async () => {
    type('e g warming');
    expect(emptyEl()!.textContent).toBe('Searching Logos…');
    await flush();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain('Warming causes extinction');
  });

  it('narrowing away from Logos cancels the pending Logos query', async () => {
    type('e warming');
    type('e q warming');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the old q and g prefixes', () => {
  it('still work on their own', async () => {
    type('q warming');
    expect(rows()).toHaveLength(1);
    type('g warming');
    await flush();
    expect(rows()[0]!.textContent).toContain('Warming causes extinction');
  });
});
