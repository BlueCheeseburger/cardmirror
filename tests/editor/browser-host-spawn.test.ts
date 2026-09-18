// @vitest-environment jsdom
/**
 * BrowserHost's spawn-window handoff — the `?spawn=` URL marker a newly
 * opened window reads back to know it was SPAWNED (by "New document" /
 * "Open in new window" / etc.) rather than independently opened as a
 * fresh tab, and the `blank` payload flag "New document → New window"
 * now sends instead of a bare `null`.
 *
 * Root cause of the two bugs this locks in (both field reports,
 * 2026-09-18): the `?spawn=` marker used to appear only when there was
 * an actual doc payload to hand off through IndexedDB — a payload-less
 * spawn (e.g. blank "New document") got no marker at all, so the new
 * window's `isFirstWindow()` read `true` (indistinguishable from an
 * actual fresh first launch). And even once marked, a bare `null`
 * payload told the new window nothing beyond "you weren't handed a
 * doc" — which single-pane read as "mount the starter" but multi-pane,
 * which has no such fallback, read as "blank launch → show the home
 * screen", same as a genuine first launch. `blank: true` makes "spawn
 * an actual new document" unambiguous instead of an absence to infer.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { blankSpawnPayload } from '../../src/editor/host/types.js';

afterEach(() => {
  vi.resetModules();
  history.pushState(null, '', '/');
});

describe('BrowserHost.spawnWindow', () => {
  it('mints a ?spawn= marker in the opened URL even for a null (blank) payload', async () => {
    const { BrowserHost } = await import('../../src/editor/host/browser-host.js');
    const host = new BrowserHost();
    let openedHref: string | null = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        openedHref = this.href;
      });
    try {
      await host.spawnWindow(null);
    } finally {
      clickSpy.mockRestore();
    }
    expect(openedHref).toMatch(/\?spawn=[0-9a-f-]+$/i);
  });
});

describe('BrowserHost.isFirstWindow', () => {
  it('is false for a window opened with a spawn marker, payload or not', async () => {
    history.pushState(null, '', '/?spawn=11111111-1111-1111-1111-111111111111');
    vi.resetModules();
    const { BrowserHost } = await import('../../src/editor/host/browser-host.js');
    const host = new BrowserHost();
    expect(await host.isFirstWindow()).toBe(false);
  });

  it('is true for a window with no spawn marker (an independently opened tab)', async () => {
    history.pushState(null, '', '/');
    vi.resetModules();
    const { BrowserHost } = await import('../../src/editor/host/browser-host.js');
    const host = new BrowserHost();
    expect(await host.isFirstWindow()).toBe(true);
  });

  it('getInitialDoc resolves null for a spawn marker with no stored payload — the blank-spawn case', async () => {
    history.pushState(null, '', '/?spawn=22222222-2222-2222-2222-222222222222');
    vi.resetModules();
    const { BrowserHost } = await import('../../src/editor/host/browser-host.js');
    const host = new BrowserHost();
    expect(await host.isFirstWindow()).toBe(false);
    await expect(host.getInitialDoc()).resolves.toBeNull();
  });
});

describe('blankSpawnPayload', () => {
  it('is a fully-populated placeholder payload carrying blank: true', () => {
    const p = blankSpawnPayload();
    expect(p).toMatchObject({ blank: true, filename: '', handle: null, format: null, uid: null });
    expect(p.bytes).toHaveLength(0);
  });

  it('round-trips through spawnWindow → getInitialDoc as the new window would see it', async () => {
    const { BrowserHost } = await import('../../src/editor/host/browser-host.js');
    const spawningHost = new BrowserHost();
    let openedHref: string | null = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        openedHref = this.href;
      });
    try {
      await spawningHost.spawnWindow(blankSpawnPayload());
    } finally {
      clickSpy.mockRestore();
    }
    expect(openedHref).not.toBeNull();
    const spawnUrl = new URL(openedHref!);

    // Simulate the NEW window: same origin/path + the marker it was
    // opened with, in a fresh module instance (SPAWN_ID is read once at
    // module load, matching how a real new window boots).
    history.pushState(null, '', `${spawnUrl.pathname}${spawnUrl.search}`);
    vi.resetModules();
    const { BrowserHost: NewWindowHost } = await import('../../src/editor/host/browser-host.js');
    const newWindowHost = new NewWindowHost();
    expect(await newWindowHost.isFirstWindow()).toBe(false);
    const received = await newWindowHost.getInitialDoc();
    expect(received).toMatchObject({ blank: true });
  });
});
