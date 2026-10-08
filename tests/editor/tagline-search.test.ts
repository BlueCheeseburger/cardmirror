/**
 * Card-tagline search (`f c`): pulling taglines out of a doc, ranking them,
 * collapsing the same card across files, and finding a card again by its
 * ordinal after the file is re-read.
 */
import { describe, it, expect } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import {
  extractTaglines,
  searchTaglines,
  findTaglineEntry,
  type TaglineFile,
} from '../../src/editor/tagline-search.js';

const n = schema.nodes;
function card(id: string, tag: string, cite?: string): PMNode {
  return n['card']!.create(null, [
    n['tag']!.create({ id }, schema.text(tag)),
    n['card_body']!.create(null, [
      ...(cite ? [schema.text(cite, [schema.marks['cite_mark']!.create()])] : []),
      schema.text(' body words'),
    ]),
  ]);
}
const docOf = (...kids: PMNode[]): PMNode => n['doc']!.create(null, kids);

function file(name: string, mtimeMs: number, tags: string[], cites: string[] = []): TaglineFile {
  return {
    path: `/r/${name}.cmir`,
    relPath: `${name}.cmir`,
    name,
    mtimeMs,
    record: { tags, cites: tags.map((_, i) => cites[i] ?? '') },
  };
}

describe('extractTaglines', () => {
  it('lists card tags in order with their cites; skips headings and analytics', () => {
    const doc = docOf(
      n['pocket']!.create({ id: 'P' }, schema.text('1AC')),
      card('a', 'Warming is real', 'Smith 24'),
      n['block']!.create({ id: 'B' }, schema.text('Block')),
      card('b', 'Warming is fast'),
    );
    expect(extractTaglines(doc)).toEqual({
      tags: ['Warming is real', 'Warming is fast'],
      cites: ['Smith 24', ''],
    });
  });
});

describe('searchTaglines', () => {
  const files = [
    file('Old Aff', 1, ['Heg decline causes war', 'Solvency is certain']),
    file('New Neg', 9, ['Heg is resilient', 'Warming causes war']),
  ];

  it('matches every word in any order', () => {
    const r = searchTaglines(files, 'war causes', 10);
    expect(r.rows.map((x) => x.text).sort()).toEqual(['Heg decline causes war', 'Warming causes war']);
    expect(r.total).toBe(2);
  });

  it('returns nothing for an empty query', () => {
    expect(searchTaglines(files, '   ', 10)).toEqual({ rows: [], total: 0 });
  });

  it('ranks a tagline that starts with the query above one that merely contains it', () => {
    const r = searchTaglines(files, 'heg', 10);
    expect(r.rows[0]!.text).toBe('Heg is resilient'); // prefix, and from the newer file
    expect(r.rows[1]!.text).toBe('Heg decline causes war');
  });

  it('finds a card by its cite, below any tagline match', () => {
    const f = [file('A', 1, ['Unrelated tagline', 'Smith is wrong'], ['Smith 24', ''])];
    const r = searchTaglines(f, 'smith', 10);
    expect(r.rows.map((x) => x.text)).toEqual(['Smith is wrong', 'Unrelated tagline']);
  });

  it('shows a card copied across files once, from the newest file, with a count', () => {
    const f = [
      file('Camp 1', 1, ['Heg is resilient']),
      file('Camp 2', 5, ['Heg is resilient']),
      file('Camp 3', 3, ['Heg is resilient']),
    ];
    const r = searchTaglines(f, 'resilient', 10);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'Camp 2', alsoIn: 2, ord: 0 });
  });

  it('reports the ordinal of the hit within its file and honors the limit', () => {
    const r = searchTaglines(files, 'war', 1);
    expect(r.rows).toHaveLength(1);
    expect(r.total).toBe(2);
    const all = searchTaglines(files, 'solvency', 5).rows[0]!;
    expect(all).toMatchObject({ name: 'Old Aff', ord: 1 });
  });
});

describe('findTaglineEntry', () => {
  const doc = docOf(card('a', 'First'), card('b', 'Second'), card('c', 'Third'));

  it('finds the card by ordinal when the text lines up', () => {
    expect(findTaglineEntry(doc, 1, 'Second')?.text).toBe('Second');
  });

  it('falls back to the tagline text when the file changed and the ordinal moved', () => {
    expect(findTaglineEntry(doc, 0, 'Third')?.text).toBe('Third');
  });

  it('is null when the tagline is gone', () => {
    expect(findTaglineEntry(doc, 0, 'Missing')).toBeNull();
  });
});
