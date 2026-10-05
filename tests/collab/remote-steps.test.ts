// @vitest-environment jsdom
/**
 * Exact steps for a partner's edits (collab/remote-steps.ts): a remote batch
 * is rendered as the steps that actually happened — per child, per text
 * delta — instead of one replace from the first difference to the last.
 * What matters downstream is the transaction MAPPING: a position the
 * partner did not touch must map exactly and never read as deleted.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { loroSyncPluginKey } from 'loro-prosemirror';
import { schema } from '../../src/schema/index.js';
import { installRemoteStepBuilder, remoteStepStats } from '../../src/editor/collab/remote-steps.js';
import { createLoroPeers, settle, docOf, cardNode, para, findText, type LoroPeer } from './_loro-helpers.js';

declare global {
  // eslint-disable-next-line no-var
  var __CM_MOVABLE_LIST__: boolean | undefined;
}

interface Rig {
  A: LoroPeer;
  B: LoroPeer;
  /** Remote renders dispatched on A, oldest first. */
  remote: Transaction[];
}
async function rig(seed: PMNode): Promise<Rig> {
  globalThis.__CM_MOVABLE_LIST__ = true;
  const [A, B] = (await createLoroPeers(seed, 2)) as [LoroPeer, LoroPeer];
  const remote: Transaction[] = [];
  const v = A.view;
  v.setProps({
    dispatchTransaction(tr) {
      const meta = tr.getMeta(loroSyncPluginKey) as { type?: string } | undefined;
      if (meta?.type === 'non-local-updates' && tr.docChanged) remote.push(tr);
      v.updateState(v.state.apply(tr));
    },
  });
  await settle();
  return { A, B, remote };
}
/** Everything B has, delivered to A as ONE import. */
async function deliver(r: Rig): Promise<void> {
  r.A.import(r.B.exportAll());
  await settle();
}
function typeAfter(p: LoroPeer, anchor: string, text: string): void {
  p.view.dispatch(p.view.state.tr.insertText(text, findText(p.view.state.doc, anchor).to));
}
const seed = () =>
  docOf(
    cardNode('Alpha', ['alpha body one two three']),
    cardNode('Bravo', ['bravo body']),
    cardNode('Charlie', ['charlie body']),
  );

beforeAll(() => installRemoteStepBuilder());
beforeEach(() => {
  remoteStepStats.exact = remoteStepStats.fallback = remoteStepStats.deltaBlocks = remoteStepStats.diffBlocks = 0;
});

