/**
 * Logos source: card building (formatting ranges → marks), row labels,
 * and the two fetch helpers against a mocked fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import {
  buildLogosCardSlice,
  fetchLogosCard,
  logosResultMeta,
  searchLogos,
  type LogosCard,
} from '../../src/editor/logos-search.js';

/** [text, sorted mark names (highlight as `highlight:<color>`)] per run. */
function runs(para: PMNode): [string, string[]][] {
  const out: [string, string[]][] = [];
  para.forEach((t) => {
    out.push([
      t.text ?? '',
      t.marks
        .map((m) => (m.type.name === 'highlight' ? `highlight:${m.attrs['color']}` : m.type.name))
        .sort(),
    ]);
  });
  return out;
}

const card: LogosCard = {
  id: 'abc',
  tag: '  Nuclear war causes extinction  ',
  cite: 'Starr 15 (Steven, expert)',
  cite_emphasis: [[0, 8], [8, 8]],
  // body[0] is paragraph index 2.
  body: ['a nuclear war is not survivable at all', ''],
  underlines: [[2, 0, 20]],
  emphasis: [[2, 2, 9]],
  highlights: [[2, 2, 13], [0, 0, 5], [2, 31, 99]],
};

describe('buildLogosCardSlice', () => {
  it('builds a card: tag, cite with its cite span, one body paragraph per non-empty body entry', () => {
    const slice = buildLogosCardSlice(card, 'cyan');
    expect(slice.openStart).toBe(0);
    const node = slice.content.firstChild!;
    expect(node.type.name).toBe('card');
    expect(node.childCount).toBe(3); // tag, cite, 1 body (empty body entry dropped)
    const [tag, cite, body] = [node.child(0), node.child(1), node.child(2)];
    expect(tag.type.name).toBe('tag');
    expect(tag.textContent).toBe('Nuclear war causes extinction');
    expect(typeof tag.attrs['id']).toBe('string');
    expect(cite.type.name).toBe('cite_paragraph');
    expect(runs(cite)).toEqual([
      ['Starr 15', ['cite_mark']],
      [' (Steven, expert)', []],
    ]);
    expect(body.type.name).toBe('card_body');
  });

  it('maps underline / emphasis / highlight ranges, emphasis replacing underline where they overlap', () => {
    const body = buildLogosCardSlice(card, 'cyan').content.firstChild!.child(2);
    expect(runs(body)).toEqual([
      ['a ', ['underline_mark']],
      ['nuclear', ['emphasis_mark', 'highlight:cyan']],
      [' war', ['highlight:cyan', 'underline_mark']],
      [' is not', ['underline_mark']],
      [' survivable', []],
      [' at all', ['highlight:cyan']], // [31, 99] clamped to the text's end
    ]);
  });

  it('ignores ranges on the tag/cite paragraph indices (0 and 1) in the body', () => {
    const body = buildLogosCardSlice(card, 'yellow').content.firstChild!.child(2);
    expect(body.textContent).toBe('a nuclear war is not survivable at all');
  });

  it('handles a card with no body and no formatting', () => {
    const node = buildLogosCardSlice({ id: 'x', tag: 'T', cite: '', body: [] }, 'yellow').content
      .firstChild!;
    expect(node.childCount).toBe(2);
    expect(node.child(1).childCount).toBe(0);
  });
});

describe('logosResultMeta', () => {
  it('labels division, year, school and side', () => {
    expect(logosResultMeta({ id: '1', tag: 't', cite: 'c', division: 'hspolicy', year: '24', school: 'Lowell', side: 'N' }))
      .toBe('HS 24 · Lowell · Neg');
    expect(logosResultMeta({ id: '1', tag: 't', cite: 'c', division: 'ndtceda', year: '23', side: 'A' }))
      .toBe('College 23 · Aff');
    expect(logosResultMeta({ id: '1', tag: 't', cite: 'c' })).toBe('');
  });
});

describe('fetch helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('searchLogos encodes the query and drops malformed rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { id: 'a', tag: 'Tag A', cite: 'Cite A' },
            { id: 'b', tag: 7, cite: 'bad' },
            null,
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const rows = await searchLogos('nuclear war & peace');
    expect(rows.map((r) => r.id)).toEqual(['a']);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://logos-debate.duckdns.org/query?search=nuclear%20war%20%26%20peace&cursor=0',
    );
  });

  it('searchLogos throws on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })));
    await expect(searchLogos('x')).rejects.toThrow(/HTTP 502/);
  });

  it('fetchLogosCard rejects an off-shape card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ tag: 'x' }), { status: 200 })));
    await expect(fetchLogosCard('id')).rejects.toThrow(/unexpected shape/);
  });
});
