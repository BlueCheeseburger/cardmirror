// @vitest-environment jsdom
/**
 * doc-diff.ts — the pure extract/diff/pair core behind "Compare
 * documents" (home screen). No DOM, no file picker; just docs in,
 * diff structures out.
 */

import { describe, it, expect } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { extractDiffLines, diffLines, toDiffRows, summarize, diffDocs, DiffTooLargeError } from '../../src/editor/doc-diff.js';
import type { Node as PMNode } from 'prosemirror-model';

function card(tagText: string, bodyText: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tagText)),
    schema.nodes['card_body']!.create(null, schema.text(bodyText)),
  ]);
}

function docOf(...cards: PMNode[]): PMNode {
  return schema.nodes['doc']!.createChecked(null, cards);
}

describe('extractDiffLines', () => {
  it('flattens each textblock to one line, in document order', () => {
    const doc = docOf(card('Tag one', 'Body one'));
    expect(extractDiffLines(doc)).toEqual(['Tag one', 'Body one']);
  });

  it('separates cards with a blank line, but not before the first', () => {
    const doc = docOf(card('Tag A', 'Body A'), card('Tag B', 'Body B'));
    expect(extractDiffLines(doc)).toEqual(['Tag A', 'Body A', '', 'Tag B', 'Body B']);
  });

  it('drops empty textblocks without a stray blank line', () => {
    const empty = schema.nodes['card_body']!.create(null);
    const doc = docOf(
      schema.nodes['card']!.createChecked(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
        empty,
        schema.nodes['card_body']!.create(null, schema.text('Real body')),
      ]),
    );
    expect(extractDiffLines(doc)).toEqual(['Tag', 'Real body']);
  });

  it('joins marked runs within one textblock into plain text', () => {
    const body = schema.nodes['card_body']!.create(null, [
      schema.text('kept ', [schema.marks['highlight']!.create({ color: 'yellow' })]),
      schema.text('and plain'),
    ]);
    const doc = docOf(schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('T')),
      body,
    ]));
    expect(extractDiffLines(doc)).toEqual(['T', 'kept and plain']);
  });
});

