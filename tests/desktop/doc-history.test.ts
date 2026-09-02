// @vitest-environment node
/**
 * Version-history snapshot store (doc-history.ts) — real-fs tests in a
 * per-run temp dir, same rationale as doc-writes.test.ts: the module
 * IS the disk layer.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  storeHistorySnapshot,
  listHistorySnapshots,
  readHistorySnapshot,
  historyUsage,
  clearHistory,
  type HistoryPolicy,
} from '../../apps/desktop/src/doc-history.js';

let root: string;
const POLICY: HistoryPolicy = {
  retentionDays: 30,
  maxDocBytes: 10_000,
  maxTotalBytes: 100_000,
};

const bytes = (fill: string, size = 100): Buffer => Buffer.alloc(size, fill);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-history-'));
  created.push(root);
});
const created: string[] = [];
afterAll(async () => {
  for (const dir of created) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('storeHistorySnapshot', () => {
  it('stores, lists newest-first, and round-trips bytes', async () => {
    expect((await storeHistorySnapshot(root, 'doc1', bytes('a'), POLICY)).stored).toBe(true);
    await sleep(5); // distinct filename timestamps
    expect((await storeHistorySnapshot(root, 'doc1', bytes('b'), POLICY)).stored).toBe(true);
    const list = await listHistorySnapshots(root, 'doc1');
    expect(list.length).toBe(2);
    expect(list[0]!.ts).toBeGreaterThanOrEqual(list[1]!.ts);
    const newest = await readHistorySnapshot(root, 'doc1', list[0]!.id);
    expect(newest!.equals(bytes('b'))).toBe(true);
  });

  it('dedups content identical to the newest snapshot', async () => {
    await storeHistorySnapshot(root, 'doc1', bytes('a'), POLICY);
    const again = await storeHistorySnapshot(root, 'doc1', bytes('a'), POLICY);
    expect(again).toEqual({ stored: false, reason: 'unchanged' });
    expect((await listHistorySnapshots(root, 'doc1')).length).toBe(1);
    // A CHANGED doc stores again, even if an older version matches.
    await sleep(5);
    await storeHistorySnapshot(root, 'doc1', bytes('b'), POLICY);
    await sleep(5);
    expect((await storeHistorySnapshot(root, 'doc1', bytes('a'), POLICY)).stored).toBe(true);
  });

  it('refuses hostile doc ids', async () => {
    const res = await storeHistorySnapshot(root, '../escape', bytes('a'), POLICY);
    expect(res).toEqual({ stored: false, reason: 'bad-doc-id' });
    expect(await readHistorySnapshot(root, '../escape', 'x')).toBeNull();
  });

  it('prunes a doc to its byte cap, oldest first, keeping the newest', async () => {
    // 6 x 3000B against a 10000B cap → keep the newest ~3.
    for (const f of ['a', 'b', 'c', 'd', 'e', 'f']) {
      await storeHistorySnapshot(root, 'doc1', bytes(f, 3000), POLICY);
      await sleep(5);
    }
    const list = await listHistorySnapshots(root, 'doc1');
    const total = list.reduce((s, e) => s + e.size, 0);
    expect(total).toBeLessThanOrEqual(POLICY.maxDocBytes);
    const newest = await readHistorySnapshot(root, 'doc1', list[0]!.id);
    expect(newest!.equals(bytes('f', 3000))).toBe(true);
  });

  it('never prunes a doc down to zero, even over its own cap', async () => {
    await storeHistorySnapshot(root, 'doc1', bytes('x', 50_000), POLICY); // 5x the doc cap
    const list = await listHistorySnapshots(root, 'doc1');
    expect(list.length).toBe(1);
  });

  it('prunes globally across docs to the total cap, protecting each newest', async () => {
    const tight: HistoryPolicy = { ...POLICY, maxDocBytes: 100_000, maxTotalBytes: 20_000 };
    for (const doc of ['doc1', 'doc2', 'doc3']) {
      for (const f of ['a', 'b']) {
        await storeHistorySnapshot(root, doc, bytes(`${doc}${f}`.slice(-1), 6000), tight);
        await sleep(5);
      }
    }
    const usage = await historyUsage(root);
    expect(usage.totalBytes).toBeLessThanOrEqual(tight.maxTotalBytes + 6000); // newest-protection may exceed
    for (const doc of ['doc1', 'doc2', 'doc3']) {
      expect((await listHistorySnapshots(root, doc)).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('save triggers', () => {
  it('stores the trigger in the filename and lists it back', async () => {
    await storeHistorySnapshot(root, 'doc1', bytes('a'), POLICY, 'manual');
    await sleep(5);
    await storeHistorySnapshot(root, 'doc1', bytes('b'), POLICY, 'auto');
    const list = await listHistorySnapshots(root, 'doc1');
    expect(list.map((e) => e.trigger)).toEqual(['auto', 'manual']);
    // Ids stay readable snapshot ids.
    expect((await readHistorySnapshot(root, 'doc1', list[0]!.id))!.equals(bytes('b'))).toBe(true);
  });

  it('triggerless snapshots (legacy files) list with no trigger', async () => {
    await storeHistorySnapshot(root, 'doc1', bytes('a'), POLICY);
    const list = await listHistorySnapshots(root, 'doc1');
    expect(list[0]!.trigger).toBeUndefined();
  });

  it('dedup is content-based: same bytes with a different trigger still skip', async () => {
    await storeHistorySnapshot(root, 'doc1', bytes('a'), POLICY, 'manual');
    const again = await storeHistorySnapshot(root, 'doc1', bytes('a'), POLICY, 'auto');
    expect(again.stored).toBe(false);
    expect(again.reason).toBe('unchanged');
  });

  it('an unknown trigger value is dropped, not stored in the name', async () => {
    await storeHistorySnapshot(root, 'doc1', bytes('a'), POLICY, 'hax' as never);
    const list = await listHistorySnapshots(root, 'doc1');
    expect(list.length).toBe(1);
    expect(list[0]!.trigger).toBeUndefined();
  });
});

describe('usage + clear', () => {
  it('reports totals and clears everything', async () => {
    await storeHistorySnapshot(root, 'doc1', bytes('a', 500), POLICY);
    await storeHistorySnapshot(root, 'doc2', bytes('b', 700), POLICY);
    const usage = await historyUsage(root);
    expect(usage.snapshots).toBe(2);
    expect(usage.totalBytes).toBe(1200);
    await clearHistory(root);
    expect(await historyUsage(root)).toEqual({ totalBytes: 0, snapshots: 0 });
    expect(await listHistorySnapshots(root, 'doc1')).toEqual([]);
  });

  it('usage on a nonexistent root is zero, not an error', async () => {
    expect(await historyUsage(path.join(root, 'nope'))).toEqual({ totalBytes: 0, snapshots: 0 });
  });
});
