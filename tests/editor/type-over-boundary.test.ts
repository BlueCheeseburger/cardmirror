/**
 * Typing over a Ctrl-Shift-Down-shaped selection (tail at the start of
 * the next textblock) must not eat the block boundary — the worst case
 * was selecting a whole tag that way and typing folding the cite into
 * the tag.
 */

import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { typeOverBoundaryPlugin, crossContainerDeleteSelection } from '../../src/editor/type-over-boundary.js';

function tag(text: string) {
  return schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(text));
}
function citePara(text: string) {
  return schema.nodes['cite_paragraph']!.create(null, schema.text(text));
}
function body(text: string) {
  return schema.nodes['card_body']!.create(null, schema.text(text));
}
function card(...children: PMNode[]) {
  return schema.nodes['card']!.createChecked(null, children);
}
function analytic(text: string) {
  return schema.nodes['analytic']!.create({ id: newHeadingId() }, schema.text(text));
}
function analyticUnit(...children: PMNode[]) {
  return schema.nodes['analytic_unit']!.createChecked(null, children);
}
function para(text: string) {
  return schema.nodes['paragraph']!.create(null, schema.text(text));
}
function makeDoc(...children: PMNode[]) {
  return schema.nodes['doc']!.createChecked(null, children);
}

/** Drive the plugin's handleTextInput with a minimal fake view. */
function typeOver(
  doc: PMNode,
  from: number,
  to: number,
  text: string,
): { handled: boolean; doc: PMNode; state: EditorState } {
  let state = EditorState.create({ doc, plugins: [typeOverBoundaryPlugin] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: import('prosemirror-state').Transaction) {
      state = state.apply(tr);
    },
  } as unknown as EditorView;
  const handler = typeOverBoundaryPlugin.props.handleTextInput!;
  const handled = (handler as (v: EditorView, f: number, t: number, s: string) => boolean)(
    view,
    from,
    to,
    text,
  );
  return { handled, doc: state.doc, state };
}

/** Block-type/text pairs for the whole doc. */
function blocks(doc: PMNode): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  doc.descendants((n) => {
    if (n.isTextblock) out.push([n.type.name, n.textContent]);
    return true;
  });
  return out;
}

describe('typeOverBoundaryPlugin', () => {
  it('tag selected to the start of the cite: typing keeps the cite', () => {
    const doc = makeDoc(card(tag('Old tag text'), citePara('Author 24'), body('warrant')));
    // tag content: positions 2..14; cite content starts at 16.
    let tagStart = -1;
    let citeStart = -1;
    doc.descendants((n, pos) => {
      if (n.type.name === 'tag') tagStart = pos + 1;
      if (n.type.name === 'cite_paragraph') citeStart = pos + 1;
      return true;
    });
    const { handled, doc: next } = typeOver(doc, tagStart, citeStart, 'N');
    expect(handled).toBe(true);
    expect(blocks(next)).toEqual([
      ['tag', 'N'],
      ['cite_paragraph', 'Author 24'],
      ['card_body', 'warrant'],
    ]);
  });

  it('paragraph selected to the start of the next: typing keeps the break', () => {
    const doc = makeDoc(para('first paragraph'), para('second paragraph'));
    const p2Start = doc.firstChild!.nodeSize + 1;
    const { handled, doc: next } = typeOver(doc, 1, p2Start, 'X');
    expect(handled).toBe(true);
    expect(blocks(next)).toEqual([
      ['paragraph', 'X'],
      ['paragraph', 'second paragraph'],
    ]);
  });

  it('does not interfere when the selection reaches INTO the next block', () => {
    const doc = makeDoc(para('first paragraph'), para('second paragraph'));
    const p2Start = doc.firstChild!.nodeSize + 1;
    // One character of the second paragraph is genuinely selected —
    // the user crossed the boundary on purpose; standard merge applies.
    const { handled } = typeOver(doc, 1, p2Start + 1, 'X');
    expect(handled).toBe(false);
  });

  it('does not interfere with a within-block selection', () => {
    const doc = makeDoc(para('first paragraph'));
    const { handled } = typeOver(doc, 1, 6, 'X');
    expect(handled).toBe(false);
  });

  it('does not interfere with a collapsed cursor at block start', () => {
    const doc = makeDoc(para('first'), para('second'));
    const p2Start = doc.firstChild!.nodeSize + 1;
    const { handled } = typeOver(doc, p2Start, p2Start, 'X');
    expect(handled).toBe(false);
  });

  it('collapses to a cursor after the typed text — continued typing appends', () => {
    // Live regression: without the explicit collapse, the mapped
    // selection stayed a range tail-at-block-start, so every following
    // keystroke re-entered the handler and overwrote in place.
    const doc = makeDoc(para('first paragraph'), para('second paragraph'));
    const p2Start = doc.firstChild!.nodeSize + 1;
    const first = typeOver(doc, 1, p2Start, 'X');
    expect(first.handled).toBe(true);
    const sel = first.state.selection;
    expect(sel.empty).toBe(true);
    expect(sel.from).toBe(2); // right after the typed 'X'
    // Second keystroke at the collapsed cursor: the plugin stands
    // aside and normal insertion appends.
    const second = typeOver(first.doc, sel.from, sel.to, 'Y');
    expect(second.handled).toBe(false);
  });
});

