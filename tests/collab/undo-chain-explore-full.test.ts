// @vitest-environment jsdom
/**
 * EXPLORATION (multiplayer-undo branch): the same undo-chain probes as
 * undo-chain-explore, but with the session's real plugin stack — invariant
 * heal, causal mark heal, repair, numbering, heading-id guard and the
 * container-safe undo guard. Prints a transcript; asserts nothing yet.
 */
import { describe, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { LoroUndoPlugin } from 'loro-prosemirror';
import { UndoManager, type LoroDoc } from 'loro-crdt';
import { headingIdGuardPlugin } from '../../src/editor/heading-id-guard.js';
import { cardNumberingPlugin } from '../../src/editor/numbering-plugin.js';
import { collabInvariantHealPlugin } from '../../src/editor/collab/collab-invariants.js';
import { causalMarkHealPlugin } from '../../src/editor/collab/causal-mark-heal.js';
import { collabRepairPlugin } from '../../src/editor/collab/collab-repair.js';
import { createUndoGuard, type UndoGuard } from '../../src/editor/collab/undo-guard.js';
import { enterMidTag } from '../../src/editor/tag-keymap.js';
import { createLoroPeers, settle, docOf, cardNode, findText, type LoroPeer } from './_loro-helpers.js';

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
  commits: string[][];
  log: string[];
}
async function rig(seed: PMNode, mergeInterval = 0): Promise<Rig> {
  globalThis.__CM_MOVABLE_LIST__ = true;
  const ums: UndoManager[] = [];
  const guards: UndoGuard[] = [];
  const blocked: string[] = [];
  const commits: string[][] = [];
  const views: Array<EditorView | null> = [];
  const peers = await createLoroPeers(seed, 2, (ldoc: LoroDoc) => {
    const idx = ums.length;
    const um = new UndoManager(ldoc, { mergeInterval });
    ums.push(um);
    const mine: string[] = [];
    commits.push(mine);
    ldoc.subscribe((e) => {
      if (e.by === 'local') mine.push(e.origin || '(edit)');
    });
    const g = createUndoGuard({ doc: ldoc, undoManager: um, getView: () => views[idx] ?? null, onBlocked: (m) => blocked.push(`${'AB'[idx]}: ${m}`) });
    guards.push(g);
    return [
      headingIdGuardPlugin,
      cardNumberingPlugin,
      LoroUndoPlugin({ doc: ldoc as never, undoManager: um }),
      g.plugin,
      collabInvariantHealPlugin(),
      causalMarkHealPlugin(ldoc),
      collabRepairPlugin(() => idx === 0),
    ];
  });
  peers.forEach((p, i) => (views[i] = p.view));
  await settle();
  commits.forEach((c) => (c.length = 0));
  return { peers, ums, guards, blocked, commits, log: [] };
}
async function typeAfter(r: Rig, i: number, anchor: string, text: string): Promise<void> {
  const v = r.peers[i]!.view;
  const at = findText(v.state.doc, anchor).to;
  v.dispatch(v.state.tr.insertText(text, at));
  await settle();
  r.peers[i]!.ldoc.commit();
}
async function undo(r: Rig, i: number): Promise<void> {
  const v = r.peers[i]!.view;
  const nBlocked = r.blocked.length;
  const nCommits = r.commits[i]!.length;
  const ran = r.guards[i]!.undo(v.state, (tr) => v.dispatch(tr), v);
  await settle(8);
  await sync(r.peers);
  await settle(4);
  const blocked = r.blocked.length > nBlocked ? ' BLOCKED' : '';
  r.log.push(
    `  ${'AB'[i]} undo: ran=${ran}${blocked} canUndo=${r.ums[i]!.canUndo()} canRedo=${r.ums[i]!.canRedo()} localCommits=[${r.commits[i]!.slice(nCommits).join(',')}]\n      → ${show(v.state.doc)}`,
  );
}
function mark(r: Rig, s: string): void {
  r.log.push(`  [${s}] ${show(r.peers[0]!.view.state.doc)}   A-commits-so-far=[${r.commits[0]!.join(',')}]`);
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

describe.skipIf(!process.env['UNDO_PROBES'])('undo chain under partner edits — full session stack (exploration)', () => {
  it('F0 baseline: my three edits, partner edits elsewhere', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Alpha', ' a1');
    await typeAfter(r, 0, 'bravo body', ' a2');
    await sync(r.peers);
    await typeAfter(r, 1, 'charlie body', ' <b>');
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 3; k++) await undo(r, 0);
    dump('F0 baseline', r);
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
    for (let k = 0; k < 5; k++) await undo(r, 0);
    dump('F1 my inserted card was edited by partner', r);
  });

  it('F2 I Enter mid-tag, partner types in the new half, I keep editing elsewhere', async () => {
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
    for (let k = 0; k < 5; k++) await undo(r, 0);
    dump('F2 my Enter-split container was edited by partner', r);
  });

  it('F3 I type in a card; partner moves that card; undo', async () => {
    const r = await rig(seed());
    await typeAfter(r, 0, 'Charlie', ' a1');
    await typeAfter(r, 0, 'alpha body one', ' a2');
    await sync(r.peers);
    const vb = r.peers[1]!.view;
    const first = vb.state.doc.child(0);
    const tr = vb.state.tr;
    tr.delete(0, first.nodeSize);
    tr.insert(tr.doc.content.size, first);
    vb.dispatch(tr);
    await settle();
    await sync(r.peers);
    mark(r, 'start');
    for (let k = 0; k < 3; k++) await undo(r, 0);
    dump('F3 partner moved the card holding my last edit', r);
  });

  it('F4 partner edit lands, then check for phantom local commits on A', async () => {
    const r = await rig(seed(), 1000);
    await typeAfter(r, 0, 'Alpha', ' a1');
    await sync(r.peers);
    const before = r.commits[0]!.length;
    const vb = r.peers[1]!.view;
    vb.dispatch(vb.state.tr.insert(0, cardNode('Zulu', ['zulu body'])));
    await settle();
    await sync(r.peers);
    await typeAfter(r, 1, 'zulu body', ' <b>');
    const h = findText(vb.state.doc, 'alpha body one');
    vb.dispatch(vb.state.tr.split(h.to));
    await settle();
    await sync(r.peers);
    r.log.push(`  A local commits caused by partner activity: [${r.commits[0]!.slice(before).join(',')}]`);
    mark(r, 'start');
    for (let k = 0; k < 3; k++) await undo(r, 0);
    dump('F4 phantom commits', r);
  });
});
