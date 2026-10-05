// @vitest-environment jsdom
/**
 * Randomized check of the exact remote-step builder: a partner makes a
 * batch of random edits, the batch lands as one import, and the render must
 * (1) reproduce the partner's document, (2) be built from exact steps, not
 * the bounded-replace fallback, and (3) keep every position in a top-level
 * child the batch did not change mapped, undeleted, into that same child.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { loroSyncPluginKey, createNodeFromLoroObj, ROOT_DOC_KEY } from 'loro-prosemirror';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { installRemoteStepBuilder, remoteStepStats } from '../../src/editor/collab/remote-steps.js';
import { createLoroPeers, settle, docOf, cardNode, para, type LoroPeer } from './_loro-helpers.js';

declare global {
  // eslint-disable-next-line no-var
  var __CM_MOVABLE_LIST__: boolean | undefined;
}
const SEEDS = Number(process.env['FUZZ_SEEDS'] ?? 12);
const ROUNDS = 25;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function textblocks(doc: PMNode): Array<{ start: number; size: number }> {
  const out: Array<{ start: number; size: number }> = [];
  doc.descendants((n, pos) => {
    if (n.isTextblock) {
      out.push({ start: pos + 1, size: n.content.size });
      return false;
    }
    return true;
  });
  return out;
}
/** Never cut an astral character in half: no caret a person can place sits
 *  between the two halves of a surrogate pair, and Loro (which counts in
 *  code points underneath) would not agree with the editor about the edit. */
function snap(doc: PMNode, pos: number): number {
  const $p = doc.resolve(pos);
  const text = $p.parent.textContent;
  const off = $p.parentOffset;
  if (off > 0 && off < text.length) {
    const hi = text.charCodeAt(off - 1);
    const lo = text.charCodeAt(off);
    if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) return pos + 1;
  }
  return pos;
}
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'aa', 'the the', ' ', 'x', '😀', 'one two'];
const MARKS = Object.values(schema.marks).filter((m) => Object.keys(m.spec.attrs ?? {}).length === 0).slice(0, 3);

/** One random edit on `v`. Every op is schema-safe or skipped. */
function randomOp(v: EditorView, rand: () => number): string {
  const doc = v.state.doc;
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const tbs = textblocks(doc);
  const roll = rand();
  try {
    if (roll < 0.34 && tbs.length) {
      const tb = pick(tbs);
      v.dispatch(v.state.tr.insertText(pick(WORDS), snap(doc, tb.start + Math.floor(rand() * (tb.size + 1)))));
      return 'type';
    }
    if (roll < 0.5 && tbs.length) {
      const tb = pick(tbs.filter((t) => t.size > 0).length ? tbs.filter((t) => t.size > 0) : tbs);
      if (tb.size === 0) return 'skip';
      const a = Math.floor(rand() * tb.size);
      const b = Math.min(tb.size, a + 1 + Math.floor(rand() * 5));
      const from = snap(doc, tb.start + a);
      const to = snap(doc, tb.start + b);
      if (to <= from) return 'skip';
      v.dispatch(v.state.tr.delete(from, to));
      return 'delete';
    }
    if (roll < 0.6 && tbs.length && MARKS.length) {
      const tb = pick(tbs);
      if (tb.size < 2) return 'skip';
      const a = Math.floor(rand() * (tb.size - 1));
      const b = Math.min(tb.size, a + 1 + Math.floor(rand() * 6));
      const mark = pick(MARKS).create();
      const from = snap(doc, tb.start + a);
      const to = snap(doc, tb.start + b);
      if (to <= from) return 'skip';
      const tr = rand() < 0.7 ? v.state.tr.addMark(from, to, mark) : v.state.tr.removeMark(from, to, mark);
      v.dispatch(tr);
      return 'mark';
    }
    if (roll < 0.7) {
      const at = pick([0, doc.content.size, ...childStarts(doc)]);
      v.dispatch(v.state.tr.insert(at, cardNode(`T${Math.floor(rand() * 1000)}`, [`body ${Math.floor(rand() * 1000)}`])));
      return 'insertCard';
    }
    if (roll < 0.78 && doc.childCount > 2) {
      const i = Math.floor(rand() * doc.childCount);
      const from = childStarts(doc)[i]!;
      v.dispatch(v.state.tr.delete(from, from + doc.child(i).nodeSize));
      return 'deleteChild';
    }
    if (roll < 0.9 && doc.childCount > 1) {
      const i = Math.floor(rand() * doc.childCount);
      const node = doc.child(i);
      const from = childStarts(doc)[i]!;
      const tr = v.state.tr.delete(from, from + node.nodeSize);
      const dest = pick([0, tr.doc.content.size, ...childStarts(tr.doc)]);
      tr.insert(dest, node);
      v.dispatch(tr);
      return 'move';
    }
    if (tbs.length) {
      // Split a plain paragraph / card body.
      const tb = pick(tbs);
      const $p = doc.resolve(snap(doc, tb.start + Math.floor(rand() * (tb.size + 1))));
      if ($p.parent.type.name === 'tag') return 'skip';
      const tr = v.state.tr.split($p.pos);
      v.dispatch(tr);
      return 'split';
    }
  } catch {
    return 'skip';
  }
  return 'skip';
}
function childStarts(doc: PMNode): number[] {
  const out: number[] = [];
  doc.forEach((_n, off) => out.push(off));
  return out;
}

