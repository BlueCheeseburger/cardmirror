/**
 * The heading-id invariant fuzzer as a regression fence. The engine
 * (dev/heading-id-fuzz-core.ts) drives the editor's REAL command
 * chains — with the id-integrity guard in the stack — through seeded
 * random structural edits, asserting after every op that heading ids
 * are unique and non-null and nothing threw. Before the guard +
 * crash fixes this found violations on virtually every seed; a
 * finding here means a NEW door opened. Bigger sweeps:
 * `npx tsx dev/heading-id-fuzz.mts 500 100`.
 */
import { describe, it, expect } from 'vitest';
import { runHeadingIdFuzz } from '../../dev/heading-id-fuzz-core.js';

describe('heading-id invariant fuzz (guarded editor)', () => {
  it('40 seeds × 40 ops: no duplicate ids, no null ids, no throws', () => {
    const res = runHeadingIdFuzz(40, 40);
    expect(res.detail, res.detail.join('\n')).toEqual([]);
    expect(res.findings).toBe(0);
  });
});
