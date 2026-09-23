import { afterEach, describe, expect, it } from 'vitest';
import {
  parseRepoRef,
  compareVersions,
  validateManifest,
  checkInstallCollision,
  checkInstallAllowed,
  commitPendingInstall,
  discardPendingInstall,
  parseAllowlistResponse,
  fetchPluginDirectory,
  setAllowlistRelayUrlSupplier,
} from '../../apps/desktop/src/plugin-manager.js';

describe('parseRepoRef', () => {
  it('accepts owner/repo shorthand', () => {
    expect(parseRepoRef('smodi/cardmirror-ebb')).toEqual({ owner: 'smodi', repo: 'cardmirror-ebb' });
  });
  it('accepts full GitHub URLs, with .git and trailing paths', () => {
    expect(parseRepoRef('https://github.com/smodi/cardmirror-ebb')).toEqual({ owner: 'smodi', repo: 'cardmirror-ebb' });
    expect(parseRepoRef('https://github.com/smodi/cardmirror-ebb.git')).toEqual({ owner: 'smodi', repo: 'cardmirror-ebb' });
    expect(parseRepoRef('https://github.com/smodi/cardmirror-ebb/releases')).toEqual({ owner: 'smodi', repo: 'cardmirror-ebb' });
  });
  it('rejects everything else', () => {
    expect(parseRepoRef('https://gitlab.com/a/b')).toBeNull();
    expect(parseRepoRef('not a ref')).toBeNull();
    expect(parseRepoRef('')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders release triples', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });
  it('release beats its own prerelease; prereleases order numerically', () => {
    expect(compareVersions('0.1.0', '0.1.0-beta.17')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-beta.18', '0.1.0-beta.17')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-beta.2', '0.1.0-beta.10')).toBeLessThan(0);
  });
});

describe('validateManifest', () => {
  const good = {
    id: 'cardmirror-ebb',
    name: 'ebb Flow Integration',
    version: '0.1.0',
    apiVersion: 1,
  };
  it('accepts a minimal valid manifest', () => {
    expect(validateManifest(good)).toEqual({ ok: true, manifest: expect.objectContaining(good) });
  });
  it('rejects bad ids, missing fields, wrong apiVersion', () => {
    expect(validateManifest({ ...good, id: '../evil' }).ok).toBe(false);
    expect(validateManifest({ ...good, id: undefined }).ok).toBe(false);
    expect(validateManifest({ ...good, apiVersion: 99 }).ok).toBe(false);
    expect(validateManifest({ ...good, version: 7 }).ok).toBe(false);
  });
  it('rejects Windows reserved device ids', () => {
    expect(validateManifest({ ...good, id: 'con' }).ok).toBe(false);
    expect(validateManifest({ ...good, id: 'com1' }).ok).toBe(false);
  });
});

describe('checkInstallCollision', () => {
  const existing = { id: 'demo', name: 'Demo', version: '1.0.0', apiVersion: 1, repo: 'owner/demo' };
  it('allows a same-repo reinstall (the update path)', () => {
    expect(checkInstallCollision(existing, 'owner/demo')).toBeNull();
  });
  it('blocks a different repo claiming an installed id', () => {
    expect(checkInstallCollision(existing, 'evil/demo')).toContain('already owns the id');
  });
  it('allows a fresh id with no existing install', () => {
    expect(checkInstallCollision(undefined, 'owner/demo')).toBeNull();
  });
  it('blocks when the existing install has no stored repo', () => {
    expect(checkInstallCollision({ ...existing, repo: undefined }, 'owner/demo')).toContain('already owns the id');
  });
});

describe('checkInstallAllowed (curated allowlist)', () => {
  it('allows an allowlisted repo while locked', () => {
    expect(checkInstallAllowed('shreerammodi/ebb', false)).toBeNull();
    expect(checkInstallAllowed('BlueCheeseburger/policy-flow', false)).toBeNull();
  });
  it('is case-insensitive about the ref', () => {
    expect(checkInstallAllowed('ShreeramModi/Ebb', false)).toBeNull();
  });
  it('blocks a non-allowlisted repo while locked', () => {
    expect(checkInstallAllowed('somebody/some-plugin', false)).toMatch(/curated/);
  });
  it('allows any repo once community installs are unlocked', () => {
    expect(checkInstallAllowed('somebody/some-plugin', true)).toBeNull();
  });
});

describe('pending-install staging', () => {
  it('commit with an unknown/expired token fails without touching disk', async () => {
    const r = await commitPendingInstall('nope-never-issued');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/expired/i);
  });
  it('discard of an unknown token is a silent no-op', () => {
    expect(() => discardPendingInstall('nope')).not.toThrow();
  });
});

describe('parseAllowlistResponse (server allowlist shape)', () => {
  it('accepts a well-formed response, folding case', () => {
    const set = parseAllowlistResponse({
      schema: 1,
      repos: ['ShreeramModi/ebb', 'shreerammodi/cardmirror-ebb'],
    });
    expect(set).not.toBeNull();
    expect(set!.has('shreerammodi/ebb')).toBe(true);
    expect(set!.size).toBe(2);
  });
  it('drops entries that are not owner/repo shaped', () => {
    const set = parseAllowlistResponse({ repos: ['ok/repo', 'https://github.com/x/y', '', 42] });
    expect([...set!]).toEqual(['ok/repo']);
  });
  it('treats empty or malformed responses as failure, not block-everything', () => {
    // A server hiccup must fall back to cache/baked — never brick installs.
    expect(parseAllowlistResponse({ repos: [] })).toBeNull();
    expect(parseAllowlistResponse({ repos: 'nope' })).toBeNull();
    expect(parseAllowlistResponse(null)).toBeNull();
    expect(parseAllowlistResponse('[]')).toBeNull();
  });
});

describe('checkInstallAllowed with an explicit (server-fetched) list', () => {
  it('judges against the provided list instead of the baked one', () => {
    const server = new Set(['newauthor/new-plugin']);
    expect(checkInstallAllowed('newauthor/new-plugin', false, server)).toBeNull();
    // Revocation: a baked entry absent from the served list blocks.
    expect(checkInstallAllowed('shreerammodi/ebb', false, server)).toMatch(/curated/);
  });
});

describe('fetchPluginDirectory (browse picker data)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    setAllowlistRelayUrlSupplier(() => '');
  });

  function stubRelay(directoryBody: unknown, allowRepos: string[] = ['good/one']): void {
    setAllowlistRelayUrlSupplier(() => 'http://relay.test');
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      const body = u.endsWith('/plugin-allowlist')
        ? { schema: 1, repos: allowRepos }
        : directoryBody;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
  }

  it('returns entries folded to lowercase with sanitized metadata', async () => {
    stubRelay({
      schema: 1,
      plugins: [
        { repo: 'Good/One', name: '  Neat Plugin ', description: 'Does things.', version: '1.2.0' },
      ],
    });
    const res = await fetchPluginDirectory();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plugins).toEqual([
        {
          repo: 'good/one',
          name: 'Neat Plugin',
          description: 'Does things.',
          author: undefined,
          version: '1.2.0',
        },
      ]);
    }
  });

  it('drops repos the allowlist does not cover — Browse must never offer what install refuses', async () => {
    stubRelay({
      schema: 1,
      plugins: [{ repo: 'good/one' }, { repo: 'unlisted/elsewhere', name: 'Sneaky' }],
    });
    const res = await fetchPluginDirectory();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plugins.map((p) => p.repo)).toEqual(['good/one']);
  });

  it("keeps the fork's own plugins even when the relay's list omits them", async () => {
    stubRelay({
      schema: 1,
      plugins: [{ repo: 'good/one' }, { repo: 'BlueCheeseburger/policy-flow' }],
    });
    const res = await fetchPluginDirectory();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plugins.map((p) => p.repo)).toEqual(['good/one', 'bluecheeseburger/policy-flow']);
    }
  });

  it('drops malformed rows instead of failing the whole listing', async () => {
    stubRelay({
      schema: 1,
      plugins: [{ repo: 'good/one' }, { repo: 'not a slug' }, 42, null, { name: 'no repo' }],
    });
    const res = await fetchPluginDirectory();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plugins.map((p) => p.repo)).toEqual(['good/one']);
  });

  it('reports unreachable and malformed directories as errors', async () => {
    setAllowlistRelayUrlSupplier(() => 'http://relay.test');
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const offline = await fetchPluginDirectory();
    expect(offline.ok).toBe(false);

    stubRelay({ schema: 1, plugins: 'nope' });
    const malformed = await fetchPluginDirectory();
    expect(malformed.ok).toBe(false);
  });

  it('errors without a relay configured', async () => {
    setAllowlistRelayUrlSupplier(() => '');
    const res = await fetchPluginDirectory();
    expect(res.ok).toBe(false);
  });
});
