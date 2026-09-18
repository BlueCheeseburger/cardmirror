/**
 * File-index service CORE — the brain of the out-of-process file search.
 *
 * Owns everything the main process used to do for the command-palette
 * file search, and one thing the renderer used to do:
 *   - the persisted listing cache ({userData}/cmir-file-index.json —
 *     same file, same format as before),
 *   - recursive scans + background revalidation of search roots,
 *   - pruning roots that left settings (pruneIndexRoots),
 *   - SEARCH itself: ranked, exclusion- and format-filtered,
 *     pin-partitioned, windowed results,
 *   - and folder browsing derived on demand from those same indexed paths.
 *
 * Motivation (2026-07-30): the browser process paid for the index
 * (load, walk, persist) and every launch shipped the whole corpus over
 * IPC into the renderer (structured-cloning ~55k entries), which
 * stalled both processes during the seconds after boot — visible as a
 * window resize freezing on the stale frame. Moving index AND search
 * here means the corpus never crosses a process boundary again: the
 * renderer sends a query, a few KB of ranked rows come back.
 *
 * Ranking is the SAME code the renderer used — this module imports
 * `searchFiles` / `matchesAllTokens` etc. from src/editor/file-search.ts
 * (pure TS, no DOM), so palette semantics cannot drift.
 *
 * Pure Node (no `electron` import): unit-tested directly against temp
 * dirs; the utilityProcess entry (file-index-service.ts) is a thin
 * message shim over this. Excluded from the desktop tsc build (the
 * cross-tree import violates its rootDir) — esbuild bundles it, and the
 * root typecheck covers it via the test imports.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pruneIndexRoots } from './cmir-index-prune.js';
import {
  makeFileEntry,
  searchFiles,
  isPathExcluded,
  fileFormat,
  type FileEntry,
} from '../../../src/editor/file-search.js';
import type {
  FileBrowseParams,
  FileBrowseResult,
  FileIndexQueryParams,
  FileIndexQueryResult,
  FileIndexRow,
  LocateCurrentFileResult,
} from '../../../src/editor/file-index-protocol.js';
export type { FileIndexRow } from '../../../src/editor/file-index-protocol.js';

/** On-disk entry shape — unchanged from the main-process era so the
 *  existing cache file carries over. `size` is unused today but kept
 *  for a future content index (reparse only changed files). */
export interface StoredEntry {
  path: string;
  relPath: string;
  mtimeMs: number;
  size: number;
}

/** Backward-compatible name used by the existing core tests. */
export type FileIndexQuery = FileIndexQueryParams;

export interface FileIndexCore {
  /** Report the current roots: prune departed ones, ensure the rest are
   *  scanned (cold roots scan in the background; `onChanged` fires when
   *  their listing lands), revalidate the already-cached ones. */
  configure(roots: string[]): Promise<void>;
  query(q: FileIndexQuery): Promise<FileIndexQueryResult>;
  browse(q: FileBrowseParams): Promise<FileBrowseResult>;
  locateCurrentFile(args: {
    filePath: string;
    roots: string[];
    exclusions: string[];
  }): Promise<LocateCurrentFileResult>;
  /** mtimes for specific paths (the pin warm pass) — honors roots +
   *  exclusions so an excluded pin stays dormant. */
  entriesForPaths(args: {
    paths: string[];
    roots: string[];
    exclusions: string[];
  }): Promise<Array<{ path: string; mtimeMs: number }>>;
  /** Settle all in-flight scans/revalidations/writes (tests). */
  idle(): Promise<void>;
}