beforeAll(() => installRemoteStepBuilder());

describe('exact remote steps — fuzz', () => {
  it(`reproduces the partner document from exact steps across ${SEEDS} seeds`, async () => {
    globalThis.__CM_MOVABLE_LIST__ = true;
    const problems: string[] = [];
    let renders = 0;
    const totals = { exact: 0, fallback: 0, deltaBlocks: 0, diffBlocks: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed * 7919);
      const [A, B] = (await createLoroPeers(
        docOf(
          cardNode('Alpha', ['alpha body one two three', 'second body']),
          para('a loose paragraph'),
          cardNode('Bravo', ['bravo body']),
          cardNode('Charlie', ['charlie body']),
          schema.nodes['block']!.create({ id: newHeadingId() }, schema.text('Block heading')),
          cardNode('Delta', ['delta body']),
        ),
        2,
      )) as [LoroPeer, LoroPeer];
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
      for (let round = 0; round < ROUNDS; round++) {
        const ops: string[] = [];
        const n = 1 + Math.floor(rand() * 4);
        for (let k = 0; k < n; k++) ops.push(randomOp(B.view, rand));
        await settle(1);
        const before = A.doc();
        const stats0 = { ...remoteStepStats };
        remote.length = 0;
        A.import(B.exportAll());
        await settle(2);
        const where = `seed ${seed} round ${round} [${ops.join(',')}]`;
        // The editor shows exactly what Loro holds, and both peers agree.
        const truth = createNodeFromLoroObj(schema, A.ldoc.getMap(ROOT_DOC_KEY) as never, new Map());
        if (!A.doc().eq(truth as PMNode)) {
          problems.push(`${where}: editor differs from Loro`);
          break;
        }
        if (!A.doc().eq(B.doc())) {
          problems.push(`${where}: peers differ`);
          break;
        }
        if (remoteStepStats.fallback > stats0.fallback) problems.push(`${where}: fell back`);
        renders += remote.length;
        // Untouched top-level children keep every position. The editor has
        // no move step, so when the batch reorders children some of them
        // must read as removed and re-inserted (the builder keeps the
        // heaviest in-order set); a batch with no move has no such excuse.
        if (!ops.includes('move')) {
          for (const tr of remote) {
            const kept = new Map<PMNode, number>();
            tr.doc.forEach((node, off) => kept.set(node, off));
            before.forEach((node, off) => {
              const now = kept.get(node);
              if (now === undefined) return; // changed or gone
              for (const inner of [1, Math.floor(node.nodeSize / 2), node.nodeSize - 1]) {
                const res = tr.mapping.mapResult(off + inner);
                if (res.deleted || res.pos !== now + inner) {
                  problems.push(`${where}: position ${off + inner} in an untouched ${node.type.name} mapped to ${res.pos}${res.deleted ? ' (deleted)' : ''}, expected ${now + inner}`);
                  return;
                }
              }
            });
          }
        }
      }
      A.destroy();
      B.destroy();
    }
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] = remoteStepStats[k];
    // eslint-disable-next-line no-console
    console.log(`[remote-steps-fuzz] renders=${renders} stats=${JSON.stringify(totals)} problems=${problems.length}`);
    expect(problems.slice(0, 12)).toEqual([]);
  }, 300_000);
});
