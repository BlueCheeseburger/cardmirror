/**
 * gzipAsync vs a worker that dies MID-FLIGHT (field bug 2026-08-29):
 * fflate's async gzip spawns a worker per call; the existing fallback
 * only caught a worker that failed to SPAWN. One that spawned and then
 * died never called back, stranding the promise — every `.cmir` save
 * hung amber forever, before the save watchdog (which wraps only the
 * disk write) could arm, and Save As → .cmir never even reached the
 * file picker. `.docx` was immune (zipSync, no worker).
 *
 * Pinned: an unresponsive worker resolves via the sync fallback within
 * the timeout (byte-identical gzip); the session then LATCHES to the
 * sync path so later saves don't re-pay the timeout (fflate spawns a
 * fresh worker per call — there is no worker to "restart", and the
 * conditions that kill one mid-flight persist).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const workerCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('fflate', async (importOriginal) => {
  const real = await importOriginal<typeof import('fflate')>();
  return {
    ...real,
    // Spawns "successfully" (no throw), then never answers.
    gzip: (_b: Uint8Array, _o: unknown, _cb: unknown) => {
      workerCalls.n++;
    },
  };
});

import {
  gzip,
  gzipAsync,
  gunzip,
  __resetGzipWorkerStateForTests,
} from '../../src/native/codec.js';

const input = new TextEncoder().encode(JSON.stringify({ doc: 'x'.repeat(5000) }));

beforeEach(() => {
  __resetGzipWorkerStateForTests();
  workerCalls.n = 0;
});

describe('gzipAsync worker-death fallback', () => {
  it('an unresponsive worker falls back to sync compression instead of hanging', async () => {
    const out = await gzipAsync(input, 100);
    expect(Array.from(gunzip(out))).toEqual(Array.from(input));
    expect(Array.from(out)).toEqual(Array.from(gzip(input))); // byte-identical
    expect(workerCalls.n).toBe(1);
  });

  it('after a timeout the session latches sync — no repeated timeout tax', async () => {
    await gzipAsync(input, 100);
    const started = Date.now();
    const out = await gzipAsync(input, 5000);
    expect(Date.now() - started).toBeLessThan(1000); // no 5s probe
    expect(workerCalls.n).toBe(1); // the dead worker path is not retried
    expect(Array.from(gunzip(out))).toEqual(Array.from(input));
  });
});
