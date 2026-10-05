// @vitest-environment jsdom
/**
 * An absorb-only drag (the nav pane starts one while it is showing search
 * results) may end only on a surface that takes the items itself — the
 * dropzone shelf, the Send pill. In-document slots are skipped while it
 * hovers and refused on release, so the outline cannot be rearranged
 * through a filtered view.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { dragController, type DragSurface } from '../../src/editor/drag-controller.js';

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

const card = (tag: string) =>
  schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text('body')),
  ]);
function makeView(): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, {
    state: EditorState.create({ doc: schema.nodes['doc']!.create(null, [card('One'), card('Two'), card('Three')]) }),
  });
}
const order = (v: EditorView): string[] => {
  const out: string[] = [];
  v.state.doc.forEach((n) => out.push(n.firstChild!.textContent));
  return out;
};

let unregister: Array<() => void> = [];
afterEach(() => {
  dragController.cancel();
  unregister.forEach((u) => u());
  unregister = [];
  document.body.innerHTML = '';
});

function surfaces(view: EditorView, absorbed: string[][]) {
  const slotEl = document.createElement('div');
  const shelfEl = document.createElement('div');
  // An in-document slot (before the first card), nearer the pointer…
  const docSurface: DragSurface = {
    hitTest: (x) => (x < 100 ? { el: slotEl, insertPos: 0, dy: 1, view } : null),
    highlight: () => {},
  };
  // …and a shelf that absorbs, farther away or elsewhere.
  const shelf: DragSurface = {
    hitTest: (x) =>
      x < 100 || x > 500
        ? { el: shelfEl, insertPos: 0, dy: 50, absorb: (items) => void absorbed.push(items.map((i) => i.label)) }
        : null,
    highlight: () => {},
  };
  unregister.push(dragController.registerSurface(docSurface), dragController.registerSurface(shelf));
}
function begin(view: EditorView, absorbOnly: boolean): void {
  const third = view.state.doc.child(2);
  const from = view.state.doc.content.size - third.nodeSize;
  dragController.begin({
    view,
    items: [{ from, to: from + third.nodeSize, id: null, type: 'card', level: 4, label: 'Three' }],
    absorbOnly,
  });
}

describe('absorb-only drags', () => {
  it('an ordinary drag takes the nearer in-document slot and moves the card', () => {
    const view = makeView();
    const absorbed: string[][] = [];
    surfaces(view, absorbed);
    begin(view, false);
    dragController.dispatchHit(50, 50);
    expect(dragController.commit()).toBe(true);
    expect(order(view)).toEqual(['Three', 'One', 'Two']);
    expect(absorbed).toEqual([]);
  });

  it('an absorb-only drag skips the in-document slot for the shelf under the same pointer', async () => {
    const view = makeView();
    const absorbed: string[][] = [];
    surfaces(view, absorbed);
    begin(view, true);
    dragController.dispatchHit(50, 50);
    expect(dragController.commit()).toBe(true);
    await Promise.resolve();
    expect(absorbed).toEqual([['Three']]);
    expect(order(view), 'the document is untouched').toEqual(['One', 'Two', 'Three']);
  });

  it('released where only a document slot exists, it is refused and nothing moves', () => {
    const view = makeView();
    const absorbed: string[][] = [];
    surfaces(view, absorbed);
    begin(view, true);
    dragController.dispatchHit(300, 50); // neither surface
    expect(dragController.commit()).toBe(false);
    // Even a hover target set directly (a surface that ignored the flag).
    begin(view, true);
    dragController.setHoverTarget({ view, insertPos: 0 });
    expect(dragController.commit()).toBe(false);
    expect(order(view)).toEqual(['One', 'Two', 'Three']);
    expect(dragController.isActive()).toBe(false);
  });
});
