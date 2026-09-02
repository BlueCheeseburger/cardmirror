/**
 * Version-history snapshot store — the disk layer under the
 * "Keep version history" setting and the solo-document branch of
 * Recover Previous Version.
 *
 * Layout: `{historyRoot}/{docId}/{unixMs}-{hash12}.cmir`, one complete
 * `.cmir` per retained version. The root lives in the app's userData
 * (main passes `<userData>/history`), NOT beside the document — so
 * snapshots survive (and keep being written) when the document's own
 * folder is wedged by a sync client, and shared folders never leak a
 * history sidecar. Coarser cousin of the crash journals: the journal is
 * the always-on, seconds-fresh, single overwritten copy for crash
 * recovery; this store is the opt-out, capped, browsable trail behind
 * it (see the settings meta for the tiers).
 *
 * The RENDERER owns policy (which tier, its caps) and passes it with
 * every write; this module owns mechanics:
 *   - dedup: a snapshot identical to the doc's newest retained one is
 *     skipped (content hash rides in the filename, so no reads needed);
 *   - retention: entries older than `retentionDays` are pruned;
 *   - caps: oldest-first pruning to `maxDocBytes` per doc, then
 *     `maxTotalBytes` across the whole root — but the newest snapshot
 *     of each doc is never pruned by size (a doc bigger than its own
 *     cap keeps exactly one version rather than none).
 *
 * Writes are tmp+rename (a torn snapshot must never be listed as a
 * recoverable version) and serialized per doc via a small tail chain —
 * same reasoning as doc-writes, at snapshot cadence instead of save
 * cadence.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface HistoryPolicy {
  retentionDays: number;
  maxDocBytes: number;
  maxTotalBytes: number;
}

/** What caused the save that produced a snapshot. Rides in the
 *  filename (no sidecar to prune); absent on pre-trigger files. */
export type SnapshotTrigger = 'manual' | 'auto' | 'close';
const TRIGGERS: readonly SnapshotTrigger[] = ['manual', 'auto', 'close'];

export interface HistoryEntry {
  /** Opaque id (the filename) — pass back to `readHistorySnapshot`. */
  id: string;
  /** Snapshot time (ms since epoch, from the filename). */
  ts: number;
  size: number;
  /** Save trigger, when the filename carries one. */
  trigger?: SnapshotTrigger;
}

const SNAPSHOT_RE = /^(\d{10,16})-([0-9a-f]{12})(?:-(manual|auto|close))?\.cmir$/;
const DOC_ID_SAFE_RE = /^[a-zA-Z0-9_-]+$/;

/** docId → directory name. Ids are app-minted (alphanumeric + dashes),
 *  so anything else is refused rather than sanitized — a lossy mangle
 *  could collide two docs' histories. */
function docDirFor(historyRoot: string, docId: string): string | null {
  if (!DOC_ID_SAFE_RE.test(docId)) return null;
  return path.join(historyRoot, docId);
}

function parseEntry(name: string): { ts: number; hash: string; trigger?: SnapshotTrigger } | null {
  const m = SNAPSHOT_RE.exec(name);
  if (!m) return null;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts)) return null;
  const trigger = m[3] as SnapshotTrigger | undefined;
  return trigger ? { ts, hash: m[2]!, trigger } : { ts, hash: m[2]! };
}

async function listDir(dir: string): Promise<HistoryEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: HistoryEntry[] = [];
  for (const name of names) {
    const parsed = parseEntry(name);
    if (!parsed) continue;
    try {
      const st = await fs.stat(path.join(dir, name));
      if (st.isFile()) {
        const e: HistoryEntry = { id: name, ts: parsed.ts, size: st.size };
        if (parsed.trigger) e.trigger = parsed.trigger;
        out.push(e);
      }
    } catch {
      /* raced a prune — skip */
    }
  }
  out.sort((a, b) => a.ts - b.ts); // oldest first
  return out;
}

/** Per-doc write tails — two snapshot attempts for one doc must not
 *  interleave their prune passes. */
const snapshotTails = new Map<string, Promise<void>>();

function chainSnapshot<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = snapshotTails.get(key) ?? Promise.resolve();
  const run = previous.then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  snapshotTails.set(key, tail);
  void tail.then(() => {
    if (snapshotTails.get(key) === tail) snapshotTails.delete(key);
  });
  return run;
}

export interface SnapshotResult {
  stored: boolean;
  /** 'unchanged' = identical to the doc's newest retained snapshot. */
  reason?: 'unchanged' | 'bad-doc-id';
}

