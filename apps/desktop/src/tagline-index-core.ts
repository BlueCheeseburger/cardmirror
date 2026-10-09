/**
 * Card-tagline index — the content layer under `q` (my cards).
 *
 * The file index lists files; this keeps, per file, the taglines of the cards
 * inside it, so the palette can search card taglines across every indexed file
 * without opening them. It lives in the same utility process as the file index
 * (the corpus never crosses a process boundary; a query returns a few KB of
 * ranked rows).
 *
 * Built lazily, in the background:
 *   - nothing is parsed until the first card search (or app launch) asks for it;
 *   - files are parsed one at a time, most recently modified first, yielding
 *     to the event loop between files so file search stays responsive;
 *   - each file's taglines are keyed by its mtime, so a later pass only
 *     re-parses files that changed (and drops files that disappeared);
 *   - the result persists in `{userData}/cmir-tagline-index.json`, so after the
 *     first build a restart is instant;
 *   - total size is capped (MAX_TAGLINES) so a very large corpus can't eat
 *     unbounded memory; once reached, older files are left out and the status
 *     says so.
 *
 * Pure Node (no `electron` import): unit-tested against temp dirs with a fake
 * parser. The real parser (`.docx` / `.cmir` → taglines) is injected.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  searchTaglines,
  type TaglineFile,
  type TaglineRecord,
  type TaglineRow,
} from '../../../src/editor/tagline-search.js';

/** A file the crawler may index — the visible slice of the file index. */
export interface TaglineSourceFile {
  path: string;
  relPath: string;
  name: string;
  mtimeMs: number;
}

export interface TaglineScope {
  roots: string[];
  exclusions: string[];
  formats: 'both' | 'cmir' | 'docx';
}

export interface TaglineStatus {
  /** Files with taglines indexed (in this scope). */
  indexed: number;
  /** Files in this scope. */
  files: number;
  /** A crawl is running. */
  running: boolean;
  /** The size cap was hit, so the oldest files are not included. */
  capped: boolean;
}

export interface TaglineQueryResult {
  rows: TaglineRow[];
  total: number;
  status: TaglineStatus;
}

export interface TaglineIndex {
  query(args: TaglineScope & { query: string; limit: number }): Promise<TaglineQueryResult>;
  /** The file listing changed (or the app started): bring an already-built
   *  index up to date. A no-op until the index has been wanted once (a search,
   *  or `start`). */
  refresh(roots?: string[]): Promise<void>;
  /** Begin (or retarget) the background build WITHOUT a query. Called at app
   *  launch so the index is ready by the time the first card search happens,
   *  instead of the first search paying for the whole crawl. */
  start(args: TaglineScope): Promise<void>;
  /** Wait for the running crawl and pending write to settle (tests). */
  idle(): Promise<void>;
}

/** Cap on stored taglines across all files. */
export const MAX_TAGLINES = 600_000;
/** Cap per file — a pasted-together mega file shouldn't crowd out the rest. */
const MAX_TAGS_PER_FILE = 5000;

interface Stored {
  m: number;
  t: string[];
  c: string[];
}

