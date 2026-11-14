/**
 * Shrink to size (the Card menu's "Shrink to N pt"): merge a card's body
 * paragraphs into one between two warning lines, strip every highlight,
 * underline and emphasis from it, and shrink ALL of its text to the size. The
 * warning lines stay at Normal size.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Command, Transaction } from 'prosemirror-state';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { history, undo } from 'prosemirror-history';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { shrinkToSizeWithWarning } from '../../src/editor/ribbon-commands.js';

const BEFORE = '<<TEXT CONDENSED, NONE OMITTED>>';
const AFTER = '<<PARAGRAPH BREAKS RESUME>>';

const U = () => schema.marks['underline_mark']!.create();
const E = () => schema.marks['emphasis_mark']!.create();
const HL = () => schema.marks['highlight']!.create({ color: 'yellow' });

function tag(text: string) {
  return schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(text));
}
function cite(text: string) {
  return schema.nodes['cite_paragraph']!.create(null, schema.text(text));
}
function body(...runs: [string, Mark[]?][]) {
  return schema.nodes['card_body']!.create(null, runs.map(([t, m]) => schema.text(t, m ?? [])));
}
function card(...children: PMNode[]) {
  return schema.nodes['card']!.createChecked(null, children);
}
function docOf(...children: PMNode[]) {
  return schema.nodes['doc']!.createChecked(null, children);
}

let warnings = { before: BEFORE, after: AFTER };
let pt = 4;
const cmd = (): Command =>
  shrinkToSizeWithWarning(
    () => warnings,
    () => pt,
    () => 11,
    () => 11,
  );

function stateAt(doc: PMNode, inText: string, plugins: any[] = []): EditorState {
  let pos = -1;
  doc.descendants((n, p) => {
    if (pos < 0 && n.isText && n.text!.includes(inText)) pos = p + 1 + n.text!.indexOf(inText);
    return pos < 0;
  });
  if (pos < 0) throw new Error(`"${inText}" not found`);
  const base = EditorState.create({ doc, plugins });
  return base.apply(base.tr.setSelection(TextSelection.create(base.doc, pos)));
}
function run(state: EditorState, c: Command = cmd()): EditorState | null {
  let next: EditorState | null = null;
  const ok = c(state, (tr: Transaction) => {
    next = state.apply(tr);
  });
  return ok ? next : null;
}
/** Each card_body of the first card: its text. */
function bodies(doc: PMNode): string[] {
  const out: string[] = [];
  doc.firstChild!.forEach((c) => {
    if (c.type.name === 'card_body') out.push(c.textContent);
  });
  return out;
}
/** The font size in half-points of each text piece in a paragraph (null = none). */
function sizes(p: PMNode): [string, number | null][] {
  const out: [string, number | null][] = [];
  p.forEach((n) => {
    const m = n.marks.find((x) => x.type.name === 'font_size');
    out.push([n.text!, m ? (m.attrs['halfPoints'] as number) : null]);
  });
  return out;
}
function bodyNode(doc: PMNode, index: number): PMNode {
  const list: PMNode[] = [];
  doc.firstChild!.forEach((c) => {
    if (c.type.name === 'card_body') list.push(c);
  });
  return list[index]!;
}

const twoParas = () =>
  docOf(
    card(
      tag('Tag'),
      cite('Smith 24'),
      body(['filler one '], ['key words', [U()]], [' filler two']),
      body(['second ', []], ['emphasized', [E()]], [' end']),
    ),
  );