/** Store one snapshot (dedup, then prune per the policy). */
export function storeHistorySnapshot(
  historyRoot: string,
  docId: string,
  buf: Buffer,
  policy: HistoryPolicy,
  trigger?: SnapshotTrigger,
): Promise<SnapshotResult> {
  const dir = docDirFor(historyRoot, docId);
  if (!dir) return Promise.resolve({ stored: false, reason: 'bad-doc-id' });
  return chainSnapshot(docId, async () => {
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    const entries = await listDir(dir);
    const newest = entries[entries.length - 1];
    if (newest) {
      const parsed = parseEntry(newest.id);
      if (parsed && parsed.hash === hash) return { stored: false, reason: 'unchanged' as const };
    }
    await fs.mkdir(dir, { recursive: true });
    const tag = trigger && TRIGGERS.includes(trigger) ? `-${trigger}` : '';
    const name = `${Date.now()}-${hash}${tag}.cmir`;
    const finalPath = path.join(dir, name);
    const tmpPath = `${finalPath}.tmp`;
    await fs.writeFile(tmpPath, buf);
    await fs.rename(tmpPath, finalPath);
    await pruneDoc(dir, policy);
    await pruneGlobal(historyRoot, policy);
    return { stored: true };
  });
}

/** Prune one doc's dir: expiry first, then size (oldest-first), always
 *  keeping the newest snapshot. */
async function pruneDoc(dir: string, policy: HistoryPolicy): Promise<void> {
  const entries = await listDir(dir);
  if (entries.length === 0) return;
  const cutoff = Date.now() - policy.retentionDays * 24 * 3600 * 1000;
  const keepNewest = entries[entries.length - 1]!.id;
  let total = entries.reduce((s, e) => s + e.size, 0);
  for (const e of entries) {
    if (e.id === keepNewest) continue;
    const expired = e.ts < cutoff;
    const overCap = total > policy.maxDocBytes;
    if (!expired && !overCap) continue;
    try {
      await fs.unlink(path.join(dir, e.id));
      total -= e.size;
    } catch {
      /* best effort */
    }
  }
}

/** Prune the whole root to `maxTotalBytes`, oldest-first across docs,
 *  never removing any doc's newest snapshot. Empty doc dirs are
 *  removed so cleared/expired docs don't accumulate husks. */
async function pruneGlobal(historyRoot: string, policy: HistoryPolicy): Promise<void> {
  let docDirs: string[];
  try {
    docDirs = await fs.readdir(historyRoot);
  } catch {
    return;
  }
  const all: Array<HistoryEntry & { dir: string; isNewest: boolean }> = [];
  for (const d of docDirs) {
    if (!DOC_ID_SAFE_RE.test(d)) continue;
    const dir = path.join(historyRoot, d);
    const entries = await listDir(dir);
    if (entries.length === 0) {
      await fs.rmdir(dir).catch(() => {});
      continue;
    }
    const newestId = entries[entries.length - 1]!.id;
    for (const e of entries) all.push({ ...e, dir, isNewest: e.id === newestId });
  }
  let total = all.reduce((s, e) => s + e.size, 0);
  if (total <= policy.maxTotalBytes) return;
  all.sort((a, b) => a.ts - b.ts);
  for (const e of all) {
    if (total <= policy.maxTotalBytes) break;
    if (e.isNewest) continue;
    try {
      await fs.unlink(path.join(e.dir, e.id));
      total -= e.size;
    } catch {
      /* best effort */
    }
  }
}

/** Versions for one doc, newest first (what the recover dialog shows). */
export async function listHistorySnapshots(
  historyRoot: string,
  docId: string,
): Promise<HistoryEntry[]> {
  const dir = docDirFor(historyRoot, docId);
  if (!dir) return [];
  return (await listDir(dir)).reverse();
}

/** One snapshot's bytes, or null (unknown id / pruned meanwhile). */
export async function readHistorySnapshot(
  historyRoot: string,
  docId: string,
  id: string,
): Promise<Buffer | null> {
  const dir = docDirFor(historyRoot, docId);
  if (!dir || !SNAPSHOT_RE.test(id)) return null;
  try {
    return await fs.readFile(path.join(dir, id));
  } catch {
    return null;
  }
}

/** Total bytes + snapshot count across the root (settings readout). */
export async function historyUsage(
  historyRoot: string,
): Promise<{ totalBytes: number; snapshots: number }> {
  let docDirs: string[];
  try {
    docDirs = await fs.readdir(historyRoot);
  } catch {
    return { totalBytes: 0, snapshots: 0 };
  }
  let totalBytes = 0;
  let snapshots = 0;
  for (const d of docDirs) {
    if (!DOC_ID_SAFE_RE.test(d)) continue;
    for (const e of await listDir(path.join(historyRoot, d))) {
      totalBytes += e.size;
      snapshots += 1;
    }
  }
  return { totalBytes, snapshots };
}

/** Remove every snapshot (the settings "Clear version history" button). */
export async function clearHistory(historyRoot: string): Promise<void> {
  let docDirs: string[];
  try {
    docDirs = await fs.readdir(historyRoot);
  } catch {
    return;
  }
  for (const d of docDirs) {
    if (!DOC_ID_SAFE_RE.test(d)) continue;
    await fs.rm(path.join(historyRoot, d), { recursive: true, force: true }).catch(() => {});
  }
}
