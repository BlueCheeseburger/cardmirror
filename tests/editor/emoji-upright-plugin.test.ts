// @vitest-environment jsdom
/**
 * Emoji get an upright span (so italic text doesn't skew them). The
 * decorations are maintained incrementally; every edit must leave exactly
 * what a fresh scan of the document would find.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { emojiUprightPlugin, emojiUprightKey } from '../../src/editor/emoji-upright-plugin.js';

const para = (t: string): PMNode => schema.nodes['paragraph']!.create(null, t ? schema.text(t) : undefined);
const docOf = (...c: PMNode[]): PMNode => schema.nodes['doc']!.createChecked(null, c);
const stateOf = (doc: PMNode): EditorState => EditorState.create({ doc, plugins: [emojiUprightPlugin()] });

/** [from, to, text] for every decoration, in order. */
function spans(state: EditorState): Array<[number, number, string]> {
  const set = emojiUprightKey.getState(state)!;
  return set
    .find()
    .map((d) => [d.from, d.to, state.doc.textBetween(d.from, d.to)] as [number, number, string])
    .sort((a, b) => a[0] - b[0]);
}
const fresh = (state: EditorState): Array<[number, number, string]> => spans(stateOf(state.doc));

describe('emoji detection', () => {
  it('finds emoji, ZWJ sequences, skin tones and VS16 pictographs', () => {
    const s = stateOf(docOf(para('hi 😭 there 👨‍👩‍👧 ok 👍🏽 and ❤️ done')));
    expect(spans(s).map((x) => x[2])).toEqual(['😭', '👨‍👩‍👧', '👍🏽', '❤️']);
  });

  it('leaves plain text and text symbols alone', () => {
    const s = stateOf(docOf(para('© ® ™ 1 # * — plain words')));
    expect(spans(s)).toEqual([]);
  });

  it('decorates the right positions across paragraphs', () => {
    const s = stateOf(docOf(para('a😭'), para('😭b')));
    expect(spans(s)).toEqual([
      [2, 4, '😭'],
      [6, 8, '😭'],
    ]);
  });
});

describe('incremental maintenance', () => {
  it('typing an emoji, text before it, and deleting it', () => {
    let s = stateOf(docOf(para('one two'), para('three')));
    s = s.apply(s.tr.insertText('😭', 5));
    expect(spans(s)).toEqual(fresh(s));
    expect(spans(s)).toHaveLength(1);
    s = s.apply(s.tr.insertText('abc ', 2)); // shifts it
    expect(spans(s)).toEqual(fresh(s));
    const [from, to] = [spans(s)[0]![0], spans(s)[0]![1]];
    s = s.apply(s.tr.delete(from, to));
    expect(spans(s)).toEqual([]);
  });

  it('splitting a paragraph through an emoji and joining it back', () => {
    let s = stateOf(docOf(para('ab😭cd')));
    s = s.apply(s.tr.split(3));
    expect(spans(s)).toEqual(fresh(s));
    s = s.apply(s.tr.join(s.doc.child(0).nodeSize));
    expect(spans(s)).toEqual(fresh(s));
  });

  it('an emoji built from two typed halves (a ZWJ sequence) is decorated as one', () => {
    let s = stateOf(docOf(para('x👨')));
    s = s.apply(s.tr.insertText('‍👩', 4));
    expect(spans(s)).toEqual(fresh(s));
    expect(spans(s).map((x) => x[2])).toEqual(['👨‍👩']);
  });

  it('a long random edit sequence never drifts from a fresh scan', () => {
    const bits = ['😭', 'a', ' ', '👍🏽', 'xyz', '❤️', '‍', 'q'];
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    let s = stateOf(docOf(para('start 😭'), para('second'), para('')));
    for (let i = 0; i < 300; i++) {
      const size = s.doc.content.size;
      const pos = Math.max(1, Math.min(size - 1, rnd(size)));
      const r = rnd(10);
      try {
        if (r < 6) s = s.apply(s.tr.insertText(bits[rnd(bits.length)]!, pos));
        else if (r < 9) s = s.apply(s.tr.delete(pos, Math.min(size - 1, pos + 1 + rnd(3))));
        else s = s.apply(s.tr.split(pos));
      } catch {
        /* an edit that doesn't fit the schema — skip it */
      }
      expect(spans(s)).toEqual(fresh(s));
    }
  });
});
