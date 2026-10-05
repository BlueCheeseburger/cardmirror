// @vitest-environment jsdom
/**
 * EXPLORATION (multiplayer-undo branch): step GROUPING under the app's real
 * setting (mergeInterval 1000) and what grouping does to the undo guard,
 * plus redo survival across partner activity.
 */
import { describe, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { LoroUndoPlugin } from 'loro-prosemirror';
import { UndoManager, type LoroDoc } from 'loro-crdt';
import { headingIdGuardPlugin } from '../../src/editor/heading-id-guard.js';
import { collabInvariantHealPlugin } from '../../src/editor/collab/collab-invariants.js';
import { createUndoGuard, type UndoGuard } from '../../src/editor/collab/undo-guard.js';
import { enterMidTag } from '../../src/editor/tag-keymap.js';
import { createLoroPeers, settle, sleep, docOf, cardNode, findText, type LoroPeer } from './_loro-helpers.js';

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
  guards: UndoGuard[];
  blocked: string[];
  log: string[];
}
async function rig(seed: PMNode): Promise<Rig> {
  globalThis.__CM_MOVABLE_LIST__ = true;
  const ums: UndoManager[] = [];
  const guards: UndoGuard[] = [];
  const blocked: string[] = [];
  const views: Array<EditorView | null> = [];
  const peers = await createLoroPeers(seed, 2, (ldoc: LoroDoc) => {
    const idx = ums.length;
    const um = new UndoManager(ldoc, {}); // the app's configuration: defaults
    ums.push(um);
    const g = createUndoGuard({ doc: ldoc, undoManager: um, getView: () => views[idx] ?? null, onBlocked: (m) => blocked.push(m) });
    guards.push(g);
    return [headingIdGuardPlugin, LoroUndoPlugin({ doc: ldoc as never, undoManager: um }), g.plugin, collabInvariantHealPlugin()];
  });
  peers.forEach((p, i) => (views[i] = p.view));
  await settle();
  return { peers, ums, guards, blocked, log: [] };
}
async function typeAfter(r: Rig, i: number, anchor: string, text: string): Promise<void> {
  const v = r.peers[i]!.view;
  const at = findText(v.state.doc, anchor).to;
  v.dispatch(v.state.tr.insertText(text, at));
  await settle();
  r.peers[i]!.ldoc.commit();
}
async function cmd(r: Rig, i: number, which: 'undo' | 'redo'): Promise<void> {
  const v = r.peers[i]!.view;
  const nb = r.blocked.length;
  const ran = r.guards[i]![which](v.state, (tr) => v.dispatch(tr), v);
  await settle(8);
  await sync(r.peers);
  await settle(4);
  r.log.push(`  ${'AB'[i]} ${which}: ran=${ran}${r.blocked.length > nb ? ' BLOCKED' : ''} canUndo=${r.ums[i]!.canUndo()} canRedo=${r.ums[i]!.canRedo()}\n      → ${show(v.state.doc)}`);
}
const mark = (r: Rig, s: string): void => void r.log.push(`  [${s}] ${show(r.peers[0]!.view.state.doc)}`);
// eslint-disable-next-line no-console
const dump = (name: string, r: Rig): void => console.log(`\n=== ${name} ===\n${r.log.join('\n')}`);
const seed = () => docOf(cardNode('Alpha', ['alpha body one two three']), cardNode('Bravo', ['bravo body']), cardNode('Charlie', ['charlie body']));

describe.skipIf(!process.env['UNDO_PROBES'])('undo grouping + redo under partner edits (exploration)', () => {
  it('M1 steady typing with <1s gaps for 3s: how many undo steps?', async () => {
    const r = await rig(seed());
    let anchor = 'Alpha';
    for (let k = 0; k < 7; k++) {
      await typeAfter(r, 0, anchor, ` w${k}`);
      anchor = `w${k}`;
      await sleep(450);
    }
    mark(r, 'start (7 words over ~3s)');
    await cmd(r, 0, 'undo');
    await cmd(r, 0, 'undo');
    dump('M1 chained merge', r);
  }, 20000);

  it('M2 steady typing across three cards + an Enter split, partner touches the split half', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'charlie body', ' early');
    await sleep(1200); // a real pause: its own step
    await typeAfter(r, 0, 'bravo body', ' b-edit');
    await sleep(300);
    const v0 = r.peers[0]!.view;
    v0.dispatch(v0.state.tr.setSelection(TextSelection.create(v0.state.doc, 2 + 3)));
    enterMidTag(v0.state, (tr) => v0.dispatch(tr));
    await settle();
    await sleep(300);
    await typeAfter(r, 0, 'alpha body one', ' a-edit');
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
    mark(r, 'start');
    await cmd(r, 0, 'undo');
    await cmd(r, 0, 'undo');
    await cmd(r, 0, 'undo');
    dump('M2 a merged step that contains one guarded container', r);
  }, 20000);

  it('M3 redo stack vs partner activity', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' a1');
    await sleep(1100);
    await typeAfter(r, 0, 'bravo body', ' a2');
    await sync(r.peers);
    await cmd(r, 0, 'undo');
    await cmd(r, 0, 'undo');
    await typeAfter(r, 1, 'charlie body', ' <b>');
    await sync(r.peers);
    mark(r, 'partner edited elsewhere after my two undos');
    await cmd(r, 0, 'redo');
    await cmd(r, 0, 'redo');
    dump('M3 redo after partner activity', r);
  }, 20000);

  it('M4 partner edit lands mid-burst: does my burst split?', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' w0');
    await sleep(200);
    await typeAfter(r, 1, 'charlie body', ' <b>');
    await sync(r.peers);
    await typeAfter(r, 0, 'w0', ' w1');
    await sleep(200);
    await typeAfter(r, 0, 'w1', ' w2');
    mark(r, 'start');
    await cmd(r, 0, 'undo');
    await cmd(r, 0, 'undo');
    dump('M4 burst interrupted by a remote import', r);
  }, 20000);
});
