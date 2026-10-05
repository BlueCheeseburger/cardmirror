/**
 * openDocxOffThread: the Word import runs in a worker and the doc comes back
 * as JSON; any worker failure re-runs the import inline so callers see the
 * same result / error as before. The Worker is stubbed here (the real one is
 * a Vite module worker).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { toDocx, fromDocxFull } from '../../src/index.js';

type Reply = (req: { id: number; bytes: Uint8Array }) => unknown;
let reply: Reply;
let posted = 0;

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage(req: { id: number; bytes: Uint8Array }): void {
    posted++;
    const data = reply(req);
    queueMicrotask(() => {
      if (data === 'silent') return; // never answers
      if (data === 'crash') this.onerror?.();
      else this.onmessage?.({ data } as MessageEvent);
    });
  }
  terminate(): void {}
}

async function sampleDocx(): Promise<Uint8Array> {
  const doc = schema.nodes['doc']!.createChecked(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Warming is real')),
      schema.nodes['card_body']!.create(null, schema.text('body text')),
    ]),
  ]);
  return toDocx(doc, {});
}

beforeEach(() => {
  vi.resetModules();
  posted = 0;
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openDocxOffThread', () => {
  it('materializes the worker’s JSON reply', async () => {
    const bytes = await sampleDocx();
    const expected = await fromDocxFull(bytes);
    reply = (req) => ({ id: req.id, ok: true, docJson: expected.doc.toJSON(), threads: [], docId: 'from-worker' });
    const { openDocxOffThread } = await import('../../src/editor/docx-open.js');
    const got = await openDocxOffThread(bytes);
    expect(posted).toBe(1);
    // JSON, not eq(): resetModules gives docx-open its own schema instance.
    expect(got.doc.toJSON()).toEqual(expected.doc.toJSON());
    expect(got.docId).toBe('from-worker');
  });

  it('re-runs inline when the import fails in the worker, with the inline error', async () => {
    reply = (req) => ({ id: req.id, ok: false, error: 'boom' });
    const { openDocxOffThread } = await import('../../src/editor/docx-open.js');
    await expect(openDocxOffThread(new Uint8Array([1, 2, 3]))).rejects.not.toThrow('boom');
    const bytes = await sampleDocx();
    const got = await openDocxOffThread(bytes);
    expect(got.doc.textContent).toContain('Warming is real');
  });

  it('survives a crashed worker: this open runs inline, the next gets a new worker', async () => {
    reply = () => 'crash';
    const { openDocxOffThread } = await import('../../src/editor/docx-open.js');
    const bytes = await sampleDocx();
    expect((await openDocxOffThread(bytes)).doc.textContent).toContain('Warming is real');
    const expected = await fromDocxFull(bytes);
    reply = (req) => ({ id: req.id, ok: true, docJson: expected.doc.toJSON(), threads: [], docId: null });
    await openDocxOffThread(bytes);
    expect(posted).toBe(2);
  });

  it('a worker that never answers: the open falls back inline after the timeout, and a new worker serves the next', async () => {
    vi.useFakeTimers();
    try {
      reply = () => 'silent';
      const { openDocxOffThread, docxWorkerTimeoutMs } = await import('../../src/editor/docx-open.js');
      const bytes = await sampleDocx();
      let settled = false;
      const opening = openDocxOffThread(bytes).then((r) => {
        settled = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(docxWorkerTimeoutMs(bytes.byteLength) - 50);
      expect(settled, 'still waiting on the worker').toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect((await opening).doc.textContent).toContain('Warming is real');
      // The stuck worker was retired: the next open posts to a fresh one.
      const expected = await fromDocxFull(bytes);
      reply = (req) => ({ id: req.id, ok: true, docJson: expected.doc.toJSON(), threads: [], docId: null });
      const again = openDocxOffThread(bytes);
      await vi.advanceTimersByTimeAsync(0);
      expect((await again).doc.textContent).toContain('Warming is real');
      expect(posted).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a larger file more time', async () => {
    const { docxWorkerTimeoutMs } = await import('../../src/editor/docx-open.js');
    expect(docxWorkerTimeoutMs(100_000)).toBe(22_000);
    expect(docxWorkerTimeoutMs(50 * 1024 * 1024)).toBe(120_000);
  });
});