describe('Shrink to size', () => {
  it('merges the body into one paragraph between the two warning lines', () => {
    const next = run(stateAt(twoParas(), 'filler one'))!;
    expect(next).not.toBeNull();
    expect(bodies(next.doc)).toEqual([
      BEFORE,
      'filler one key words filler two second emphasized end',
      AFTER,
    ]);
    // tag and cite are untouched
    expect(next.doc.firstChild!.child(0).textContent).toBe('Tag');
    expect(next.doc.firstChild!.child(1).textContent).toBe('Smith 24');
  });

  it('shrinks ALL of the text to the chosen size, underlined and emphasized words too', () => {
    const next = run(stateAt(twoParas(), 'filler one'))!;
    const merged = bodyNode(next.doc, 1);
    // 4 pt = 8 half-points, on every piece of text
    for (const [, size] of sizes(merged)) expect(size).toBe(8);
    expect(merged.textContent).toContain('key words');
  });

  it('removes every highlight, underline and emphasis from the merged text', () => {
    const doc = docOf(
      card(
        tag('Tag'),
        cite('Smith 24'),
        body(['a ', [HL()]], ['b', [U(), HL()]], [' c ', []], ['d', [E()]]),
        body(['e', [U()]], [' f', [HL(), E()]]),
      ),
    );
    const next = run(stateAt(doc, 'a '))!;
    const merged = bodyNode(next.doc, 1);
    const marks = new Set<string>();
    merged.forEach((n) => n.marks.forEach((m) => marks.add(m.type.name)));
    expect([...marks]).toEqual(['font_size']);
    expect(merged.textContent).toBe('a b c d e f');
  });

  it('leaves the tag and cite as they were', () => {
    const doc = docOf(card(tag('Tag'), cite('Smith 24'), body(['x', [U()]]), body(['y'])));
    const next = run(stateAt(doc, 'x'))!;
    expect(sizes(next.doc.firstChild!.child(1))).toEqual([['Smith 24', null]]);
  });

  it('keeps the warning lines at Normal size', () => {
    const next = run(stateAt(twoParas(), 'filler one'))!;
    for (const i of [0, 2]) expect(sizes(bodyNode(next.doc, i))).toEqual([[i === 0 ? BEFORE : AFTER, null]]);
  });

  it('uses the size from the setting', () => {
    pt = 6;
    try {
      const next = run(stateAt(twoParas(), 'filler one'))!;
      expect(sizes(bodyNode(next.doc, 1))[0]![1]).toBe(12);
    } finally {
      pt = 4;
    }
  });

  it('uses the warning text from the settings, and an empty one leaves its line out', () => {
    warnings = { before: '[CONDENSED]', after: '' };
    try {
      const next = run(stateAt(twoParas(), 'filler one'))!;
      expect(bodies(next.doc)).toEqual(['[CONDENSED]', 'filler one key words filler two second emphasized end']);
      expect(sizes(bodyNode(next.doc, 1))[0]![1]).toBe(8);
    } finally {
      warnings = { before: BEFORE, after: AFTER };
    }
    warnings = { before: '', after: '' };
    try {
      const next = run(stateAt(twoParas(), 'filler one'))!;
      expect(bodies(next.doc)).toEqual(['filler one key words filler two second emphasized end']);
    } finally {
      warnings = { before: BEFORE, after: AFTER };
    }
  });

  it('acts on the whole card from a cursor in any of its body paragraphs', () => {
    const next = run(stateAt(twoParas(), 'second'))!;
    expect(bodies(next.doc)).toHaveLength(3);
  });

  it('a selection reaching two cards does each one', () => {
    const doc = docOf(
      card(tag('A'), cite('c'), body(['a1']), body(['a2'])),
      card(tag('B'), cite('c'), body(['b1']), body(['b2'])),
    );
    const base = EditorState.create({ doc });
    const state = base.apply(base.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)));
    const next = run(state)!;
    const texts: string[] = [];
    next.doc.descendants((n) => {
      if (n.type.name === 'card_body') texts.push(n.textContent);
      return true;
    });
    expect(texts).toEqual([BEFORE, 'a1 a2', AFTER, BEFORE, 'b1 b2', AFTER]);
  });

  it('a selection inside one paragraph wraps just that paragraph', () => {
    const doc = twoParas();
    const base = EditorState.create({ doc });
    let from = -1;
    doc.descendants((n, p) => {
      if (from < 0 && n.isText && n.text === 'filler one ') from = p;
      return from < 0;
    });
    const state = base.apply(base.tr.setSelection(TextSelection.create(doc, from, from + 5)));
    const next = run(state)!;
    expect(bodies(next.doc)).toEqual([BEFORE, 'filler one key words filler two', AFTER, 'second emphasized end']);
  });

  it('does nothing when the cursor is not in a card', () => {
    const para = schema.nodes['paragraph']!.create(null, schema.text('loose text'));
    const state = stateAt(docOf(para), 'loose');
    expect(run(state)).toBeNull();
  });

  it('a card already wrapped in the warnings is shrunk again, not wrapped twice', () => {
    const first = run(stateAt(twoParas(), 'filler one'))!;
    pt = 6;
    try {
      const second = run(stateAt(first.doc, 'filler one'))!;
      expect(bodies(second.doc)).toEqual([BEFORE, 'filler one key words filler two second emphasized end', AFTER]);
      expect(sizes(bodyNode(second.doc, 1))[0]![1]).toBe(12);
      expect(sizes(bodyNode(second.doc, 0))).toEqual([[BEFORE, null]]);
    } finally {
      pt = 4;
    }
  });

  it('one Ctrl-Z undoes the whole thing', () => {
    const doc = twoParas();
    const state = stateAt(doc, 'filler one', [history()]);
    const next = run(state)!;
    expect(bodies(next.doc)).toHaveLength(3);
    let undone: EditorState = next;
    undo(next, (tr) => {
      undone = next.apply(tr);
    });
    expect(undone.doc.eq(doc)).toBe(true);
  });
});
