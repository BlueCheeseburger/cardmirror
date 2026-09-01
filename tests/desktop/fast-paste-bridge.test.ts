// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  sentToRenderer,
  ipcListeners,
  resetElectronStub,
  setMockFocusedWindow,
  setMockAllWindows,
  makeMockWindow,
  emitAppEvent,
} from './_electron-stub.js';
import * as bridge from '../../apps/desktop/src/fast-paste-bridge.js';

const tmpRoot = path.join(os.tmpdir(), `cardmirror-bridge-test-${process.pid}`);

async function fetchJson(opts: {
  method: 'GET' | 'POST';
  path: string;
  port: number;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** X-App-Id for the consent gate. Defaults to the suite's pre-allowed
   *  'testapp' so route-behavior tests aren't about consent; pass null
   *  to send an unidentified (legacy-shaped) request. */
  appId?: string | null;
}): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const appId = opts.appId === undefined ? 'testapp' : opts.appId;
  if (appId !== null) headers['x-app-id'] = appId;
  // No keep-alive: undici's global pool can hand a later test a socket
  // the previous test's server.close() already destroyed (Node ≥19
  // closes idle connections), which surfaces as a load-sensitive
  // "TypeError: fetch failed". Each request gets a fresh socket; this
  // also lets afterEach's close() resolve without idle-socket waits.
  headers['connection'] ??= 'close';
  if (opts.token) headers['x-fdp-token'] = opts.token;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const doFetch = async (): Promise<{ status: number; json: any }> => {
    const res = await fetch(`http://127.0.0.1:${opts.port}${opts.path}`, {
      method: opts.method,
      headers,
      body,
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* tolerate */ }
    return { status: res.status, json };
  };
  try {
    return await doFetch();
  } catch {
    // One retry on connect-level failure only (HTTP error statuses
    // return normally above and still hit the assertions). A loopback
    // server this test just started gets one second chance under
    // parallel-suite load; a real bridge bug fails the retry too.
    await new Promise((r) => setTimeout(r, 50));
    return doFetch();
  }
}


/** Wait until the bridge has forwarded to the renderer — the fixed
 *  20ms sleeps this replaces flaked on loaded CI runners (run
 *  33458582069, 2026-09-01): the HTTP round-trip + dispatch can take
 *  longer than any constant. Polls fast, fails loud at 2s. */