export function createTaglineIndex(opts: {
  dataDir: string;
  /** Visible files for a scope (the file index's own listing + filters). */
  listFiles(scope: TaglineScope): TaglineSourceFile[];
  /** Taglines of one file; throws if it can't be read or parsed. */
  parse(filePath: string): Promise<TaglineRecord>;
  /** Fired (throttled) when more files have been indexed. */
  onChanged(): void;
  maxTaglines?: number;
  /** Minimum gap between change notifications (default 750 ms; tests 0). */
  notifyGapMs?: number;
  /** Minimum gap between disk writes while crawling (default 20 s; tests 0). */
  persistGapMs?: number;
}): TaglineIndex {
  const indexPath = path.join(opts.dataDir, 'cmir-tagline-index.json');
  const cap = opts.maxTaglines ?? MAX_TAGLINES;
  const notifyGap = opts.notifyGapMs ?? 750;
  const persistGap = opts.persistGapMs ?? 20_000;

  const files = new Map<string, TaglineFile>();
  let total = 0; // taglines held
  let scope: TaglineScope | null = null; // the scope the crawl follows
  let wanted = false; // the index has been wanted (a card search, or app launch, now or in a past session)
  let capped = false;
  /** The last crawl finished against the current scope and nothing has
   *  changed since — queries then skip the (listing-wide) walk. */
  let fresh = false;
  let running: Promise<void> | null = null;
  let again = false;
  let loadPromise: Promise<void> | null = null;
  let lastNotify = 0;
  let lastPersist = 0;
  let writeTail: Promise<void> = Promise.resolve();

  function ensureLoaded(): Promise<void> {
    loadPromise ??= (async () => {
      try {
        const parsed = JSON.parse(await fsp.readFile(indexPath, 'utf8')) as {
          version?: number;
          scope?: TaglineScope;
          files?: Record<string, Stored>;
        };
        if (parsed.version === 1 && parsed.files) {
          for (const [p, s] of Object.entries(parsed.files)) {
            if (!Array.isArray(s.t) || !Array.isArray(s.c)) continue;
            files.set(p, {
              path: p,
              relPath: '',
              name: '',
              mtimeMs: s.m,
              record: { tags: s.t, cites: s.c },
            });
            total += s.t.length;
          }
          if (parsed.scope) {
            scope = parsed.scope;
            wanted = true;
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[tagline-index] failed to read index:', err);
        }
      }
    })();
    return loadPromise;
  }

  function persist(): Promise<void> {
    lastPersist = Date.now();
    const snapshot: Record<string, Stored> = {};
    for (const [p, f] of files) snapshot[p] = { m: f.mtimeMs, t: f.record.tags, c: f.record.cites };
    const body = JSON.stringify({ version: 1, scope, files: snapshot });
    writeTail = writeTail
      .catch(() => {})
      .then(async () => {
        const tmp = `${indexPath}.tmp`;
        await fsp.writeFile(tmp, body);
        await fsp.rename(tmp, indexPath);
      });
    return writeTail;
  }

  function notify(force = false): void {
    const now = Date.now();
    if (!force && now - lastNotify < notifyGap) return;
    lastNotify = now;
    opts.onChanged();
  }

  /** Fill in the display fields a persisted record doesn't carry. */
  function adopt(entry: TaglineSourceFile): TaglineFile | undefined {
    const f = files.get(entry.path);
    if (!f) return undefined;
    f.relPath = entry.relPath;
    f.name = entry.name;
    return f;
  }

  function sameScope(a: TaglineScope, b: TaglineScope): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  async function crawl(): Promise<void> {
    do {
      again = false;
      fresh = false;
      const target = scope;
      if (!target) return;
      const listing = opts.listFiles(target);
      // Newest first: recent files are the ones people reach for.
      const order = [...listing].sort((a, b) => b.mtimeMs - a.mtimeMs);
      // Drop files that left the listing (deleted, excluded, root removed).
      const present = new Set(listing.map((e) => e.path));
      for (const p of [...files.keys()]) {
        if (!present.has(p)) {
          total -= files.get(p)!.record.tags.length;
          files.delete(p);
        }
      }
      capped = false;
      for (const entry of order) {
        if (scope && !sameScope(scope, target)) {
          again = true; // scope changed mid-crawl: start over on the new one
          break;
        }
        const have = files.get(entry.path);
        if (have && have.mtimeMs === entry.mtimeMs) {
          have.relPath = entry.relPath;
          have.name = entry.name;
          continue;
        }
        if (total >= cap) {
          capped = true;
          break;
        }
        let record: TaglineRecord;
        try {
          record = await opts.parse(entry.path);
        } catch {
          record = { tags: [], cites: [] }; // unreadable: don't retry until it changes
        }
        if (record.tags.length > MAX_TAGS_PER_FILE) {
          record = {
            tags: record.tags.slice(0, MAX_TAGS_PER_FILE),
            cites: record.cites.slice(0, MAX_TAGS_PER_FILE),
          };
        }
        if (have) total -= have.record.tags.length;
        files.set(entry.path, {
          path: entry.path,
          relPath: entry.relPath,
          name: entry.name,
          mtimeMs: entry.mtimeMs,
          record,
        });
        total += record.tags.length;
        notify();
        if (Date.now() - lastPersist >= persistGap) void persist();
        // Let queries and other messages through between files.
        await new Promise((r) => setImmediate(r));
      }
    } while (again);
    fresh = true;
    await persist();
    notify(true);
  }

  function kick(): void {
    if (!wanted || !scope) return;
    if (running) {
      again = true;
      return;
    }
    running = crawl()
      .catch((err) => console.warn('[tagline-index] crawl failed:', err))
      .finally(() => {
        running = null;
      });
  }

  function statusFor(s: TaglineScope): TaglineStatus {
    const listing = opts.listFiles(s);
    let indexed = 0;
    for (const e of listing) if (files.get(e.path)?.mtimeMs === e.mtimeMs) indexed++;
    return { indexed, files: listing.length, running: running !== null, capped };
  }

  return {
    async query(args): Promise<TaglineQueryResult> {
      await ensureLoaded();
      const next: TaglineScope = {
        roots: args.roots,
        exclusions: args.exclusions,
        formats: args.formats,
      };
      const changed = !scope || !sameScope(scope, next);
      scope = next;
      wanted = true;
      if (changed) fresh = false;
      if (!fresh) kick();
      const listing = opts.listFiles(next);
      const visible: TaglineFile[] = [];
      for (const e of listing) {
        const f = adopt(e);
        if (f) visible.push(f);
      }
      const { rows, total: matches } = searchTaglines(visible, args.query, args.limit);
      return { rows, total: matches, status: statusFor(next) };
    },

    async start(args): Promise<void> {
      await ensureLoaded();
      const next: TaglineScope = {
        roots: args.roots,
        exclusions: args.exclusions,
        formats: args.formats,
      };
      if (!next.roots.length) return;
      const changed = !scope || !sameScope(scope, next);
      scope = next;
      wanted = true;
      if (changed) fresh = false;
      if (!fresh) kick();
    },

    async refresh(roots?: string[]): Promise<void> {
      await ensureLoaded();
      if (!wanted || !scope) return;
      // Keep the saved filters; follow the current roots when given.
      if (roots) scope = { ...scope, roots };
      fresh = false;
      kick();
    },

    async idle(): Promise<void> {
      for (let i = 0; i < 200 && running; i++) await running.catch(() => {});
      await writeTail.catch(() => {});
    },
  };
}
