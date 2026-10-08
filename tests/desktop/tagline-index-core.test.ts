/**
 * Tagline index core: the background build under `f c`. Real temp dirs for
 * persistence; a fake parser and listing so the crawl order, incremental
 * refresh, pruning, cap and scope handling can be checked directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createTaglineIndex,
  type TaglineScope,
  type TaglineSourceFile,
} from '../../apps/desktop/src/tagline-index-core.js';
import type { TaglineRecord } from '../../src/editor/tagline-search.js';

let dataDir: string;
let listing: TaglineSourceFile[];
let docs: Record<string, string[]>;
let parsed: string[];
let changes: number;
const scope: TaglineScope = { roots: ['/r'], exclusions: [], formats: 'both' };

const file = (name: string, mtimeMs: number): TaglineSourceFile => ({
  path: `/r/${name}.cmir`,
  relPath: `${name}.cmir`,
  name,
  mtimeMs,
});

function make(over: { maxTaglines?: number; parse?: (p: string) => Promise<TaglineRecord> } = {}) {
  return createTaglineIndex({
    dataDir,
    listFiles: (s) =>
      listing.filter((f) => s.exclusions.every((x) => !f.path.startsWith(x))),
    parse:
      over.parse ??
      (async (p) => {
        parsed.push(p);
        const tags = docs[p];
        if (!tags) throw new Error('unreadable');
        return { tags, cites: tags.map(() => '') };
      }),
    onChanged: () => {
      changes++;
    },
    notifyGapMs: 0,
    persistGapMs: 0,
    ...(over.maxTaglines ? { maxTaglines: over.maxTaglines } : {}),
  });
}

const ask = (idx: ReturnType<typeof make>, query: string, s: TaglineScope = scope) =>
  idx.query({ ...s, query, limit: 50 });

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tix-'));
  listing = [file('Old', 1), file('Mid', 5), file('New', 9)];
  docs = {
    '/r/Old.cmir': ['Heg decline causes war'],
    '/r/Mid.cmir': ['Warming causes war', 'Solvency is certain'],
    '/r/New.cmir': ['Heg is resilient'],
  };
  parsed = [];
  changes = 0;
});

describe('tagline index core', () => {
  it('parses nothing until the first search, then builds newest file first', async () => {
    const idx = make();
    await idx.refresh(['/r']);
    expect(parsed).toEqual([]);
    await ask(idx, 'heg');
    await idx.idle();
    expect(parsed).toEqual(['/r/New.cmir', '/r/Mid.cmir', '/r/Old.cmir']);
  });

  it('answers with what is indexed so far, then everything once the build finishes', async () => {
    const idx = make();
    const first = await ask(idx, 'war');
    expect(first.status.files).toBe(3);
    await idx.idle();
    const done = await ask(idx, 'war');
    expect(done.rows.map((r) => r.text).sort()).toEqual(['Heg decline causes war', 'Warming causes war']);
    expect(done.status).toMatchObject({ indexed: 3, files: 3, running: false, capped: false });
    expect(changes).toBeGreaterThan(0);
  });

  it('re-parses only files whose mtime changed, and drops deleted files', async () => {
    const idx = make();
    await ask(idx, 'x');
    await idx.idle();
    parsed = [];
    docs['/r/Mid.cmir'] = ['Warming is slow'];
    listing = [file('Old', 1), file('Mid', 6)]; // Mid edited, New deleted
    await idx.refresh();
    await idx.idle();
    expect(parsed).toEqual(['/r/Mid.cmir']);
    const r = await ask(idx, 'heg is resilient');
    expect(r.rows).toEqual([]); // New is gone
    expect((await ask(idx, 'slow')).rows[0]!.text).toBe('Warming is slow');
  });

  it('survives a restart: the persisted index answers without re-parsing', async () => {
    const a = make();
    await ask(a, 'x');
    await a.idle();
    parsed = [];
    const b = make();
    const r = await ask(b, 'resilient');
    await b.idle();
    expect(r.rows.map((x) => x.text)).toEqual(['Heg is resilient']);
    expect(parsed).toEqual([]);
  });

  it('keeps an unreadable file as empty instead of retrying it every pass', async () => {
    delete docs['/r/Old.cmir'];
    const idx = make();
    await ask(idx, 'x');
    await idx.idle();
    parsed = [];
    await idx.refresh();
    await idx.idle();
    expect(parsed).toEqual([]);
    expect((await ask(idx, 'x')).status.indexed).toBe(3);
  });

  it('stops at the size cap, leaving the oldest files out, and says so', async () => {
    const idx = make({ maxTaglines: 2 });
    await ask(idx, 'x');
    await idx.idle();
    const r = await ask(idx, 'war');
    expect(r.status.capped).toBe(true);
    // New (1) + Mid (2) reach the cap; Old is left out.
    expect(r.rows.map((x) => x.text)).toEqual(['Warming causes war']);
  });

  it('follows exclusions from the scope it is asked about', async () => {
    const idx = make();
    await ask(idx, 'x');
    await idx.idle();
    const r = await ask(idx, 'heg', { ...scope, exclusions: ['/r/New'] });
    expect(r.rows.map((x) => x.text)).toEqual(['Heg decline causes war']);
    expect(r.status.files).toBe(2);
  });
});
