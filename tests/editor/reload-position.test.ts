// @vitest-environment jsdom
/**
 * Reload From Disk keeps your place (reload-position.ts): the caret or
 * selection is mapped across the difference between the old and the reloaded
 * document, so reload does not drop you at the top of the file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  captureReloadPosition,
  mapPosThroughReload,
  restoreReloadPosition,
} from '../../src/editor/reload-position.js';

function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
const docOf = (...cards: PMNode[]): PMNode => schema.nodes['doc']!.createChecked(null, cards);

function mount(doc: PMNode): EditorView {
  return new EditorView(document.body.appendChild(document.createElement('div')), {
    state: EditorState.create({ doc }),
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

/** Doc position of the `n`th character of `text` inside the doc. */
function posOf(doc: PMNode, text: string, n = 0): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text) + n;
  });
  return found;
}

describe('mapPosThroughReload', () => {
  const a = docOf(card('One', 'alpha beta'), card('Two', 'gamma delta'), card('Three', 'epsilon zeta'));

  it('leaves a position alone when the file is the same', () => {
    expect(mapPosThroughReload(a, a, 40)).toBe(40);
  });

  it('keeps a position that is ahead of the change', () => {
    const b = docOf(card('One', 'alpha beta'), card('Two', 'gamma delta'), card('Three', 'CHANGED words here'));
    const pos = posOf(a, 'alpha', 2);
    expect(mapPosThroughReload(a, b, pos)).toBe(pos);
  });

  it('shifts a position that is behind the change by its size', () => {
    const b = docOf(card('One', 'alpha beta PLUS MORE TEXT'), card('Two', 'gamma delta'), card('Three', 'epsilon zeta'));
    const pos = posOf(a, 'epsilon', 3);
    const shifted = mapPosThroughReload(a, b, pos);
    expect(shifted).toBe(posOf(b, 'epsilon', 3));
  });

  it('keeps a position inside a changed card inside that card', () => {
    const b = docOf(card('One', 'alpha beta'), card('Two', 'XXXXXXXXXXXXXXXX'), card('Three', 'epsilon zeta'));
    const mapped = mapPosThroughReload(a, b, posOf(a, 'gamma', 2));
    expect(mapped).toBeGreaterThan(posOf(b, 'XXXX') - 8);
    expect(mapped).toBeLessThan(posOf(b, 'epsilon'));
  });

  it('is not fooled by headings that got new ids on reload', () => {
    // Each card() call mints fresh ids, so `same` and `a` differ only in ids.
    const same = docOf(card('One', 'alpha beta'), card('Two', 'gamma delta'), card('Three', 'epsilon zeta'));
    const pos = posOf(a, 'zeta', 2);
    expect(mapPosThroughReload(a, same, pos)).toBe(pos);
  });

  it('never lands past the end of a shorter document', () => {
    const b = docOf(card('Only', 'short'));
    expect(mapPosThroughReload(a, b, a.content.size - 1)).toBeLessThanOrEqual(b.content.size);
  });
});

describe('restoreReloadPosition', () => {
  it('puts the caret back where it was in a reloaded, unchanged document', () => {
    const doc = docOf(card('One', 'alpha beta'), card('Two', 'gamma delta'), card('Three', 'epsilon zeta'));
    const old = mount(doc);
    const caret = posOf(doc, 'delta', 2);
    old.dispatch(old.state.tr.setSelection(TextSelection.create(doc, caret)));
    const saved = captureReloadPosition(old);
    // The reload builds a brand-new view of an equal document, caret at the start.
    const fresh = mount(docOf(card('One', 'alpha beta'), card('Two', 'gamma delta'), card('Three', 'epsilon zeta')));
    expect(fresh.state.selection.from).not.toBe(caret);
    restoreReloadPosition(fresh, saved);
    expect(fresh.state.selection.from).toBe(caret);
    expect(fresh.state.selection.empty).toBe(true);
  });

  it('keeps the caret on the same words when text before it changed', () => {
    const doc = docOf(card('One', 'alpha beta'), card('Two', 'gamma delta'), card('Three', 'epsilon zeta'));
    const old = mount(doc);
    old.dispatch(old.state.tr.setSelection(TextSelection.create(doc, posOf(doc, 'zeta', 1))));
    const saved = captureReloadPosition(old);
    const reloaded = docOf(card('One', 'alpha beta, and a lot more was written here'), card('Two', 'gamma delta'), card('Three', 'epsilon zeta'));
    const fresh = mount(reloaded);
    restoreReloadPosition(fresh, saved);
    expect(fresh.state.selection.from).toBe(posOf(reloaded, 'zeta', 1));
  });

  it('restores a selection, not just a caret', () => {
    const doc = docOf(card('One', 'alpha beta'), card('Two', 'gamma delta'));
    const old = mount(doc);
    const from = posOf(doc, 'gamma');
    old.dispatch(old.state.tr.setSelection(TextSelection.create(doc, from, from + 5)));
    const saved = captureReloadPosition(old);
    const fresh = mount(docOf(card('One', 'alpha beta'), card('Two', 'gamma delta')));
    restoreReloadPosition(fresh, saved);
    expect([fresh.state.selection.from, fresh.state.selection.to]).toEqual([from, from + 5]);
  });

  it('does not mark the reloaded document as edited', () => {
    const doc = docOf(card('One', 'alpha beta'));
    const old = mount(doc);
    const saved = captureReloadPosition(old);
    const fresh = mount(docOf(card('One', 'alpha beta')));
    const before = fresh.state.doc;
    restoreReloadPosition(fresh, saved);
    expect(fresh.state.doc).toBe(before);
  });
});
