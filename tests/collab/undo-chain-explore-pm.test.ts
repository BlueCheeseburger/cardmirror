// @vitest-environment jsdom
/**
 * EXPLORATION (multiplayer-undo branch): OPTION B — session undo through
 * ProseMirror's own history in its collaborative mode. Remote renders are
 * stamped addToHistory:false, so the history maps my steps THROUGH partner
 * edits; an undo is an ordinary local transaction the binding syncs forward.
 * Same scenarios as the Loro-manager probes, for a side-by-side transcript.
 */
import { describe, it } from 'vitest';
import { Plugin, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { history, undo as pmUndo, redo as pmRedo, undoDepth, redoDepth } from 'prosemirror-history';
import { loroSyncPluginKey } from 'loro-prosemirror';
import { headingIdGuardPlugin } from '../../src/editor/heading-id-guard.js';
import { collabInvariantHealPlugin } from '../../src/editor/collab/collab-invariants.js';
import { enterMidTag } from '../../src/editor/tag-keymap.js';
import { schema } from '../../src/schema/index.js';
import { createLoroPeers, settle, docOf, cardNode, para, findText, type LoroPeer } from './_loro-helpers.js';

declare global {
  // eslint-disable-next-line no-var
  var __CM_MOVABLE_LIST__: boolean | undefined;
}
const show = (d: PMNode): string => {
  const out: string[] = [];
  d.descendants((n) => {
    if (n.isTextblock) {
      out.push(`${n.type.name[0]}:${n.textContent}`);
      return false;
    }
    return true;
  });
  return out.join(' | ');
};
async function sync(peers: LoroPeer[]): Promise<void> {
  for (let r = 0; r < 3; r++) {
    const blobs = peers.map((p) => p.exportAll());
    peers.forEach((p) => blobs.forEach((b) => p.import(b)));
    await settle();
  }
}
interface Rig {
  peers: LoroPeer[];
  log: string[];
}
async function rig(seed: PMNode): Promise<Rig> {
  globalThis.__CM_MOVABLE_LIST__ = true;
  // The binding's own transactions (remote renders, the init load) are not
  // user edits: the history maps through them instead of recording them.
  // Stamped from a plugin so it covers the init load, which dispatches
  // before a test could swap in its own dispatchTransaction.
  const stamp = new Plugin({
    filterTransaction(tr) {
      if (tr.getMeta(loroSyncPluginKey) !== undefined) tr.setMeta('addToHistory', false);
      return true;
    },
  });
  const peers = await createLoroPeers(seed, 2, () => [stamp, headingIdGuardPlugin, history({ newGroupDelay: 0 }), collabInvariantHealPlugin()]);
  await settle();
  return { peers, log: [] };
}
async function typeAfter(r: Rig, i: number, anchor: string, text: string): Promise<void> {
  const v = r.peers[i]!.view;
  const at = findText(v.state.doc, anchor).to;
  v.dispatch(v.state.tr.insertText(text, at));
  await settle();
  r.peers[i]!.ldoc.commit();
}
async function del(r: Rig, i: number, text: string): Promise<void> {
  const v = r.peers[i]!.view;
  const { from, to } = findText(v.state.doc, text);
  v.dispatch(v.state.tr.delete(from, to));
  await settle();
}
/** Undo that never spends a keypress on a dead step: if the popped event
 *  no longer changes the document, keep going. */
function skippingUndo(v: EditorView): { ran: boolean; skipped: number } {
  let skipped = 0;
  for (;;) {
    if (undoDepth(v.state) === 0) return { ran: false, skipped };
    const before = v.state.doc;
    pmUndo(v.state, (tr) => v.dispatch(tr));
    if (!v.state.doc.eq(before)) return { ran: true, skipped };
    skipped++;
  }
}
async function undo(r: Rig, i: number, label = 'undo'): Promise<void> {
  const v = r.peers[i]!.view;
  const res = skippingUndo(v);
  await settle(6);
  await sync(r.peers);
  const conv = r.peers[0]!.doc().eq(r.peers[1]!.doc()) ? '' : '  !! PEERS DIVERGED';
  r.log.push(`  ${'AB'[i]} ${label}: ran=${res.ran} skipped=${res.skipped} undoDepth=${undoDepth(v.state)} redoDepth=${redoDepth(v.state)}${conv}\n      → ${show(v.state.doc)}`);
}
async function redo(r: Rig, i: number): Promise<void> {
  const v = r.peers[i]!.view;
  const ran = pmRedo(v.state, (tr) => v.dispatch(tr));
  await settle(6);
  await sync(r.peers);
  r.log.push(`  ${'AB'[i]} redo: ran=${ran} redoDepth=${redoDepth(v.state)}\n      → ${show(v.state.doc)}`);
}
const mark = (r: Rig, s: string): void => void r.log.push(`  [${s}] ${show(r.peers[0]!.view.state.doc)}`);
// eslint-disable-next-line no-console
const dump = (name: string, r: Rig): void => console.log(`\n=== PM ${name} ===\n${r.log.join('\n')}`);
const seed = () => docOf(cardNode('Alpha', ['alpha body one two three']), cardNode('Bravo', ['bravo body']), cardNode('Charlie', ['charlie body']));

describe.skipIf(!process.env['UNDO_PROBES'])('OPTION B: ProseMirror history in collab mode (exploration)', () => {
  it('S1 partner edits elsewhere', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'alpha body one', ' A1');
    await typeAfter(r, 0, 'Alpha', ' A2');
    await sync(r.peers);
    await typeAfter(r, 1, 'bravo body', ' B1');
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 3; k++) await undo(r, 0);
    await redo(r, 0);
    await redo(r, 0);
    dump('S1 unrelated partner edit', r);
  });
  it('S2 partner types INSIDE my inserted text', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    await typeAfter(r, 0, 'alpha body one', ' HELLOWORLD');
    await sync(r.peers);
    await typeAfter(r, 1, 'HELLO', '<b>');
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 3; k++) await undo(r, 0);
    await redo(r, 0);
    await redo(r, 0);
    dump('S2 partner typed inside my insertion', r);
  });
  it('S3 partner deletes my inserted text', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    await typeAfter(r, 0, 'alpha body one', ' SECOND');
    await sync(r.peers);
    await del(r, 1, ' SECOND');
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 2; k++) await undo(r, 0);
    await redo(r, 0);
    await redo(r, 0);
    dump('S3 partner deleted my insertion', r);
  });
  it('S4 partner types over the region containing my edit', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    await typeAfter(r, 0, 'alpha body one', ' SECOND');
    await sync(r.peers);
    const v = r.peers[1]!.view;
    const a = findText(v.state.doc, 'alpha body one');
    const b = findText(v.state.doc, 'three');
    v.dispatch(v.state.tr.insertText('REPLACED', a.from, b.to));
    await settle();
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 2; k++) await undo(r, 0);
    dump('S4 partner typed over the region', r);
  });
  it('S5 partner deletes the whole card I edited', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    await typeAfter(r, 0, 'bravo body', ' SECOND');
    await sync(r.peers);
    const v = r.peers[1]!.view;
    let from = -1;
    let to = -1;
    v.state.doc.forEach((n, off) => {
      if (n.textContent.startsWith('Bravo')) {
        from = off;
        to = off + n.nodeSize;
      }
    });
    v.dispatch(v.state.tr.delete(from, to));
    await settle();
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 2; k++) await undo(r, 0);
    dump('S5 partner deleted the card holding my last edit', r);
  });
  it('S6 I delete text; partner types at that spot', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    await del(r, 0, ' two');
    await sync(r.peers);
    await typeAfter(r, 1, 'alpha body one', ' <b>');
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 2; k++) await undo(r, 0);
    dump('S6 my deletion, partner typed at the gap', r);
  });
  it('S7 partner splits the paragraph through my insertion', async () => {
    const r = await rig(docOf(para('one two three'), para('four five')));
    await typeAfter(r, 0, 'four', ' first');
    await typeAfter(r, 0, 'one', ' HELLOWORLD');
    await sync(r.peers);
    const v = r.peers[1]!.view;
    v.dispatch(v.state.tr.split(findText(v.state.doc, 'HELLO').to));
    await settle();
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 2; k++) await undo(r, 0);
    dump('S7 partner split the paragraph inside my insertion', r);
  });
  it('S8 I split a paragraph; partner types in the second half', async () => {
    const r = await rig(docOf(para('one two three'), para('four five')));
    await typeAfter(r, 0, 'four', ' first');
    const v0 = r.peers[0]!.view;
    v0.dispatch(v0.state.tr.split(findText(v0.state.doc, 'one two').to));
    await settle();
    await sync(r.peers);
    await typeAfter(r, 1, 'three', ' <b>');
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 2; k++) await undo(r, 0);
    dump('S8 my split, partner typed in the new half', r);
  });
  it('S9 I move a card; partner edits inside it', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    const v0 = r.peers[0]!.view;
    const first = v0.state.doc.child(0);
    const tr = v0.state.tr;
    tr.delete(0, first.nodeSize);
    tr.insert(tr.doc.content.size, first);
    v0.dispatch(tr);
    await settle();
    await sync(r.peers);
    await typeAfter(r, 1, 'alpha body', ' <b>');
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 2; k++) await undo(r, 0);
    dump('S9 my card move, partner edited inside the moved card', r);
  });
  it('S10 I highlight; partner types inside it', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    const v0 = r.peers[0]!.view;
    const h = findText(v0.state.doc, 'body one two');
    const markName = Object.keys(schema.marks).find((m) => /highlight/i.test(m))!;
    v0.dispatch(v0.state.tr.addMark(h.from, h.to, schema.marks[markName]!.create()));
    await settle();
    await sync(r.peers);
    await typeAfter(r, 1, 'body one', ' <b>');
    await sync(r.peers);
    mark(r, 'start');
    await undo(r, 0, 'undo(highlight)');
    const out: string[] = [];
    r.peers[0]!.view.state.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === markName)) out.push(n.text!);
      return true;
    });
    r.log.push(`      highlighted now: "${out.join('+')}"`);
    await undo(r, 0);
    dump('S10 my highlight, partner typed inside it', r);
  });
  it('F1 I insert a card, partner types in it, I keep editing elsewhere', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' a1');
    const v0 = r.peers[0]!.view;
    v0.dispatch(v0.state.tr.insert(v0.state.doc.content.size, cardNode('Delta', ['delta body'])));
    await settle();
    await sync(r.peers);
    await typeAfter(r, 1, 'delta body', ' <b>');
    await sync(r.peers);
    await typeAfter(r, 0, 'charlie body', ' a3');
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 3; k++) await undo(r, 0);
    dump('F1 my inserted card was edited by partner (NO guard yet)', r);
  });
  it('F2 I Enter mid-tag, partner types in the new half, I keep editing', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'bravo body', ' a1');
    const v0 = r.peers[0]!.view;
    v0.dispatch(v0.state.tr.setSelection(TextSelection.create(v0.state.doc, 2 + 3)));
    enterMidTag(v0.state, (tr) => v0.dispatch(tr));
    await settle();
    await sync(r.peers);
    const vb = r.peers[1]!.view;
    let tagEnd = -1;
    vb.state.doc.descendants((n, pos) => {
      if (tagEnd < 0 && n.type.name === 'tag') tagEnd = pos + 1 + n.content.size;
      return tagEnd < 0;
    });
    vb.dispatch(vb.state.tr.insertText(' <b>', tagEnd));
    await settle();
    await sync(r.peers);
    await typeAfter(r, 0, 'charlie body', ' a3');
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 3; k++) await undo(r, 0);
    dump('F2 my Enter-split, partner typed in the new half (NO guard yet)', r);
  });
  it('F3 two distant partner edits in ONE batch around my edit', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Charlie', ' early');
    await typeAfter(r, 0, 'bravo body', ' MINE');
    await sync(r.peers);
    await typeAfter(r, 1, 'Alpha', ' <b1>');
    await typeAfter(r, 1, 'charlie body', ' <b2>');
    await sync(r.peers); // both land on A as one import → one bounded replace spanning my edit
    mark(r, 'start');
    for (let k = 0; k < 2; k++) await undo(r, 0);
    dump('F3 one remote batch straddling my edit', r);
  });
});