export function createFileIndexCore(opts: {
  dataDir: string;
  onChanged: (root: string) => void;
  /** Delay before a known root's revalidation WALK starts (default 3s).
   *  Configure fires on palette open — exactly when the user starts
   *  typing — and the walk's stat storm competes with those queries on
   *  this process's one thread; the delay lets the typing burst finish
   *  first. Cold-root scans are never delayed (no data without them).
   *  Tests pass 0. */
  revalidateDelayMs?: number;
}): FileIndexCore {
  const indexPath = path.join(opts.dataDir, 'cmir-file-index.json');
  const mem = new Map<string, StoredEntry[]>();
  /** Per-root search entries derived from `mem` (lowercase match fields
   *  precomputed once per listing, not per query). */
  const derived = new Map<string, FileEntry[]>();
  let loadPromise: Promise<void> | null = null;
  const revalidating = new Set<string>();
  const revalidateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const scanning = new Map<string, Promise<void>>();
  let writeTail: Promise<void> = Promise.resolve();

  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const text = await fsp.readFile(indexPath, 'utf8');
          const parsed = JSON.parse(text) as { roots?: Record<string, unknown> };
          if (parsed && parsed.roots && typeof parsed.roots === 'object') {
            for (const [root, entries] of Object.entries(parsed.roots)) {
              if (Array.isArray(entries)) setRoot(root, entries as StoredEntry[]);
            }
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('[file-index] failed to read index:', err);
          }
        }
      })();
    }
    return loadPromise;
  }

  function setRoot(root: string, entries: StoredEntry[]): void {
    mem.set(root, entries);
    derived.set(
      root,
      entries.map((e) => makeFileEntry(e.path, e.relPath, e.mtimeMs)),
    );
  }

  function persist(): Promise<void> {
    const snapshot = Object.fromEntries(mem);
    writeTail = writeTail.catch(() => {}).then(async () => {
      const tmpPath = `${indexPath}.tmp`;
      await fsp.writeFile(tmpPath, JSON.stringify({ version: 1, roots: snapshot }));
      await fsp.rename(tmpPath, indexPath);
    });
    return writeTail;
  }

  /** Walk `root` recursively for openable files (`.cmir` + `.docx`),
   *  recording mtime + size. (Moved verbatim from main.ts.) */
  async function scan(root: string): Promise<StoredEntry[]> {
    const out: StoredEntry[] = [];
    const isOpenable = (name: string): boolean => {
      // Skip Word's `~$…docx` owner/lock files — not real documents.
      if (name.startsWith('~$')) return false;
      const lower = name.toLowerCase();
      return lower.endsWith('.cmir') || lower.endsWith('.docx');
    };
    async function walk(cur: string): Promise<void> {
      let entries;
      try {
        entries = await fsp.readdir(cur, { withFileTypes: true });
      } catch {
        return; // unreadable dir — skip
      }
      for (const ent of entries) {
        const full = path.join(cur, ent.name);
        if (ent.isDirectory()) await walk(full);
        else if (ent.isFile() && isOpenable(ent.name)) {
          try {
            const st = await fsp.stat(full);
            out.push({
              path: full,
              relPath: path.relative(root, full),
              mtimeMs: st.mtimeMs,
              size: st.size,
            });
          } catch {
            /* vanished between readdir and stat — skip */
          }
        }
      }
    }
    await walk(root);
    return out;
  }

  /** Added / removed / mtime-changed since the cached listing? */
  function listingsDiffer(a: StoredEntry[], b: StoredEntry[]): boolean {
    if (a.length !== b.length) return true;
    const prev = new Map(a.map((e) => [e.path, e.mtimeMs]));
    return b.some((e) => prev.get(e.path) !== e.mtimeMs);
  }

  /** Coalesced, delayed revalidation kick (see revalidateDelayMs). */
  function scheduleRevalidate(root: string): void {
    if (revalidateTimers.has(root) || revalidating.has(root)) return;
    const timer = setTimeout(() => {
      revalidateTimers.delete(root);
      revalidate(root);
    }, opts.revalidateDelayMs ?? 3000);
    revalidateTimers.set(root, timer);
  }

  /** Cold root: scan now (background), publish + notify when it lands. */
  function ensureScanned(root: string): void {
    if (mem.has(root)) {
      scheduleRevalidate(root);
      return;
    }
    if (scanning.has(root)) return;
    const job = scan(root)
      .then(async (fresh) => {
        setRoot(root, fresh);
        await persist();
        opts.onChanged(root);
      })
      .catch((err) => console.warn('[file-index] scan failed:', root, err))
      .finally(() => scanning.delete(root));
    scanning.set(root, job);
  }

  function revalidate(root: string): void {
    if (revalidating.has(root)) return;
    revalidating.add(root);
    void scan(root)
      .then(async (fresh) => {
        const prev = mem.get(root);
        if (!prev || listingsDiffer(prev, fresh)) {
          setRoot(root, fresh);
          await persist();
          opts.onChanged(root);
        }
      })
      .catch(() => {})
      .finally(() => revalidating.delete(root));
  }

  /** Merged, de-duplicated (by path), exclusion- and format-filtered
   *  search entries for the requested roots. */
  function visibleEntries(roots: string[], exclusions: string[], formats: FileIndexQuery['formats']): FileEntry[] {
    const byPath = new Map<string, FileEntry>();
    for (const root of roots) {
      const list = derived.get(root);
      if (!list) continue;
      for (const f of list) {
        if (!byPath.has(f.path)) byPath.set(f.path, f);
      }
    }
    const out: FileEntry[] = [];
    for (const f of byPath.values()) {
      if (exclusions.length > 0 && isPathExcluded(f.path, exclusions)) continue;
      if (formats !== 'both' && fileFormat(f.path) !== formats) continue;
      out.push(f);
    }
    return out;
  }

  /** A native-path containment check. `path.relative` supplies the
   *  separator/case semantics of the OS running the index service. */
  function relativeInside(root: string, candidate: string): string | null {
    const rel = path.relative(root, candidate);
    if (rel === '') return '';
    if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) return null;
    return rel;
  }

  function validRelativeDirectory(relativeDirectory: string): string | null {
    if (relativeDirectory === '') return '';
    if (path.isAbsolute(relativeDirectory) || relativeDirectory.split(/[\\/]/).includes('..')) return null;
    const normalized = path.normalize(relativeDirectory);
    if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) return null;
    return normalized === '.' ? '' : normalized.replace(/[\\/]+$/, '');
  }

  function indexRow(f: FileEntry, pins: Set<string>): FileIndexRow {
    return {
      path: f.path,
      relPath: f.relPath,
      name: f.name,
      mtimeMs: f.mtimeMs,
      pinned: pins.has(f.path),
    };
  }

  return {
    async configure(roots: string[]): Promise<void> {
      await ensureLoaded();
      const dropped = pruneIndexRoots(mem, roots);
      pruneIndexRoots(derived, roots);
      if (dropped) await persist();
      for (const root of roots) ensureScanned(root);
    },

    async query(q: FileIndexQuery): Promise<FileIndexQueryResult> {
      await ensureLoaded();
      const entries = visibleEntries(q.roots, q.exclusions, q.formats);
      const ranked = searchFiles(entries, q.query, q.tiebreak);
      // ★ manual pins float above the rest (preserving rank inside each
      // partition) in `f`-mode only — the everything search keeps pure
      // rank order, matching the pre-service palette. Flags either way.
      const pins = new Set(q.pins);
      const ordered =
        !q.partitionPins || pins.size === 0
          ? ranked
          : [...ranked.filter((f) => pins.has(f.path)), ...ranked.filter((f) => !pins.has(f.path))];
      const rows = ordered.slice(0, Math.max(0, q.limit)).map((f) => ({
        ...indexRow(f, pins),
      }));
      return { rows, total: ordered.length };
    },

    async browse(q: FileBrowseParams): Promise<FileBrowseResult> {
      await ensureLoaded();
      const root = q.location.root;
      const relDir = validRelativeDirectory(q.location.relativeDirectory);
      if (!q.roots.includes(root) || relDir === null) return { rows: [], total: 0, valid: false };

      // A non-root directory is valid only while the index still has a file
      // beneath it. This lets the renderer walk upward when a branch vanishes.
      const indexedMembers = visibleEntries([root], q.exclusions, 'both');
      const directoryExists = relDir === '' || indexedMembers.some((f) => {
        const rel = path.relative(relDir, f.relPath);
        return rel !== '' && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
      });
      if (!directoryExists) return { rows: [], total: 0, valid: false };

      const entries = visibleEntries([root], q.exclusions, q.formats);
      const folders = new Map<string, { kind: 'folder'; name: string; relativeDirectory: string }>();
      const directFiles: FileEntry[] = [];
      for (const f of entries) {
        const remainder = path.relative(relDir, f.relPath);
        if (
          remainder === ''
          || path.isAbsolute(remainder)
          || remainder === '..'
          || remainder.startsWith(`..${path.sep}`)
        ) continue;
        const parts = remainder.split(path.sep);
        if (parts.length === 1) {
          directFiles.push(f);
          continue;
        }
        const name = parts[0]!;
        const relativeDirectory = relDir ? path.join(relDir, name) : name;
        folders.set(relativeDirectory, { kind: 'folder', name, relativeDirectory });
      }

      const folderRows = [...folders.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
      const rankedFiles = searchFiles(directFiles, '', q.tiebreak);
      const pins = new Set(q.pins);
      const orderedFiles = pins.size === 0
        ? rankedFiles
        : [...rankedFiles.filter((f) => pins.has(f.path)), ...rankedFiles.filter((f) => !pins.has(f.path))];
      const rows = [
        ...folderRows,
        ...orderedFiles.map((f) => ({ kind: 'file' as const, ...indexRow(f, pins) })),
      ];
      return { rows: rows.slice(0, Math.max(0, q.limit)), total: rows.length, valid: true };
    },

    async locateCurrentFile(args): Promise<LocateCurrentFileResult> {
      await ensureLoaded();
      const matches = args.roots
        .map((root) => ({ root, rel: relativeInside(root, args.filePath) }))
        .filter((m): m is { root: string; rel: string } => m.rel !== null)
        .sort((a, b) => b.root.length - a.root.length);
      const match = matches[0];
      if (!match) return { ok: false, reason: 'outside-roots' };
      if (isPathExcluded(args.filePath, args.exclusions)) return { ok: false, reason: 'excluded' };
      const parent = path.dirname(match.rel);
      return {
        ok: true,
        location: { root: match.root, relativeDirectory: parent === '.' ? '' : parent },
      };
    },

    async entriesForPaths(args): Promise<Array<{ path: string; mtimeMs: number }>> {
      await ensureLoaded();
      const wanted = new Set(args.paths);
      const out: Array<{ path: string; mtimeMs: number }> = [];
      for (const f of visibleEntries(args.roots, args.exclusions, 'both')) {
        if (wanted.has(f.path)) out.push({ path: f.path, mtimeMs: f.mtimeMs });
      }
      return out;
    },

    async idle(): Promise<void> {
      // Flush delayed revalidations first (tests must not wait out the
      // real-world delay), then settle: a scan can queue a persist and a
      // revalidate can start while we await.
      for (let i = 0; i < 50; i++) {
        for (const [root, timer] of [...revalidateTimers]) {
          clearTimeout(timer);
          revalidateTimers.delete(root);
          revalidate(root);
        }
        const jobs = [...scanning.values()];
        if (jobs.length === 0 && revalidating.size === 0 && revalidateTimers.size === 0) break;
        await Promise.allSettled(jobs);
        await new Promise((r) => setTimeout(r, 10));
      }
      await writeTail.catch(() => {});
    },
  };
}
