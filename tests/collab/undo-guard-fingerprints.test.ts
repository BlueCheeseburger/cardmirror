/**
 * containerFingerprints is cached per document and per top-level child
 * (it runs on every doc-changing transaction in a session). The cache must
 * be invisible: same entries, same ORDER (the guard reads the key order to
 * spot a move), as an uncached walk of the whole document.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { HEADING_TYPE_NAMES } from '../../src/schema/ids.js';
import { containerFingerprints } from '../../src/editor/collab/undo-guard.js';

/** The uncached original. */
function reference(doc: PMNode): Array<[string, string]> {
  const out = new Map<string, string>();
  doc.descendants((n, _pos, parent) => {
    if (!HEADING_TYPE_NAMES.has(n.type.name)) return true;
    const id = n.attrs['id'];
    if (typeof id !== 'string' || !id) return true;
    const container = n.type.name === 'tag' || n.type.name === 'analytic' ? (parent ?? n) : n;
    out.set(id, `${container.type.name}|${container.childCount}|${container.textContent}`);
    return true;
  });
  return [...out];
}
const h = (type: string, text: string): PMNode => schema.nodes[type]!.create({ id: newHeadingId() }, schema.text(text));
const card = (tag: string, ...bodies: string[]): PMNode =>
  schema.nodes['card']!.createChecked(null, [h('tag', tag), ...bodies.map((b) => schema.nodes['card_body']!.create(null, schema.text(b)))]);
const unit = (text: string): PMNode => schema.nodes['analytic_unit']!.createChecked(null, [h('analytic', text)]);

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

describe('containerFingerprints cache', () => {
  it('matches an uncached walk, entry for entry and in order, across edits', () => {
    const rand = rng(20261003);
    const children: PMNode[] = [];
    for (let i = 0; i < 40; i++) {
      children.push(i % 7 === 0 ? h('block', `Block ${i}`) : i % 11 === 0 ? unit(`Analytic ${i}`) : card(`Tag ${i}`, `body ${i}`, `more ${i}`));
    }
    let state = EditorState.create({ doc: schema.nodes['doc']!.create(null, children) });
    const textPositions = (doc: PMNode): number[] => {
      const out: number[] = [];
      doc.descendants((n, pos) => {
        if (n.isTextblock) out.push(pos + 1);
        return !n.isTextblock;
      });
      return out;
    };
    const tops = (doc: PMNode): number[] => {
      const out: number[] = [];
      doc.forEach((_n, off) => out.push(off));
      return out;
    };
    for (let step = 0; step < 250; step++) {
      const doc = state.doc;
      const roll = rand();
      let tr = state.tr;
      if (roll < 0.6) {
        const ps = textPositions(doc);
        tr = tr.insertText('x', ps[Math.floor(rand() * ps.length)]!);
      } else if (roll < 0.75) {
        const ts = tops(doc);
        tr = tr.insert(ts[Math.floor(rand() * ts.length)]!, card(`New ${step}`, 'n'));
      } else if (roll < 0.87 && doc.childCount > 5) {
        const i = Math.floor(rand() * doc.childCount);
        const from = tops(doc)[i]!;
        tr = tr.delete(from, from + doc.child(i).nodeSize);
      } else if (doc.childCount > 2) {
        // Move a top-level child: same ids, different order.
        const i = Math.floor(rand() * doc.childCount);
        const node = doc.child(i);
        const from = tops(doc)[i]!;
        tr = tr.delete(from, from + node.nodeSize);
        const dests = tops(tr.doc);
        tr = tr.insert(dests[Math.floor(rand() * dests.length)]!, node);
      }
      state = state.apply(tr);
      // Old doc first, as the guard does (it is the previous new doc).
      expect([...containerFingerprints(doc)]).toEqual(reference(doc));
      expect([...containerFingerprints(state.doc)], `step ${step}`).toEqual(reference(state.doc));
    }
  });

  it('returns the same map for the same document (one transaction’s new doc is the next one’s old doc)', () => {
    const doc = schema.nodes['doc']!.create(null, [card('A', 'a'), card('B', 'b')]);
    expect(containerFingerprints(doc)).toBe(containerFingerprints(doc));
  });
});