async function untilForwarded(count = 1): Promise<void> {
  const deadline = Date.now() + 2000;
  while (sentToRenderer.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`renderer never received forward #${count} (got ${sentToRenderer.length})`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

function fireRendererAck(ack: any): void {
  const listeners = ipcListeners.get('external:insert-result') ?? [];
  for (const l of listeners) l(null, ack);
}

/** Push a consent mirror to the gate over the real sync IPC. */
function fireConsentSync(state: { policy: string; apps: Record<string, string> }): void {
  const listeners = ipcListeners.get('host:sync-external-consent') ?? [];
  for (const l of listeners) l(null, state);
}

function fireConsentPromptResult(result: { requestId: string; outcome: string }): void {
  const listeners = ipcListeners.get('external:consent-prompt-result') ?? [];
  for (const l of listeners) l(null, result);
}

describe('fast-paste-bridge', () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = path.join(tmpRoot, `t-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(userDataDir, { recursive: true });
    resetElectronStub(userDataDir);
    await bridge.startFastPasteBridge();
    // Pre-allow the suite's default app id so route-behavior tests run
    // with consent out of the way; the consent block below manages its
    // own state.
    bridge.resetExternalConsentForTests();
    bridge.resetFocusTrackingForTests();
    fireConsentSync({ policy: 'ask', apps: { testapp: 'allow' } });
  });

  afterEach(async () => {
    await bridge.stopFastPasteBridge();
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('writes discovery file with port + token + appVersion on start', async () => {
    const ep = bridge.getRunningEndpoint();
    expect(ep).not.toBeNull();
    const data = JSON.parse(
      await fs.readFile(path.join(userDataDir, 'fast-paste-bridge.json'), 'utf-8'),
    );
    expect(data).toMatchObject({
      app: 'cardmirror',
      schema: 2,
      appVersion: 'TEST-1.2.3',
      port: ep!.port,
      token: ep!.token,
    });
    expect(typeof data.pid).toBe('number');
  });

  it('GET /ping with valid token returns full shape', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({ method: 'GET', path: '/ping', port: ep.port, token: ep.token });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      ok: true,
      app: 'cardmirror',
      appVersion: 'TEST-1.2.3',
      schema: 2,
      hasActiveDoc: true,
    });
  });

  it('GET /ping with no token → 403', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({ method: 'GET', path: '/ping', port: ep.port });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('GET /ping with wrong token → 403', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({ method: 'GET', path: '/ping', port: ep.port, token: 'wrong' });
    expect(r.status).toBe(403);
  });

  it('rejects requests carrying an Origin header (DNS-rebinding guard)', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'GET',
      path: '/ping',
      port: ep.port,
      token: ep.token,
      headers: { origin: 'http://evil.example.com' },
    });
    expect(r.status).toBe(403);
  });

  it('rejects requests carrying a Referer header', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'GET',
      path: '/ping',
      port: ep.port,
      token: ep.token,
      headers: { referer: 'http://evil.example.com/page' },
    });
    expect(r.status).toBe(403);
  });

  it('POST /insert dispatches to renderer and resolves with docTitle on ok ack', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST',
      path: '/insert',
      port: ep.port,
      token: ep.token,
      body: { text: 'hello', role: 'card', newParagraph: true },
    });
    await untilForwarded();
    expect(sentToRenderer).toHaveLength(1);
    const sent = sentToRenderer[0]!;
    expect(sent.channel).toBe('external:insert-text');
    expect(sent.payload).toMatchObject({ text: 'hello', role: 'card', newParagraph: true });
    expect(typeof sent.payload.requestId).toBe('string');
    fireRendererAck({ requestId: sent.payload.requestId, ok: true, docTitle: 'mydoc.cmir' });
    const r = await inserted;
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, inserted: true, docTitle: 'mydoc.cmir' });
  });

  it('POST /insert forwards a valid html payload to the renderer', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST',
      path: '/insert',
      port: ep.port,
      token: ep.token,
      body: {
        text: 'fallback text',
        role: 'card',
        newParagraph: true,
        html: '<p>rich <strong>content</strong></p>',
      },
    });
    await untilForwarded();
    const sent = sentToRenderer[0]!;
    // Both travel: html for a rich-aware renderer, text as the fallback
    // an older renderer (or unusable html) renders.
    expect(sent.payload).toMatchObject({
      text: 'fallback text',
      html: '<p>rich <strong>content</strong></p>',
    });
    fireRendererAck({ requestId: sent.payload.requestId, ok: true });
    await inserted;
  });

  it('POST /insert drops an off-shape or oversized html field (payload still delivers)', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST',
      path: '/insert',
      port: ep.port,
      token: ep.token,
      body: { text: 'plain', newParagraph: true, html: 12345 },
    });
    await untilForwarded();
    const sent = sentToRenderer[0]!;
    expect(sent.payload.text).toBe('plain');
    expect('html' in sent.payload).toBe(false);
    fireRendererAck({ requestId: sent.payload.requestId, ok: true });
    await inserted;
  });

  it('POST /insert: no-target-doc ack → 200 ok:false', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    await untilForwarded();
    fireRendererAck({ requestId: sentToRenderer[0]!.payload.requestId, ok: false, error: 'no-target-doc' });
    const r = await inserted;
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: false, error: 'no-target-doc' });
  });

  it('POST /insert: doc-readonly ack → 200 ok:false', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    await untilForwarded();
    fireRendererAck({ requestId: sentToRenderer[0]!.payload.requestId, ok: false, error: 'doc-readonly' });
    const r = await inserted;
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: false, error: 'doc-readonly' });
  });

  it('POST /insert: internal ack → 500', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    await untilForwarded();
    fireRendererAck({ requestId: sentToRenderer[0]!.payload.requestId, ok: false, error: 'internal' });
    const r = await inserted;
    expect(r.status).toBe(500);
  });

  it('POST /insert with non-string text → 400 bad-request', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { role: 'card', newParagraph: true },
    });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ ok: false, error: 'bad-request' });
  });

  it('POST /insert with malformed JSON → 400', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const res = await fetch(`http://127.0.0.1:${ep.port}/insert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fdp-token': ep.token },
      body: '{ broken',
    });
    expect(res.status).toBe(400);
  });

  it('unknown route → 404', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({ method: 'GET', path: '/banana', port: ep.port, token: ep.token });
    expect(r.status).toBe(404);
  });

  it('unknown role degrades to "card" (per §10)', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'X', role: 'mystery', newParagraph: true },
    });
    await untilForwarded();
    expect(sentToRenderer[0]!.payload.role).toBe('card');
    fireRendererAck({ requestId: sentToRenderer[0]!.payload.requestId, ok: true });
    await inserted;
  });

  it.each(['pocket', 'hat', 'block', 'tag', 'analytic', 'body'])(
    'heading role "%s" reaches the renderer unflattened',
    async (role) => {
      const ep = bridge.getRunningEndpoint()!;
      const inserted = fetchJson({
        method: 'POST', path: '/insert', port: ep.port, token: ep.token,
        body: { text: 'X', role, newParagraph: true },
      });
      await untilForwarded();
      expect(sentToRenderer[0]!.payload.role).toBe(role);
      fireRendererAck({ requestId: sentToRenderer[0]!.payload.requestId, ok: true });
      await inserted;
    },
  );

  it('no focused window and no focus history → no-target-doc, no round-trip', async () => {
    setMockFocusedWindow(null);
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: false, error: 'no-target-doc' });
    expect(sentToRenderer).toHaveLength(0);
  });

  it('background app → insert targets the most recently focused doc window', async () => {
    // ebb's send style: it POSTs while ebb itself holds OS focus, so
    // getFocusedWindow() is null — the insert must land in the window
    // the user most recently worked in, never an arbitrary one. (FDP
    // never reaches this path: it activates its picked window first.)
    const docWin = makeMockWindow();
    emitAppEvent('browser-window-focus', docWin);
    // A later timer-popout focus must NOT steal the target.
    emitAppEvent('browser-window-focus', makeMockWindow({ url: 'http://localhost/timer.html' }));
    setMockFocusedWindow(null);
    setMockAllWindows([docWin]);
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'from background', role: 'card', newParagraph: true },
    });
    await untilForwarded();
    expect(sentToRenderer).toHaveLength(1);
    expect(sentToRenderer[0]!.channel).toBe('external:insert-text');
    fireRendererAck({ requestId: sentToRenderer[0]!.payload.requestId, ok: true });
    expect((await inserted).json.ok).toBe(true);
  });

  it('stop deletes the discovery file', async () => {
    const file = path.join(userDataDir, 'fast-paste-bridge.json');
    await fs.access(file);
    await bridge.stopFastPasteBridge();
    await expect(fs.access(file)).rejects.toBeTruthy();
    // Restart so afterEach can stop a server cleanly.
    await bridge.startFastPasteBridge();
  });
  describe('POST /jump', () => {
    it('rejects a missing token', async () => {
      const ep = bridge.getRunningEndpoint()!;
      const r = await fetchJson({
        method: 'POST', path: '/jump', port: ep.port,
        body: { source: 'x' },
      });
      expect(r.status).toBe(403);
    });

    it('accepts the token in X-Bridge-Token', async () => {
      const ep = bridge.getRunningEndpoint()!;
      const r = await fetchJson({
        method: 'GET', path: '/ping', port: ep.port,
        headers: { 'x-bridge-token': ep.token },
      });
      expect(r.status).toBe(200);
      expect((r.json as { schema: number }).schema).toBe(2);
    });

    it('400s on a body without a source string', async () => {
      const ep = bridge.getRunningEndpoint()!;
      const r = await fetchJson({
        method: 'POST', path: '/jump', port: ep.port, token: ep.token,
        body: {},
      });
      expect(r.status).toBe(400);
    });

    it('reports doc-not-open with the docTitle when no window matches', async () => {
      // The stub's default window would swallow the jump broadcast
      // and run out the ack timeout; clear it so getAllWindows()
      // returns [] and the no-window path resolves immediately.
      setMockFocusedWindow(null);
      const ep = bridge.getRunningEndpoint()!;
      const source =
        'cmsrc1.' +
        Buffer.from(JSON.stringify({ docId: 'd', docTitle: 'AT Cap K.docx' })).toString('base64url');
      const r = await fetchJson({
        method: 'POST', path: '/jump', port: ep.port, token: ep.token,
        body: { source },
      });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: false, error: 'doc-not-open', docTitle: 'AT Cap K.docx' });
    });

    it('400s a source without the cmsrc1 prefix, with no broadcast', async () => {
      const ep = bridge.getRunningEndpoint()!;
      const source =
        'x.' + Buffer.from(JSON.stringify({ docTitle: 'forged' })).toString('base64url');
      const r = await fetchJson({
        method: 'POST', path: '/jump', port: ep.port, token: ep.token,
        body: { source },
      });
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ ok: false, error: 'bad-request' });
      expect(r.json.docTitle).toBeUndefined();
      // The bad prefix short-circuits before any window is asked to jump.
      expect(sentToRenderer.some((s) => s.channel === 'external:jump')).toBe(false);
    });

    it('answers even when a window is destroyed mid-broadcast', async () => {
      // Only window in the broadcast throws on send (render process gone);
      // the dispatch guard must resolve not-mine instead of rejecting and
      // hanging the /jump route.
      setMockAllWindows([makeMockWindow({ sendThrows: true })]);
      const ep = bridge.getRunningEndpoint()!;
      const source =
        'cmsrc1.' +
        Buffer.from(JSON.stringify({ docId: 'd', docTitle: 'Gone.docx' })).toString('base64url');
      const r = await fetchJson({
        method: 'POST', path: '/jump', port: ep.port, token: ep.token,
        body: { source },
      });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: false, error: 'doc-not-open', docTitle: 'Gone.docx' });
    });

    it('restores a minimized window that acks ok', async () => {
      const win = makeMockWindow({ minimized: true });
      setMockAllWindows([win]);
      const ep = bridge.getRunningEndpoint()!;
      const source =
        'cmsrc1.' +
        Buffer.from(JSON.stringify({ docId: 'd', docTitle: 'Min.docx' })).toString('base64url');
      const jumped = fetchJson({
        method: 'POST', path: '/jump', port: ep.port, token: ep.token,
        body: { source },
      });
      await untilForwarded();
      const sent = sentToRenderer.find((s) => s.channel === 'external:jump')!;
      const listeners = ipcListeners.get('external:jump-result') ?? [];
      for (const l of listeners) l(null, { requestId: sent.payload.requestId, ok: true });
      const r = await jumped;
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true });
      expect(win.__restored).toBe(true);
    });
  });
});