describe('editing over a head-tail cross-container selection (field crash 2026-08-29)', () => {
  // A mouse drag ending INSIDE a container's required head block (a
  // card's tag, an analytic unit's head) is the one selection shape
  // ProseMirror's replace cannot fit — it threw "Cannot join card
  // onto analytic_unit" UNCAUGHT and the edit did nothing. The fixed
  // semantics: exactly as if the boundary had been deleted first —
  // the head's remaining text flows up inline, and the tail
  // container's remaining body blocks follow it into the from-side
  // container.
  function crossDoc() {
    const doc = makeDoc(
      card(tag('Tag'), body('1xx')),
      analyticUnit(analytic('Analytic'), body('xx3')),
    );
    let cardBodyStart = -1;
    let analyticStart = -1;
    let unitBodyStart = -1;
    doc.descendants((n, pos) => {
      if (n.type.name === 'card_body') {
        if (cardBodyStart === -1) cardBodyStart = pos + 1;
        else if (unitBodyStart === -1) unitBodyStart = pos + 1;
      }
      if (n.type.name === 'analytic' && analyticStart === -1) analyticStart = pos + 1;
      return true;
    });
    return { doc, cardBodyStart, analyticStart, unitBodyStart };
  }

  it('sanity: the body-tail shape already merges correctly via the default path', () => {
    const { doc, cardBodyStart, unitBodyStart } = crossDoc();
    let state = EditorState.create({ doc });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, cardBodyStart + 2, unitBodyStart + 2)),
    );
    // The command must DEFER here — PM's own delete is legal and right.
    expect(crossContainerDeleteSelection(state, undefined)).toBe(false);
    const next = state.apply(state.tr.deleteSelection()).doc;
    expect(blocks(next)).toEqual([
      ['tag', 'Tag'],
      ['card_body', '1x3'],
    ]);
  });

  it('Backspace over a head-tail selection merges the tail container up', () => {
    const { doc, cardBodyStart, analyticStart } = crossDoc();
    let state = EditorState.create({ doc });
    const from = cardBodyStart + 2; // after "1x"
    const to = analyticStart + 3; // "Ana|lytic"
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    // This is exactly the shape whose direct delete throws.
    expect(() => state.tr.deleteSelection()).toThrow(/Cannot join/);
    let dispatched = false;
    const handled = crossContainerDeleteSelection(state, (tr) => {
      dispatched = true;
      state = state.apply(tr);
    });
    expect(handled).toBe(true);
    expect(dispatched).toBe(true);
    expect(() => state.doc.check()).not.toThrow();
    expect(blocks(state.doc)).toEqual([
      ['tag', 'Tag'],
      ['card_body', '1xlytic'],
      ['card_body', 'xx3'],
    ]);
    expect(state.selection.empty).toBe(true);
    expect(state.selection.from).toBe(from);
  });

  it('typing over a head-tail selection merges up and lands the typed text at the cut', () => {
    const { doc, cardBodyStart, analyticStart } = crossDoc();
    const from = cardBodyStart + 2;
    const to = analyticStart + 3;
    const { handled, doc: next, state } = typeOver(doc, from, to, 'Z');
    expect(handled).toBe(true);
    expect(() => next.check()).not.toThrow();
    expect(blocks(next)).toEqual([
      ['tag', 'Tag'],
      ['card_body', '1xZlytic'],
      ['card_body', 'xx3'],
    ]);
    // Caret collapsed after the typed character — the next keystroke
    // types, not re-replaces.
    expect(state.selection.empty).toBe(true);
    expect(state.selection.from).toBe(from + 1);
  });

  it('an ordinary within-block replacement still defers to the default path', () => {
    const doc = makeDoc(para('hello world'));
    const { handled } = typeOver(doc, 1, 6, 'X');
    expect(handled).toBe(false);
  });
});

