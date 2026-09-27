// @vitest-environment jsdom
/**
 * A drag in flight follows doc changes that land mid-drag (a partner's
 * edits in a shared document): source ranges and the hovered drop slot
 * are remapped, so the drop moves the right card to the right place; a
 * source a partner deleted cancels the drag.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { dragController } from '../../src/editor/drag-controller.js';

function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
function heads(doc: PMNode): string[] {
  const out: string[] = [];
  doc.forEach((c) => out.push(c.firstChild?.textContent ?? '?'));
  return out;
}
function mk(...cards: PMNode[]): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, {
    state: EditorState.create({ doc: schema.nodes['doc']!.create(null, cards) }),
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) dragController.mapThrough(view, tr.mapping);
    },
  });
  return view;
}
/** Begin dragging card `i` and hover the slot before card `target`. */
function startDrag(view: EditorView, i: number, target: number): void {
  const doc = view.state.doc;
  let pos = 0;
  for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
  let at = 0;
  for (let k = 0; k < target; k++) at += doc.child(k).nodeSize;
  const node = doc.child(i);
  dragController.begin({
    view,
    items: [{ from: pos, to: pos + node.nodeSize, id: null, type: 'card', level: 4, label: '' }],
  });
  dragController.setHoverTarget({ view, insertPos: at });
}

afterEach(() => {
  dragController.cancel();
  document.body.innerHTML = '';
});

describe('drag remap', () => {
  it('a partner edit above the dragged card keeps the drop correct', () => {
    const v = mk(card('One', 'one'), card('Two', 'two'), card('Three', 'three'));
    startDrag(v, 2, 0); // Three → top
    // Partner types into card One (shifts every later position).
    v.dispatch(v.state.tr.insertText('xxxxxxxx', 4));
    expect(dragController.commit()).toBe(true);
    expect(heads(v.state.doc)).toEqual(['Three', 'Onxxxxxxxxe', 'Two']);
  });

  it('a partner deleting the dragged card cancels the drag', () => {
    const v = mk(card('One', 'one'), card('Two', 'two'));
    startDrag(v, 1, 0);
    const pos = v.state.doc.child(0).nodeSize;
    v.dispatch(v.state.tr.delete(pos, pos + v.state.doc.child(1).nodeSize));
    expect(dragController.isActive()).toBe(false);
    expect(heads(v.state.doc)).toEqual(['One']);
  });

  it('the drop transaction itself is not remapped', () => {
    const v = mk(card('One', 'one'), card('Two', 'two'));
    startDrag(v, 1, 0);
    expect(dragController.commit()).toBe(true);
    expect(heads(v.state.doc)).toEqual(['Two', 'One']);
    expect(dragController.isActive()).toBe(false);
  });
});