describe('external-app consent (identity gate)', () => {
  const sent = (channel: string) => sentToRenderer.filter((s) => s.channel === channel);
  let consentDataDir: string;

  beforeEach(async () => {
    consentDataDir = path.join(tmpRoot, `c-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(consentDataDir, { recursive: true });
    resetElectronStub(consentDataDir);
    await bridge.startFastPasteBridge();
    bridge.resetExternalConsentForTests();
    bridge.resetFocusTrackingForTests();
    fireConsentSync({ policy: 'ask', apps: { testapp: 'allow' } });
  });

  afterEach(async () => {
    await bridge.stopFastPasteBridge();
    await fs.rm(consentDataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('unidentified insert → rejected with guidance + a renderer note, rate-limited', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token, appId: null,
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(false);
    expect(r.json.error).toBe('unidentified');
    expect(r.json.message).toContain('X-App-Id');
    expect(sent('external:insert-text')).toHaveLength(0);
    expect(sent('external:consent-note')).toEqual([
      expect.objectContaining({ payload: { kind: 'unidentified' } }),
    ]);
    // Second knock inside the rate-limit window: rejected again, no new note.
    await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token, appId: null,
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    expect(sent('external:consent-note')).toHaveLength(1);
  });

  it("policy 'open': an anonymous legacy sender inserts as before the gate", async () => {
    fireConsentSync({ policy: 'open', apps: {} });
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token, appId: null,
      body: { text: 'legacy hello', role: 'card', newParagraph: true },
    });
    await untilForwarded();
    const inserts = sent('external:insert-text');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload.text).toBe('legacy hello');
    fireRendererAck({ requestId: inserts[0]!.payload.requestId, ok: true, docTitle: 'doc.cmir' });
    const r = await inserted;
    expect(r.json).toEqual({ ok: true, inserted: true, docTitle: 'doc.cmir' });
    expect(sent('external:consent-note')).toHaveLength(0); // no toast, no prompt
  });

  it('a malformed X-App-Id is unidentified, not a fresh identity', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token, appId: 'NOT VALID!',
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    expect(r.json.error).toBe('unidentified');
  });

  it('master toggle off → inserts-disabled on both routes', async () => {
    fireConsentSync({ policy: 'off', apps: { testapp: 'allow' } });
    const ep = bridge.getRunningEndpoint()!;
    const insert = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    expect(insert.json).toEqual({ ok: false, error: 'inserts-disabled' });
    const jump = await fetchJson({
      method: 'POST', path: '/jump', port: ep.port, token: ep.token,
      body: { source: 'cmsrc1.abc' },
    });
    expect(jump.json).toEqual({ ok: false, error: 'inserts-disabled' });
    expect(sent('external:insert-text')).toHaveLength(0);
  });

  it('a denied app → not-allowed on both routes', async () => {
    fireConsentSync({ policy: 'ask', apps: { testapp: 'deny' } });
    const ep = bridge.getRunningEndpoint()!;
    const insert = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    expect(insert.json).toEqual({ ok: false, error: 'not-allowed' });
    const jump = await fetchJson({
      method: 'POST', path: '/jump', port: ep.port, token: ep.token,
      body: { source: 'cmsrc1.abc' },
    });
    expect(jump.json).toEqual({ ok: false, error: 'not-allowed' });
  });

  it('first contact queues, prompts, and Allow applies the held insert', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token, appId: 'newapp',
      body: { text: 'held text', role: 'card', newParagraph: true },
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, inserted: false, pending: 'consent' });
    expect(sent('external:insert-text')).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const prompts = sent('external:consent-prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.payload.appId).toBe('newapp');

    fireConsentPromptResult({ requestId: prompts[0]!.payload.requestId, outcome: 'allow-always' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const inserts = sent('external:insert-text');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload.text).toBe('held text');
    fireRendererAck({ requestId: inserts[0]!.payload.requestId, ok: true });

    // Remembered optimistically: the next request flows straight through.
    const again = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token, appId: 'newapp',
      body: { text: 'direct', role: 'card', newParagraph: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const direct = sent('external:insert-text');
    expect(direct).toHaveLength(2);
    fireRendererAck({ requestId: direct[1]!.payload.requestId, ok: true });
    expect((await again).json.ok).toBe(true);
  });

  it('Deny while pending discards the held insert and sticks', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token, appId: 'newapp',
      body: { text: 'held', role: 'card', newParagraph: true },
    });
    expect(r.json.pending).toBe('consent');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const prompt = sent('external:consent-prompt')[0]!;
    fireConsentPromptResult({ requestId: prompt.payload.requestId, outcome: 'deny' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent('external:insert-text')).toHaveLength(0);
    const after = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token, appId: 'newapp',
      body: { text: 'again', role: 'card', newParagraph: true },
    });
    expect(after.json).toEqual({ ok: false, error: 'not-allowed' });
  });

  it('a successful allowed insert stamps lastSeen via a renderer note', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'X', role: 'card', newParagraph: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireRendererAck({ requestId: sent('external:insert-text')[0]!.payload.requestId, ok: true });
    await inserted;
    const notes = sent('external:consent-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.payload).toMatchObject({ kind: 'seen', appId: 'testapp' });
    expect(typeof notes[0]!.payload.when).toBe('string');
  });

  it('pending consent on /jump answers jumped:false', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'POST', path: '/jump', port: ep.port, token: ep.token, appId: 'newapp',
      body: { source: 'cmsrc1.abc' },
    });
    expect(r.json).toEqual({ ok: true, jumped: false, pending: 'consent' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const prompt = sent('external:consent-prompt')[0]!;
    fireConsentPromptResult({ requestId: prompt.payload.requestId, outcome: 'dismissed' });
  });
});

describe('doc targeting (/docs + insert target)', () => {
  const sent = (channel: string) => sentToRenderer.filter((s) => s.channel === channel);
  let dataDir: string;
  let winA: ReturnType<typeof makeMockWindow>;
  let winB: ReturnType<typeof makeMockWindow>;

  beforeEach(async () => {
    dataDir = path.join(tmpRoot, `d-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(dataDir, { recursive: true });
    resetElectronStub(dataDir);
    winA = makeMockWindow();
    winB = makeMockWindow();
    setMockFocusedWindow(winA);
    setMockAllWindows([winA, winB]);
    bridge.setDocDirectory({
      listDocs: () => [
        { uid: 'doc-a', filename: 'alpha.cmir', windowId: winA.id },
        { uid: 'doc-b', filename: null, windowId: winB.id },
      ],
      ownerWindow: (uid) => (uid === 'doc-a' ? (winA as any) : uid === 'doc-b' ? (winB as any) : null),
      speechUid: () => 'doc-b',
    });
    await bridge.startFastPasteBridge();
    bridge.resetExternalConsentForTests();
    bridge.resetFocusTrackingForTests();
    fireConsentSync({ policy: 'ask', apps: { testapp: 'allow' } });
  });

  afterEach(async () => {
    bridge.setDocDirectory(null);
    await bridge.stopFastPasteBridge();
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('GET /docs lists every open doc with session targets + focus flag', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({ method: 'GET', path: '/docs', port: ep.port, token: ep.token });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.docs).toEqual([
      { target: 'doc-a', title: 'alpha.cmir', focusedWindow: true, isSpeech: false },
      { target: 'doc-b', title: null, focusedWindow: false, isSpeech: true },
    ]);
  });

  it('GET /docs is consent-gated like the mutating routes', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const anon = await fetchJson({ method: 'GET', path: '/docs', port: ep.port, token: ep.token, appId: null });
    expect(anon.json.error).toBe('unidentified');
    const unknown = await fetchJson({ method: 'GET', path: '/docs', port: ep.port, token: ep.token, appId: 'newapp' });
    expect(unknown.json).toEqual({ ok: true, docs: null, pending: 'consent' });
    await untilForwarded();
    const prompt = sent('external:consent-prompt')[0]!;
    fireConsentPromptResult({ requestId: prompt.payload.requestId, outcome: 'dismissed' });
  });

  it('a targeted insert routes to the owning window with the target attached', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'aimed', role: 'card', newParagraph: true, target: 'doc-b' },
    });
    await untilForwarded();
    const inserts = sent('external:insert-text');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload.target).toBe('doc-b');
    // Renderer ack without docTitle → main fills it from the directory
    // (null filename here, so it stays absent rather than lying).
    fireRendererAck({ requestId: inserts[0]!.payload.requestId, ok: true });
    const r = await inserted;
    expect(r.json).toEqual({ ok: true, inserted: true });
  });

  it('a targeted insert to a vanished doc → target-not-found, no dispatch', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const r = await fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'aimed', role: 'card', newParagraph: true, target: 'doc-gone' },
    });
    expect(r.json).toEqual({ ok: false, error: 'target-not-found' });
    expect(sent('external:insert-text')).toHaveLength(0);
  });

  it('main fills docTitle for targeted inserts from the directory', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'aimed', role: 'card', newParagraph: true, target: 'doc-a' },
    });
    await untilForwarded();
    fireRendererAck({ requestId: sent('external:insert-text')[0]!.payload.requestId, ok: true });
    expect((await inserted).json).toEqual({ ok: true, inserted: true, docTitle: 'alpha.cmir' });
  });

  it('an untargeted insert still follows focus — legacy path untouched', async () => {
    const ep = bridge.getRunningEndpoint()!;
    const inserted = fetchJson({
      method: 'POST', path: '/insert', port: ep.port, token: ep.token,
      body: { text: 'legacy', role: 'card', newParagraph: true },
    });
    await untilForwarded();
    const inserts = sent('external:insert-text');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload.target).toBeUndefined();
    fireRendererAck({ requestId: inserts[0]!.payload.requestId, ok: true, docTitle: 'alpha.cmir' });
    expect((await inserted).json.ok).toBe(true);
  });
});
