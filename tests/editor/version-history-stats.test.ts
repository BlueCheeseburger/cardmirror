/**
 * Version-history digest helpers — the pure core behind the overhauled
 * Recover Previous Version dialog: per-snapshot stats, delta lines vs
 * the previous snapshot, and the "cards not in current doc" badge.
 */
import { describe, it, expect } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  computeSnapshotStats,
  diffSnapshotStats,
  cardsMissingFrom,
  formatDelta,
} from '../../src/editor/version-history.js';

const n = schema.nodes;
function card(id: string, tag: string, body: string) {
  return n['card']!.createChecked(null, [
    n['tag']!.create({ id }, schema.text(tag)),
    n['card_body']!.create(null, schema.text(body)),
  ]);
}
function doc(cards: ReturnType<typeof card>[]) {
  return n['doc']!.createChecked(null, cards);
}

describe('computeSnapshotStats', () => {
  it('counts cards and maps tag ids to content hashes', () => {
    const a = newHeadingId();
    const b = newHeadingId();
    const st = computeSnapshotStats(doc([card(a, 'Tag A', 'body one'), card(b, 'Tag B', 'body two')]));
    expect(st.cards).toBe(2);
    expect(st.words).toBeGreaterThan(0);
    expect([...st.sig.keys()].sort()).toEqual([a, b].sort());
  });

  it('a tag edit changes that id hash only', () => {
    const a = newHeadingId();
    const b = newHeadingId();
    const before = computeSnapshotStats(doc([card(a, 'Tag A', 'x'), card(b, 'Tag B', 'y')]));
    const after = computeSnapshotStats(doc([card(a, 'Tag A EDITED', 'x'), card(b, 'Tag B', 'y')]));
    expect(after.sig.get(a)).not.toBe(before.sig.get(a));
    expect(after.sig.get(b)).toBe(before.sig.get(b));
  });
});

describe('diffSnapshotStats + badges', () => {
  const a = newHeadingId();
  const b = newHeadingId();
  const c = newHeadingId();
  const older = computeSnapshotStats(doc([card(a, 'A', 'one two'), card(b, 'B', 'three')]));
  const newer = computeSnapshotStats(doc([card(a, 'A', 'one two'), card(c, 'C', 'four five six')]));

  it('reports added/removed cards and word delta', () => {
    const d = diffSnapshotStats(newer, older);
    expect(d.addedCards).toBe(1); // c
    expect(d.removedCards).toBe(1); // b
    expect(d.wordsDelta).toBe(newer.words - older.words);
  });

  it('cardsMissingFrom answers the recovery question', () => {
    expect(cardsMissingFrom(older, newer)).toBe(1); // b lives only in older
    expect(cardsMissingFrom(newer, newer)).toBe(0);
  });

  it('formatDelta reads like a change summary', () => {
    const txt = formatDelta(diffSnapshotStats(newer, older));
    expect(txt).toContain('+1 card');
    expect(txt).toContain('−1 card');
    expect(formatDelta({ addedCards: 0, removedCards: 0, wordsDelta: 0 })).toContain(
      'No content changes',
    );
  });
});
