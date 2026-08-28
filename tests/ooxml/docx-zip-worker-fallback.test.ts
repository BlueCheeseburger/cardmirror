import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fflate's async `zip` to always fail (simulating "no Worker global /
// CSP restriction"), while keeping the real `zipSync`/`unzipSync` so the
// fallback path and Docx.load still work against real bytes.
vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fflate')>();
  return {
    ...actual,
    zip: vi.fn(
      (
        _data: Record<string, Uint8Array>,
        _opts: unknown,
        cb: (err: Error | null, out?: Uint8Array) => void,
      ) => {
        cb(new Error('simulated worker spawn failure'));
      },
    ),
  };
});

import { Docx, __resetZipWorkerStateForTests } from '../../src/ooxml/docx.js';

// `Docx.toBuffer()` falls back to a synchronous zip when fflate's worker
// path fails (see its doc comment / markZipWorkerBroken). This used to be a
// silent, permanent-for-the-process fallback — now it's logged once per
// broken streak and retried periodically rather than given up on forever.

describe('Docx.toBuffer zip-worker fallback', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetZipWorkerStateForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('still produces valid, loadable output when the worker fails', async () => {
    const d = Docx.empty();
    d.writeText('word/document.xml', 'fallback-content');
    const bytes = await d.toBuffer();
    const reloaded = await Docx.load(bytes);
    expect(await reloaded.readText('word/document.xml')).toBe('fallback-content');
  });

  it('logs the fallback once, not on every call, while the window is open', async () => {
    const d1 = Docx.empty();
    d1.writeText('word/document.xml', 'a');
    await d1.toBuffer();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const d2 = Docx.empty();
    d2.writeText('word/document.xml', 'b');
    await d2.toBuffer();
    // Still inside the broken window from the first call — no repeat log,
    // and no repeat attempt at the (still-failing) worker path.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('retries the worker path — and re-logs on a fresh failure — after the window elapses', async () => {
    const d1 = Docx.empty();
    d1.writeText('word/document.xml', 'a');
    await d1.toBuffer();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    const d2 = Docx.empty();
    d2.writeText('word/document.xml', 'b');
    await d2.toBuffer();
    // A fresh streak (the worker failed again) logs again rather than
    // staying silent for the rest of the process.
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
