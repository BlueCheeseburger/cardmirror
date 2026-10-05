// @vitest-environment jsdom
/**
 * Two peers on the real Loro binding, wired the way the app wires a view
 * (dispatchTransaction → dragController.mapThrough on every doc change).
 * Peer A drags a card while peer B edits; the remote renders reach A as
 * ordinary transactions. Position mapping alone cannot carry the drag
 * through them: the binding renders a partner's structural edit as one
 * replacement of the whole document, and a deletion's diff boundary sits
 * one position off the node's own — so the controller re-resolves each
 * unit by identity (drag-controller.ts `resolveUnit`). These cases fail
 * on Cora's #90 as merged (false cancel on a partner's insert; a missed
 * cancel plus a garbage drop on a partner's delete).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { createLoroPeers, syncAll, settle, docOf, cardNode, type LoroPeer } from './_loro-helpers.js';
import { dragController } from '../../src/editor/drag-controller.js';
import { NavigationPanel } from '../../src/editor/nav-panel.js';

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));
import { showToast } from '../../src/editor/toast.js';

(document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;

/** The app's dispatch wiring: every doc change carries a drag in flight. */
function wireLikeTheApp(view: EditorView): void {
  view.setProps({
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) dragController.mapThrough(view, tr.mapping);
    },
  });
}
const heads = (d: PMNode): string[] => {
  const out: string[] = [];
  d.forEach((c) => out.push(c.firstChild?.textContent ?? '?'));
  return out;
};
const childStart = (d: PMNode, i: number): number => {
  let pos = 0;
  for (let k = 0; k < i; k++) pos += d.child(k).nodeSize;
  return pos;
};
/** Peer A picks up top-level child `i` (editor-pickup style: no id) and hovers the slot before child `target`. */
function startDrag(view: EditorView, i: number, target: number): void {
  const d = view.state.doc;
  const from = childStart(d, i);
  dragController.begin({
    view,
    items: [{ from, to: from + d.child(i).nodeSize, id: null, type: 'card', level: 4, label: '' }],
  });
  dragController.setHoverTarget({ view, insertPos: childStart(d, target) });
}
/** Nav-pane style pickup: the item carries the card's tag id. */
function startNavDrag(view: EditorView, i: number): void {
  const d = view.state.doc;
  const from = childStart(d, i);
  const id = d.child(i).firstChild?.attrs['id'] as string;
  dragController.begin({
    view,
    items: [{ from, to: from + d.child(i).nodeSize, id, type: 'card', level: 4, label: '' }],
  });
}
const hoverPos = (): number | null =>
  (dragController as unknown as { hoverTarget: { insertPos: number } | null }).hoverTarget?.insertPos ?? null;
async function partner(b: LoroPeer, a: LoroPeer, edit: (v: EditorView) => void): Promise<void> {
  edit(b.view);
  await syncAll([b, a]);
}

let peers: LoroPeer[] = [];
beforeEach(async () => {
  peers = await createLoroPeers(
    docOf(cardNode('One', ['one body']), cardNode('Two', ['two body']), cardNode('Three', ['three body'])),
    2,
  );
  for (const p of peers) wireLikeTheApp(p.view);
});
afterEach(() => {
  dragController.cancel();
  for (const p of peers) p.destroy();
  peers = [];
  document.body.innerHTML = '';
  vi.mocked(showToast).mockClear();
});

