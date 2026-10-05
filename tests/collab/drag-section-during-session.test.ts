// @vitest-environment jsdom
/**
 * Dragging a HEADER (a block with the cards under it) while a partner
 * edits. A header's drag unit is a section: many nodes, and a span whose
 * size changes when a partner types inside it. The identity re-resolution
 * added for single cards compared the mapped span with ONE node's size, so
 * for a section it always failed and fell back to "find the node with this
 * heading id" — the heading alone. After any edit landing mid-drag, the
 * drop moved the header and left its cards behind (found by hand,
 * 2026-10-03). The unit's extent is now recomputed from the document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { createLoroPeers, syncAll, settle, docOf, cardNode, findText, type LoroPeer } from './_loro-helpers.js';
import { dragController } from '../../src/editor/drag-controller.js';
import { collectHeadings, computeHeadingRange } from '../../src/editor/headings.js';
import { showToast } from '../../src/editor/toast.js';

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

function wireLikeTheApp(view: EditorView): void {
  view.setProps({
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) dragController.mapThrough(view, tr.mapping);
    },
  });
}
const block = (text: string): PMNode => schema.nodes['block']!.create({ id: newHeadingId() }, schema.text(text));
/** Top-level outline: block titles and card tags, in order. */
const outline = (d: PMNode): string[] => {
  const out: string[] = [];
  d.forEach((n) => out.push(n.type.name === 'block' ? `# ${n.textContent}` : n.firstChild!.textContent));
  return out;
};
const bodies = (d: PMNode): string[] => {
  const out: string[] = [];
  d.forEach((n) => {
    if (n.type.name === 'card') out.push(n.child(1).textContent);
  });
  return out;
};
/** Nav-pane pickup of the block titled `title` (heading + its section),
 *  hovering the slot before the block titled `before` (or the end). */
function dragBlock(view: EditorView, title: string, before: string | null): void {
  const d = view.state.doc;
  const entries = collectHeadings(d);
  const entry = entries.find((e) => e.type === 'block' && e.text === title)!;
  const range = computeHeadingRange(d, entry)!;
  dragController.begin({
    view,
    items: [{ from: range.from, to: range.to, id: entry.id, type: 'block', level: 3, label: title }],
  });
  const target = before === null ? d.content.size : entries.find((e) => e.type === 'block' && e.text === before)!.pos;
  dragController.setHoverTarget({ view, insertPos: target });
}
async function partner(b: LoroPeer, a: LoroPeer, edit: (v: EditorView) => void): Promise<void> {
  edit(b.view);
  await syncAll([b, a]);
}

let peers: LoroPeer[] = [];
beforeEach(async () => {
  (globalThis as { __CM_MOVABLE_LIST__?: boolean }).__CM_MOVABLE_LIST__ = true;
  document.elementFromPoint = () => null;
  peers = await createLoroPeers(
    docOf(
      block('Alpha'),
      cardNode('a1', ['a1 body']),
      cardNode('a2', ['a2 body']),
      block('Bravo'),
      cardNode('b1', ['b1 body']),
      block('Charlie'),
      cardNode('c1', ['c1 body']),
    ),
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

describe('dragging a header (a whole section) during a co-editing session', () => {
  it('a partner typing in a card under the dragged header: the cards travel with it', async () => {
    const [a, b] = peers as [LoroPeer, LoroPeer];
    dragBlock(a.view, 'Alpha', null); // Alpha's section → end
    await partner(b, a, (v) => v.dispatch(v.state.tr.insertText(' EDIT', findText(v.state.doc, 'a2 body').to)));
    expect(dragController.isActive()).toBe(true);
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(outline(a.doc())).toEqual(['# Bravo', 'b1', '# Charlie', 'c1', '# Alpha', 'a1', 'a2']);
    expect(bodies(a.doc())).toContain('a2 body EDIT');
    await syncAll([a, b]);
    expect(a.doc().eq(b.doc())).toBe(true);
  });

  it('a partner typing ABOVE the dragged header: the whole section still moves', async () => {
    const [a, b] = peers as [LoroPeer, LoroPeer];
    dragBlock(a.view, 'Bravo', 'Alpha'); // Bravo's section → top
    await partner(b, a, (v) => v.dispatch(v.state.tr.insertText('!!', findText(v.state.doc, 'a1 body').to)));
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(outline(a.doc())).toEqual(['# Bravo', 'b1', '# Alpha', 'a1', 'a2', '# Charlie', 'c1']);
  });

  it('a partner adding a card to the dragged section: the new card travels too', async () => {
    const [a, b] = peers as [LoroPeer, LoroPeer];
    dragBlock(a.view, 'Bravo', null);
    await partner(b, a, (v) => {
      const at = collectHeadings(v.state.doc).find((e) => e.type === 'block' && e.text === 'Charlie')!.pos;
      v.dispatch(v.state.tr.insert(at, cardNode('b2', ['b2 body'])));
    });
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(outline(a.doc())).toEqual(['# Alpha', 'a1', 'a2', '# Charlie', 'c1', '# Bravo', 'b1', 'b2']);
  });

  it('a partner deleting a card inside the dragged section: the rest still moves', async () => {
    const [a, b] = peers as [LoroPeer, LoroPeer];
    dragBlock(a.view, 'Alpha', null);
    await partner(b, a, (v) => {
      let from = -1;
      let to = -1;
      v.state.doc.forEach((n, off) => {
        if (n.type.name === 'card' && n.firstChild!.textContent === 'a1') {
          from = off;
          to = off + n.nodeSize;
        }
      });
      v.dispatch(v.state.tr.delete(from, to));
    });
    expect(dragController.isActive()).toBe(true);
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(outline(a.doc())).toEqual(['# Bravo', 'b1', '# Charlie', 'c1', '# Alpha', 'a2']);
  });

  it('a partner deleting the dragged header itself cancels the drag and moves nothing', async () => {
    const [a, b] = peers as [LoroPeer, LoroPeer];
    dragBlock(a.view, 'Bravo', null);
    await partner(b, a, (v) => {
      const e = collectHeadings(v.state.doc).find((x) => x.type === 'block' && x.text === 'Bravo')!;
      v.dispatch(v.state.tr.delete(e.pos, e.pos + v.state.doc.nodeAt(e.pos)!.nodeSize));
    });
    expect(dragController.isActive()).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('changed by a partner'));
    expect(outline(a.doc())).toEqual(['# Alpha', 'a1', 'a2', 'b1', '# Charlie', 'c1']);
  });

  it('my own edit landing mid-drag (no session needed) keeps the section whole', async () => {
    const [a] = peers as [LoroPeer, LoroPeer];
    dragBlock(a.view, 'Alpha', null);
    a.view.dispatch(a.view.state.tr.insertText('~', findText(a.view.state.doc, 'c1 body').to));
    expect(dragController.commit()).toBe(true);
    await settle();
    expect(outline(a.doc())).toEqual(['# Bravo', 'b1', '# Charlie', 'c1', '# Alpha', 'a1', 'a2']);
  });
});