describe('head-FULLY-covered selections merge via the default path (all pairings)', () => {
  // The user-facing rule: a selection that flows past an entire tag /
  // analytic heading and into the text below deletes the heading and
  // merges the lower container into the higher one. ProseMirror's own
  // replace already does this correctly in every pairing — these pins
  // exist so a prosemirror upgrade can't silently change that, and so
  // the throwing shape stays exactly "tail INSIDE a head block".
  const unit = (t: string, b: string) =>
    analyticUnit(analytic(t), body(b));
  const flatBlock = (t: string) =>
    schema.nodes['block']!.create({ id: newHeadingId() }, schema.text(t));

  function deleteAcross(docNode: PMNode): Array<[string, string]> {
    const blocksIn: Array<{ pos: number; node: PMNode }> = [];
    docNode.descendants((x, p) => {
      if (x.isTextblock) blocksIn.push({ pos: p, node: x });
      return true;
    });
    const first = blocksIn.find((b) => b.node.textContent.startsWith('1'))!;
    const last = blocksIn[blocksIn.length - 1]!;
    const from = first.pos + 3; // after "1x"
    const to = last.pos + 3; // after "xx"
    let state = EditorState.create({ doc: docNode });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    // The merge-up command must DEFER — the default delete is legal here.
    expect(crossContainerDeleteSelection(state, undefined)).toBe(false);
    const next = state.apply(state.tr.deleteSelection()).doc;
    expect(() => next.check()).not.toThrow();
    return blocks(next);
  }

  it('card → analytic unit', () => {
    expect(deleteAcross(makeDoc(card(tag('Tag'), body('1xx')), unit('Analytic', 'xx3')))).toEqual([
      ['tag', 'Tag'],
      ['card_body', '1x3'],
    ]);
  });

  it('analytic unit → card', () => {
    expect(deleteAcross(makeDoc(unit('Analytic', '1xx'), card(tag('Tag'), body('xx3'))))).toEqual([
      ['analytic', 'Analytic'],
      ['card_body', '1x3'],
    ]);
  });

  it('card → card', () => {
    expect(deleteAcross(makeDoc(card(tag('TagA'), body('1xx')), card(tag('TagB'), body('xx3'))))).toEqual([
      ['tag', 'TagA'],
      ['card_body', '1x3'],
    ]);
  });

  it('analytic unit → analytic unit', () => {
    expect(deleteAcross(makeDoc(unit('HeadA', '1xx'), unit('HeadB', 'xx3')))).toEqual([
      ['analytic', 'HeadA'],
      ['card_body', '1x3'],
    ]);
  });

  it('card → flat heading → paragraph (heading fully covered)', () => {
    expect(
      deleteAcross(makeDoc(card(tag('Tag'), body('1xx')), flatBlock('Block Heading'), para('xx3'))),
    ).toEqual([
      ['tag', 'Tag'],
      ['card_body', '1x3'],
    ]);
  });

  it('paragraph → card (tag fully covered)', () => {
    expect(deleteAcross(makeDoc(para('1xx'), card(tag('Tag'), body('xx3'))))).toEqual([
      ['paragraph', '1x3'],
    ]);
  });
});
