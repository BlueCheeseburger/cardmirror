/**
 * Every hook `enableMultiDocMode` accepts must actually be passed by
 * multi-pane-shell.ts.
 *
 * These hooks are the only way the shell overrides single-doc
 * behaviour, and every one is optional — so forgetting to pass one
 * doesn't fail the build, doesn't fail a type check, and doesn't throw
 * at runtime. It silently falls back to the single-doc path, which for
 * some of them (New Document) means spawning a whole window instead of
 * using the workspace you're standing in.
 *
 * That has now happened twice: `onNewDocWithPicker` was declared,
 * implemented and documented in 9a24d0d but never wired, so for four
 * days New in a three-pane workspace kept doing exactly the thing that
 * commit removed. (The home screen's `renderWorkspaces` died the same
 * way — implemented, never reachable.) A source-level check is crude,
 * but the shell can't be instantiated in jsdom, and the alternative is
 * noticing by hand.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
}

/** Keys of the object literal `enableMultiDocMode` declares. */
function declaredHooks(): string[] {
  const src = read('src/editor/index.ts');
  const start = src.indexOf('export function enableMultiDocMode(opts: {');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n}', start);
  const body = src.slice(start, end);
  return [...new Set([...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!))];
}

/** Keys multi-pane-shell.ts actually passes. */
function wiredHooks(): string[] {
  const src = read('src/editor/multi-pane-shell.ts');
  const start = src.indexOf('enableMultiDocMode({');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n  });', start);
  const body = src.slice(start, end);
  return [...new Set([...body.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]!))];
}

describe('enableMultiDocMode hooks', () => {
  it('declares a non-trivial set of hooks (the parse still finds them)', () => {
    // Guards the test itself: a refactor that moves either block would
    // otherwise make this file pass by finding nothing on both sides.
    expect(declaredHooks().length).toBeGreaterThan(20);
    expect(wiredHooks().length).toBeGreaterThan(20);
  });

  it('wires every declared hook', () => {
    const missing = declaredHooks().filter((h) => !wiredHooks().includes(h));
    expect(missing).toEqual([]);
  });

  it('passes nothing the options type does not declare', () => {
    const extra = wiredHooks().filter((h) => !declaredHooks().includes(h));
    expect(extra).toEqual([]);
  });

  it('routes the ribbon New command through the slot picker', () => {
    // The specific regression: New must reach `newDocWithPicker`, not
    // the spawn-a-blank-window fallback.
    expect(read('src/editor/multi-pane-shell.ts')).toContain(
      'onNewDocWithPicker: () => shell!.newDocWithPicker()',
    );
  });
});
