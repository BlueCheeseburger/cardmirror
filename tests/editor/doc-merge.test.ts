import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { buildMerged, mergeDocs, planMerge } from '../../src/editor/doc-merge.js';

const n = schema.nodes;
const t = (s: string): PMNode => schema.text(s);
const body = (s: string): PMNode => n['card_body']!.create(null, t(s));
const card = (tag: string, ...bodies: string[]): PMNode =>
  n['card']!.create(null, [n['tag']!.create(null, t(tag)), ...bodies.map(body)]);
const doc = (...kids: PMNode[]): PMNode => n['doc']!.create(null, kids);
const texts = (d: PMNode): string[] => {
  const out: string[] = [];
  d.descendants((x) => {
    if (x.isTextblock) out.push(x.textContent);
    return !x.isTextblock;
  });
  return out;
};

describe('doc merge', () => {
  it('keeps shared content once and unions non-conflicting additions', () => {
    const a = doc(card('Alpha', 'a1'), card('Gamma', 'g1'));
    const b = doc(card('Alpha', 'a1'), card('Beta', 'b1'), card('Gamma', 'g1'));
    const plan = planMerge(a, b);
    expect(plan.conflicts).toBe(0);
    expect(plan.onlyB).toBe(2);
    expect(texts(buildMerged(plan, a))).toEqual(['Alpha', 'a1', 'Beta', 'b1', 'Gamma', 'g1']);
  });

  it('adds a paragraph from one side into the card it lands in', () => {
    const a = doc(card('Alpha', 'a1'));
    const b = doc(card('Alpha', 'a1', 'a2 extra'));
    const merged = mergeDocs(a, b);
    expect(merged.childCount).toBe(1);
    expect(merged.child(0).childCount).toBe(3);
  });

  it('merges changes made in different places of the same card', () => {
    const a = doc(card('Alpha', 'a1', 'a2'));
    const b = doc(card('Alpha', 'a1', 'a2', 'a3 from b'));
    const c = doc(card('Alpha', 'a0 from a', 'a1', 'a2'));
    expect(texts(mergeDocs(c, b))).toEqual(['Alpha', 'a0 from a', 'a1', 'a2', 'a3 from b']);
    expect(planMerge(a, b).conflicts).toBe(0);
  });

  it('flags a line edited differently on both sides as a conflict', () => {
    const a = doc(card('Alpha', 'the quick brown fox jumps over the lazy dog'));
    const b = doc(card('Alpha', 'the quick brown fox leaps over the lazy dog'));
    const plan = planMerge(a, b);
    expect(plan.conflicts).toBe(1);
    expect(texts(mergeDocs(a, b, 'a'))).toEqual(['Alpha', 'the quick brown fox jumps over the lazy dog']);
    expect(texts(mergeDocs(a, b, 'b'))).toEqual(['Alpha', 'the quick brown fox leaps over the lazy dog']);
    expect(texts(mergeDocs(a, b, 'both')).length).toBe(3);
  });

  it('is a no-op for identical documents', () => {
    const a = doc(card('Alpha', 'a1'), card('Beta', 'b1'));
    const merged = mergeDocs(a, a);
    expect(merged.eq(a)).toBe(true);
  });
});
