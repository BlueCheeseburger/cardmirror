// @vitest-environment jsdom
/**
 * EXPLORATION (multiplayer-undo branch): what Loro's UndoManager actually
 * does to a peer's undo chain when a partner's edits land on top of it.
 * Prints a transcript; asserts nothing. Opt-in: UNDO_PROBES=1.
 */
import { describe, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { LoroUndoPlugin, undo as loroUndo, redo as loroRedo } from 'loro-prosemirror';
import { UndoManager, type LoroDoc } from 'loro-crdt';
import { headingIdGuardPlugin } from '../../src/editor/heading-id-guard.js';
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
  ums: UndoManager[];
  log: string[];
}
async function rig(seed: PMNode, mergeInterval = 0): Promise<Rig> {
  globalThis.__CM_MOVABLE_LIST__ = true;
  const ums: UndoManager[] = [];
  const peers = await createLoroPeers(seed, 2, (ldoc: LoroDoc) => {
    const um = new UndoManager(ldoc, { mergeInterval });
    ums.push(um);
    return [headingIdGuardPlugin, LoroUndoPlugin({ doc: ldoc as never, undoManager: um })];
  });
  await settle();
  return { peers, ums, log: [] };
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
  r.peers[i]!.ldoc.commit();
}
async function undo(r: Rig, i: number, label = 'undo'): Promise<void> {
  const v = r.peers[i]!.view;
  const can = r.ums[i]!.canUndo();
  const ran = loroUndo(v.state, (tr) => v.dispatch(tr), v);
  await settle(6);
  await sync(r.peers);
  r.log.push(`  ${'AB'[i]} ${label}: canUndo(before)=${can} ran=${ran} canUndo(after)=${r.ums[i]!.canUndo()} canRedo=${r.ums[i]!.canRedo()}\n      → ${show(v.state.doc)}`);
}
async function redo(r: Rig, i: number): Promise<void> {
  const v = r.peers[i]!.view;
  const ran = loroRedo(v.state, (tr) => v.dispatch(tr), v);
  await settle(6);
  await sync(r.peers);
  r.log.push(`  ${'AB'[i]} redo: ran=${ran} canRedo(after)=${r.ums[i]!.canRedo()}\n      → ${show(v.state.doc)}`);
}
function mark(r: Rig, s: string): void {
  r.log.push(`  [${s}] ${show(r.peers[0]!.view.state.doc)}`);
}
function dump(name: string, r: Rig): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${name} ===\n${r.log.join('\n')}`);
}
const seed = () =>
  docOf(
    cardNode('Alpha', ['alpha body one two three']),
    cardNode('Bravo', ['bravo body']),
    cardNode('Charlie', ['charlie body']),
  );

describe.skipIf(!process.env['UNDO_PROBES'])('undo chain under partner edits (exploration)', () => {
  it('S1 partner edits elsewhere', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'alpha body one', ' A1');
    await typeAfter(r, 0, 'Alpha', ' A2');
    await sync(r.peers);
    await typeAfter(r, 1, 'bravo body', ' B1');
    await sync(r.peers);
    mark(r, 'start');
    await undo(r, 0);
    await undo(r, 0);
    await undo(r, 0);
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
    await undo(r, 0);
    await undo(r, 0);
    await undo(r, 0);
    await redo(r, 0);
    await redo(r, 0);
    dump('S2 partner typed inside my insertion', r);
  });

  it('S3 partner deletes my inserted text (overwrite)', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    await typeAfter(r, 0, 'alpha body one', ' SECOND');
    await sync(r.peers);
    await del(r, 1, ' SECOND');
    await sync(r.peers);
    mark(r, 'start');
    await undo(r, 0);
    await undo(r, 0);
    await undo(r, 0);
    await redo(r, 0);
    await redo(r, 0);
    dump('S3 partner deleted my insertion', r);
  });

  it('S4 partner deletes the paragraph region containing my edit + replaces it', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    await typeAfter(r, 0, 'alpha body one', ' SECOND');
    await sync(r.peers);
    // B selects the whole body text and types over it.
    const v = r.peers[1]!.view;
    const a = findText(v.state.doc, 'alpha body one');
    const b = findText(v.state.doc, 'three');
    v.dispatch(v.state.tr.insertText('REPLACED', a.from, b.to));
    await settle();
    await sync(r.peers);
    mark(r, 'start');
    await undo(r, 0);
    await undo(r, 0);
    await undo(r, 0);
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
    await undo(r, 0);
    await undo(r, 0);
    await undo(r, 0);
    dump('S5 partner deleted the card holding my last edit', r);
  });

  it('S6 I delete text; partner types at that spot; undo', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' first');
    await del(r, 0, ' two');
    await sync(r.peers);
    await typeAfter(r, 1, 'alpha body one', ' <b>');
    await sync(r.peers);
    mark(r, 'start');
    await undo(r, 0);
    await undo(r, 0);
    await undo(r, 0);
    dump('S6 my deletion, partner typed at the gap', r);
  });

  it('S7 partner splits the paragraph through my insertion (Enter)', async () => {
    const r = await rig(docOf(para('one two three'), para('four five')));
    await typeAfter(r, 0, 'four', ' first');
    await typeAfter(r, 0, 'one', ' HELLOWORLD');
    await sync(r.peers);
    const v = r.peers[1]!.view;
    const at = findText(v.state.doc, 'HELLO').to;
    v.dispatch(v.state.tr.split(at));
    await settle();
    await sync(r.peers);
    mark(r, 'start');
    await undo(r, 0);
    await undo(r, 0);
    await undo(r, 0);
    dump('S7 partner split the paragraph inside my insertion', r);
  });

  it('S8 I split a paragraph; partner types in the second half; undo', async () => {
    const r = await rig(docOf(para('one two three'), para('four five')));
    await typeAfter(r, 0, 'four', ' first');
    const v0 = r.peers[0]!.view;
    v0.dispatch(v0.state.tr.split(findText(v0.state.doc, 'one two').to));
    await settle();
    await sync(r.peers);
    await typeAfter(r, 1, 'three', ' <b>');
    await sync(r.peers);
    mark(r, 'start');
    await undo(r, 0);
    await undo(r, 0);
    await undo(r, 0);
    dump('S8 my split, partner typed in the new half', r);
  });

  it('S9 I move a card; partner edits inside it; undo', async () => {
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
    await undo(r, 0);
    await undo(r, 0);
    await undo(r, 0);
    dump('S9 my card move, partner edited inside the moved card', r);
  });

  it('S10 I highlight; partner retypes part of it; undo', async () => {
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
    const hl = (): string => {
      const out: string[] = [];
      r.peers[0]!.view.state.doc.descendants((n) => {
        if (n.isText && n.marks.some((m) => m.type.name === markName)) out.push(n.text!);
        return true;
      });
      return out.join('+');
    };
    r.log.push(`      highlighted now: "${hl()}"`);
    await undo(r, 0);
    dump('S10 my highlight, partner typed inside it', r);
  });

  it('S11 default mergeInterval: burst of my typing with a partner edit in the middle', async () => {
    const r = await rig(seed(), 1000);
    await typeAfter(r, 0, 'Alpha', ' a1');
    await sync(r.peers);
    await typeAfter(r, 1, 'bravo body', ' <b>');
    await sync(r.peers);
    await typeAfter(r, 0, 'a1', ' a2');
    await sync(r.peers);
    mark(r, 'start');
    await undo(r, 0);
    await undo(r, 0);
    dump('S11 merged steps around a partner edit (mergeInterval 1000)', r);
  });
});
