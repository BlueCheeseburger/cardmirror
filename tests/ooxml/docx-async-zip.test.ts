import { describe, it, expect } from 'vitest';
import { Docx } from '../../src/ooxml/docx.js';

// `Docx.toBuffer()`'s DEFLATE now runs on fflate's async worker path (see
// its doc comment) instead of the synchronous `zipSync` — added so autosave
// (a debounced background write) doesn't stall typing on large .docx docs.
// The existing round-trip/export/style-cleaner suites already exercise
// `toBuffer()` end-to-end on every run; these tests target the async path's
// own correctness specifically: it still produces valid, loadable output,
// and concurrent calls on independent instances don't cross-contaminate.

describe('Docx.toBuffer (async zip)', () => {
  it('produces bytes that round-trip through Docx.load with the same content', async () => {
    const d = Docx.empty();
    d.writeText('word/document.xml', '<w:document><w:body>hello</w:body></w:document>');
    const bytes = await d.toBuffer();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const reloaded = await Docx.load(bytes);
    const xml = await reloaded.readText('word/document.xml');
    expect(xml).toBe('<w:document><w:body>hello</w:body></w:document>');
  });

  it('two concurrent instances serialize independently without cross-contamination', async () => {
    const a = Docx.empty();
    a.writeText('word/document.xml', 'AAAA');
    const b = Docx.empty();
    b.writeText('word/document.xml', 'BBBB');

    // Fire both zips concurrently — regression guard for any accidental
    // shared mutable state in the async path (module-level `zipWorkerBroken`
    // is a one-way latch, not per-call state, so this specifically checks
    // the actual zip contents don't leak between calls).
    const [bytesA, bytesB] = await Promise.all([a.toBuffer(), b.toBuffer()]);

    const reloadedA = await Docx.load(bytesA);
    const reloadedB = await Docx.load(bytesB);
    expect(await reloadedA.readText('word/document.xml')).toBe('AAAA');
    expect(await reloadedB.readText('word/document.xml')).toBe('BBBB');
  });
});
