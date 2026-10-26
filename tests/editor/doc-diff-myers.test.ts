/**
 * Myers line diff (doc-diff.ts `diffLines`) checked against a brute-force
 * LCS on random inputs, plus a large worst-case input.
 */
import { it, expect } from 'vitest';
import { diffLines } from '../../src/editor/doc-diff.js';
function lcs(a: string[], b: string[]) {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  return dp[0]![0]!;
}
it('keeps as many equal lines as a brute-force LCS, and replays to both inputs, on random inputs', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 3000; t++) {
    const alpha = 1 + Math.floor(rand() * 6);
    const mk = () => Array.from({ length: Math.floor(rand() * 30) }, () => String(Math.floor(rand() * alpha)));
    const a = mk(), b = mk();
    const r = diffLines(a, b);
    expect(r.filter((l) => l.type !== 'add').map((l) => l.text)).toEqual(a);
    expect(r.filter((l) => l.type !== 'remove').map((l) => l.text)).toEqual(b);
    expect(r.filter((l) => l.type === 'equal').length).toBe(lcs(a, b));
  }
});
it('finishes two 10k-line documents with a tiny alphabet (no unique lines to set aside)', () => {
  let seed = 3;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const mk = () => Array.from({ length: 10000 }, () => String(Math.floor(rand() * 50)));
  const a = mk(), b = mk();
  const r = diffLines(a, b);
  expect(r.filter((l) => l.type !== 'add').length).toBe(10000);
}, 120000);