describe('exact remote steps', () => {
  it('two distant edits in one batch are two small steps; what lies between is untouched', async () => {
    const r = await rig(seed());
    const mine = findText(r.A.doc(), 'bravo body');
    typeAfter(r.B, 'Alpha', ' <b1>');
    typeAfter(r.B, 'charlie body', ' <b2>');
    await settle();
    await deliver(r);

    expect(r.remote).toHaveLength(1);
    const tr = r.remote[0]!;
    expect(tr.steps).toHaveLength(2);
    for (const pos of [mine.from, mine.from + 3, mine.to]) {
      const res = tr.mapping.mapResult(pos);
      expect(res.deleted, `position ${pos} in the untouched card`).toBe(false);
      expect(res.pos).toBe(pos + ' <b1>'.length);
    }
    expect(r.A.doc().eq(r.B.doc())).toBe(true);
    expect(remoteStepStats).toMatchObject({ exact: 1, fallback: 0, deltaBlocks: 2 });
  });

  it('deleting " SECOND" from "one SECOND two" deletes exactly those characters', async () => {
    const r = await rig(docOf(para('one SECOND two')));
    const { from, to } = findText(r.B.doc(), ' SECOND');
    r.B.view.dispatch(r.B.view.state.tr.delete(from, to));
    await settle();
    await deliver(r);

    const tr = r.remote[0]!;
    expect(tr.steps).toHaveLength(1);
    const map = tr.mapping.maps[0]!;
    const ranges: number[][] = [];
    map.forEach((oldStart, oldEnd, newStart, newEnd) => ranges.push([oldStart, oldEnd, newStart, newEnd]));
    expect(ranges).toEqual([[from, to, from, from]]);
    // The space that survives (before "two") is the one that was there.
    expect(tr.mapping.mapResult(to).deleted).toBe(false);
    expect(r.A.doc().textContent).toBe('one two');
  });

  it('a mark-only change moves no positions at all', async () => {
    const r = await rig(seed());
    const h = findText(r.B.doc(), 'body one two');
    const markName = Object.keys(schema.marks).find((m) => /highlight/i.test(m))!;
    r.B.view.dispatch(r.B.view.state.tr.addMark(h.from, h.to, schema.marks[markName]!.create()));
    await settle();
    await deliver(r);

    const tr = r.remote[0]!;
    expect(tr.steps.length).toBeGreaterThan(0);
    for (const m of tr.mapping.maps) {
      let ranges = 0;
      m.forEach(() => ranges++);
      expect(ranges, 'a mark step has an empty map').toBe(0);
    }
    expect(r.A.doc().eq(r.B.doc())).toBe(true);
    expect(remoteStepStats.fallback).toBe(0);
  });

  it('a moved card leaves the cards it jumped over in place', async () => {
    const r = await rig(seed());
    const bravo = findText(r.A.doc(), 'bravo body');
    const first = r.B.doc().child(0);
    const t = r.B.view.state.tr;
    t.delete(0, first.nodeSize);
    t.insert(t.doc.content.size, first);
    r.B.view.dispatch(t);
    await settle();
    await deliver(r);

    const tr = r.remote[0]!;
    const res = tr.mapping.mapResult(bravo.from);
    expect(res.deleted).toBe(false);
    expect(res.pos).toBe(bravo.from - first.nodeSize);
    expect(r.A.doc().eq(r.B.doc())).toBe(true);
    expect(remoteStepStats.fallback).toBe(0);
  });

  it('a partner splitting a paragraph leaves both halves mapped', async () => {
    const r = await rig(docOf(para('one two three'), para('four five')));
    const three = findText(r.A.doc(), 'three');
    const four = findText(r.A.doc(), 'four');
    r.B.view.dispatch(r.B.view.state.tr.split(findText(r.B.doc(), 'one two').to));
    await settle();
    await deliver(r);

    const tr = r.remote[0]!;
    expect(tr.mapping.mapResult(four.from).deleted).toBe(false);
    expect(tr.mapping.map(four.from)).toBe(four.from + 2);
    expect(r.A.doc().eq(r.B.doc())).toBe(true);
    expect(r.A.doc().childCount).toBe(3);
    void three;
    expect(remoteStepStats.fallback).toBe(0);
  });

  it('astral characters: Loro delta offsets are the editor offsets', async () => {
    const r = await rig(docOf(para('a😀b😀c')));
    typeAfter(r.B, 'a😀b', '🎉x');
    await settle();
    await deliver(r);
    expect(r.A.doc().textContent).toBe('a😀b🎉x😀c');
    expect(remoteStepStats).toMatchObject({ fallback: 0, deltaBlocks: 1, diffBlocks: 0 });
    const tr = r.remote[0]!;
    const ranges: number[][] = [];
    tr.mapping.maps[0]!.forEach((a, b, c, d) => ranges.push([a, b, c, d]));
    const at = 1 + 'a😀b'.length;
    expect(ranges).toEqual([[at, at, at, at + '🎉x'.length]]);
  });

  it('insert, delete and retype in one block arrive as separate exact edits', async () => {
    const r = await rig(docOf(para('alpha beta gamma delta')));
    const v = r.B.view;
    v.dispatch(v.state.tr.insertText('X', findText(v.state.doc, 'alpha').to));
    const g = findText(v.state.doc, ' gamma');
    v.dispatch(v.state.tr.delete(g.from, g.to));
    await settle();
    const keep = findText(r.A.doc(), 'beta');
    await deliver(r);
    const tr = r.remote[0]!;
    expect(tr.steps).toHaveLength(2);
    expect(tr.mapping.mapResult(keep.from + 1).deleted).toBe(false);
    expect(r.A.doc().textContent).toBe('alphaX beta delta');
  });

  it('a new card, a deleted card and typing elsewhere in one batch', async () => {
    const r = await rig(seed());
    const alpha = findText(r.A.doc(), 'alpha body');
    const v = r.B.view;
    v.dispatch(v.state.tr.insert(v.state.doc.content.size, cardNode('Delta', ['delta body'])));
    let from = -1;
    let to = -1;
    v.state.doc.forEach((n, off) => {
      if (n.textContent.startsWith('Bravo')) {
        from = off;
        to = off + n.nodeSize;
      }
    });
    v.dispatch(v.state.tr.delete(from, to));
    typeAfter(r.B, 'charlie body', '!');
    await settle();
    await deliver(r);
    const tr = r.remote[0]!;
    expect(tr.mapping.mapResult(alpha.from).deleted).toBe(false);
    expect(tr.mapping.map(alpha.from)).toBe(alpha.from);
    expect(r.A.doc().eq(r.B.doc())).toBe(true);
    expect(remoteStepStats.fallback).toBe(0);
  });
});