describe('diffLines', () => {
  it('an identical pair is all equal', () => {
    const lines = ['a', 'b', 'c'];
    expect(diffLines(lines, lines)).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'equal', text: 'b' },
      { type: 'equal', text: 'c' },
    ]);
  });

  it('a pure insertion in the middle', () => {
    expect(diffLines(['a', 'c'], ['a', 'b', 'c'])).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'equal', text: 'c' },
    ]);
  });

  it('a pure deletion in the middle', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'remove', text: 'b' },
      { type: 'equal', text: 'c' },
    ]);
  });

  it('a changed line shows as a remove immediately followed by an add', () => {
    expect(diffLines(['same', 'old line'], ['same', 'new line'])).toEqual([
      { type: 'equal', text: 'same' },
      { type: 'remove', text: 'old line' },
      { type: 'add', text: 'new line' },
    ]);
  });

  it('totally disjoint inputs: everything removed then everything added', () => {
    const result = diffLines(['x', 'y'], ['p', 'q']);
    expect(result.filter((l) => l.type === 'remove').map((l) => l.text)).toEqual(['x', 'y']);
    expect(result.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['p', 'q']);
    expect(result.some((l) => l.type === 'equal')).toBe(false);
  });

  it('empty vs. non-empty is all adds (or all removes)', () => {
    expect(diffLines([], ['a', 'b'])).toEqual([
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' },
    ]);
    expect(diffLines(['a', 'b'], [])).toEqual([
      { type: 'remove', text: 'a' },
      { type: 'remove', text: 'b' },
    ]);
  });

  it('both empty is an empty diff', () => {
    expect(diffLines([], [])).toEqual([]);
  });

  it('repeated identical lines only match one-for-one, not many-for-one', () => {
    const result = diffLines(['x', 'x', 'x'], ['x', 'x']);
    expect(summarize(result)).toEqual({ added: 0, removed: 1, unchanged: 2 });
  });

  it('a large shared prefix and suffix around a small changed middle still diffs correctly', () => {
    // Regression guard for the prefix/suffix trim: the whole point is to
    // shrink the DP table for exactly this shape (two mostly-identical
    // documents), so this locks in that the trim boundaries themselves
    // are correct, not just that they're fast.
    const shared = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const prefix = shared.slice(0, 300);
    const suffix = shared.slice(300);
    const a = [...prefix, 'old middle', ...suffix];
    const b = [...prefix, 'new middle', ...suffix];
    const result = diffLines(a, b);
    expect(summarize(result)).toEqual({ added: 1, removed: 1, unchanged: 500 });
    // The changed region lands exactly between the shared prefix and suffix.
    const change = result.filter((l) => l.type !== 'equal');
    expect(change).toEqual([
      { type: 'remove', text: 'old middle' },
      { type: 'add', text: 'new middle' },
    ]);
  });

  it('throws DiffTooLargeError instead of allocating a huge table for two wildly different large inputs', () => {
    // No shared prefix/suffix at all, so trimming can't help — this is
    // the pathological case the cap exists for. Cheap to construct: the
    // guard fires before any O(n·m) work happens.
    const a = Array.from({ length: 6001 }, (_, i) => `a-${i}`);
    const b = Array.from({ length: 6001 }, (_, i) => `b-${i}`);
    expect(() => diffLines(a, b)).toThrow(DiffTooLargeError);
  });

  it('stays comfortably under the cap for a document-sized diff (a few thousand differing lines)', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a-${i}`);
    const b = Array.from({ length: 3000 }, (_, i) => `b-${i}`);
    expect(() => diffLines(a, b)).not.toThrow();
  });
});

describe('toDiffRows', () => {
  it('an equal line occupies both columns on one row', () => {
    expect(toDiffRows([{ type: 'equal', text: 'same' }])).toEqual([
      { left: { type: 'equal', text: 'same' }, right: { type: 'equal', text: 'same' } },
    ]);
  });

  it('zips a same-length changed region position-for-position', () => {
    const lines = diffLines(['old A', 'old B'], ['new A', 'new B']);
    expect(toDiffRows(lines)).toEqual([
      { left: { type: 'remove', text: 'old A' }, right: { type: 'add', text: 'new A' } },
      { left: { type: 'remove', text: 'old B' }, right: { type: 'add', text: 'new B' } },
    ]);
  });

  it('pads the shorter side of an uneven changed region with blank cells', () => {
    const lines = diffLines(['old A', 'old B', 'old C'], ['new A']);
    expect(toDiffRows(lines)).toEqual([
      { left: { type: 'remove', text: 'old A' }, right: { type: 'add', text: 'new A' } },
      { left: { type: 'remove', text: 'old B' }, right: { type: 'blank', text: '' } },
      { left: { type: 'remove', text: 'old C' }, right: { type: 'blank', text: '' } },
    ]);
  });

  it('a pure addition pads the left side blank', () => {
    const lines = diffLines(['a'], ['a', 'new']);
    expect(toDiffRows(lines)).toEqual([
      { left: { type: 'equal', text: 'a' }, right: { type: 'equal', text: 'a' } },
      { left: { type: 'blank', text: '' }, right: { type: 'add', text: 'new' } },
    ]);
  });
});

describe('summarize', () => {
  it('counts each line type', () => {
    const lines = diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
    expect(summarize(lines)).toEqual({ added: 1, removed: 1, unchanged: 2 });
  });
});

describe('diffDocs', () => {
  it('extracts both docs and diffs them in one call', () => {
    const a = docOf(card('Tag', 'Old body'));
    const b = docOf(card('Tag', 'New body'));
    expect(diffDocs(a, b)).toEqual([
      { type: 'equal', text: 'Tag' },
      { type: 'remove', text: 'Old body' },
      { type: 'add', text: 'New body' },
    ]);
  });
});