describe('a drag in flight during a co-editing session', () => {
  it('survives a partner typing above the dragged card and drops it in the right place', async () => {
    const a = peers[0]!;
    const b = peers[1]!;
    startDrag(a.view, 2, 0); // Three → top
    await partner(b, a, (v) => v.dispatch(v.state.tr.insertText('XXXX', 3)));
    expect(heads(a.doc())).toEqual(['OXXXXne', 'Two', 'Three']);
    expect(dragController.isActive()).toBe(true);
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(heads(a.doc())).toEqual(['Three', 'OXXXXne', 'Two']);
    await syncAll([a, b]);
    expect(heads(b.doc())).toEqual(['Three', 'OXXXXne', 'Two']);
  });

  it("survives a partner inserting a new card next to the dragged one (the binding re-renders the whole doc)", async () => {
    const a = peers[0]!;
    const b = peers[1]!;
    startDrag(a.view, 2, 0); // Three → top
    await partner(b, a, (v) => v.dispatch(v.state.tr.insert(childStart(v.state.doc, 2), cardNode('New', ['new body']))));
    expect(heads(a.doc())).toEqual(['One', 'Two', 'New', 'Three']);
    expect(dragController.isActive()).toBe(true);
    const item = dragController.getSession()!.items[0]!;
    expect(a.doc().nodeAt(item.from)!.firstChild!.textContent).toBe('Three');
    expect(item.to - item.from).toBe(a.doc().nodeAt(item.from)!.nodeSize);
    expect(showToast).not.toHaveBeenCalled();
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(heads(a.doc())).toEqual(['Three', 'One', 'Two', 'New']);
  });

  it('carries a partner edit made INSIDE the dragged card along with it', async () => {
    const a = peers[0]!;
    const b = peers[1]!;
    startDrag(a.view, 2, 0);
    await partner(b, a, (v) => {
      const start = childStart(v.state.doc, 2);
      v.dispatch(v.state.tr.insertText('!', start + 1 + 'Three'.length + 1 + 1)); // into "three body"
    });
    expect(heads(a.doc())).toEqual(['One', 'Two', 'Three']);
    expect(dragController.isActive()).toBe(true);
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(heads(a.doc())).toEqual(['Three', 'One', 'Two']);
    expect(a.doc().child(0).textContent).toContain('!');
  });

  it('cancels with a toast when the partner deletes the dragged card, and moves nothing', async () => {
    const a = peers[0]!;
    const b = peers[1]!;
    startDrag(a.view, 1, 0);
    await partner(b, a, (v) => {
      const s = childStart(v.state.doc, 1);
      v.dispatch(v.state.tr.delete(s, s + v.state.doc.child(1).nodeSize));
    });
    expect(heads(a.doc())).toEqual(['One', 'Three']);
    expect(dragController.isActive()).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('changed by a partner'));
    expect(dragController.commit()).toBe(false);
    expect(heads(a.doc())).toEqual(['One', 'Three']);
  });

  it("the drop slot follows a partner's edit above it", async () => {
    const a = peers[0]!;
    const b = peers[1]!;
    startDrag(a.view, 0, 3); // One → after Three (end)
    await partner(b, a, (v) => v.dispatch(v.state.tr.insertText('YY', childStart(v.state.doc, 1) + 3)));
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(heads(a.doc())).toEqual(['TYYwo', 'Three', 'One']);
  });

  it("the drop slot survives a partner inserting a card elsewhere", async () => {
    // Partner edits render as exact steps (remote-steps.ts): a card inserted
    // before Two no longer reads as "everything from there on was replaced",
    // so the slot between Two and Three is still the slot between them.
    const a = peers[0]!;
    const b = peers[1]!;
    startDrag(a.view, 0, 2); // One → between Two and Three
    await partner(b, a, (v) => v.dispatch(v.state.tr.insert(childStart(v.state.doc, 1), cardNode('New', ['new body']))));
    expect(dragController.isActive()).toBe(true);
    expect(hoverPos()).toBe(childStart(a.doc(), 3));
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(heads(a.doc())).toEqual(['New', 'Two', 'One', 'Three']);
  });

  it("a drop slot inside content the partner deleted is dropped; the next hover lands right", async () => {
    const a = peers[0]!;
    const b = peers[1]!;
    startDrag(a.view, 0, 2); // One → between Two and Three
    await partner(b, a, (v) => {
      // Two and Three go in one delete: the slot between them is gone.
      v.dispatch(v.state.tr.delete(childStart(v.state.doc, 1), v.state.doc.content.size));
      v.dispatch(v.state.tr.insert(v.state.doc.content.size, cardNode('New', ['new body'])));
    });
    expect(heads(a.doc())).toEqual(['One', 'New']);
    expect(dragController.isActive()).toBe(true);
    expect(hoverPos()).toBeNull();
    // The pointer's next move hit-tests a fresh slot; here, the end.
    startDragHoverOnly(a.view, 2);
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(heads(a.doc())).toEqual(['New', 'One']);
  });

  it("the nav pane's drop indicators and dragged-row greying survive a partner's rebuild", async () => {
    const a = peers[0]!;
    const b = peers[1]!;
    const root = document.createElement('div');
    document.body.appendChild(root);
    const nav = new NavigationPanel(root);
    nav.attach(a.view);
    nav.update(a.doc());
    startNavDrag(a.view, 2);
    const before = root.querySelectorAll('.pmd-nav-drop-indicator').length;
    expect(before).toBeGreaterThan(0);
    // (Greying at pickup is the nav's own pointer handler's job; the
    // rebuild path below re-greys by id.)
    await partner(b, a, (v) => v.dispatch(v.state.tr.insertText('Z', 3)));
    nav.update(a.doc()); // the app's debounced rebuild, forced
    expect(root.querySelectorAll('.pmd-nav-drop-indicator').length).toBe(before);
    expect(root.querySelectorAll('.pmd-nav-item-dragging').length).toBe(1);
    nav.destroy();
  });
});

function startDragHoverOnly(view: EditorView, target: number): void {
  dragController.setHoverTarget({ view, insertPos: childStart(view.state.doc, target) });
}
