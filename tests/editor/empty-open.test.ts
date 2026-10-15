/**
 * Genuinely-empty-file opens (`src/editor/empty-open.ts`).
 *
 * The contract under test:
 *  - Only the host's stat-backed `emptyOnDisk` flag AND a 0-byte read
 *    qualify a file for a blank-document open — a short read of a cloud
 *    placeholder (real stat size, no flag) keeps the "hasn't finished
 *    downloading" error, and journals are never blank-opened.
 *  - The substituted blank bytes actually parse, in both formats, to a
 *    document matching the canonical blank doc — so every downstream
 *    open path works on them unmodified.
 */
import { describe, expect, it } from 'vitest';
import { opensAsBlank, blankDocumentBytes } from '../../src/editor/empty-open.js';
import { makeBlankDoc } from '../../src/editor/blank-doc.js';
import { parseNative } from '../../src/native/index.js';
import { fromDocxFull } from '../../src/import/index.js';

const empty = new Uint8Array(0);

describe('opensAsBlank', () => {
  it('requires the stat-backed flag and an empty read', () => {
    expect(opensAsBlank({ name: 'a.docx', bytes: empty, emptyOnDisk: true })).toBe(true);
    expect(opensAsBlank({ name: 'a.cmir', bytes: empty, emptyOnDisk: true })).toBe(true);
    // Cloud placeholder shape: empty read, but stat reported a real size
    // → no flag → keep the placeholder error.
    expect(opensAsBlank({ name: 'a.docx', bytes: empty })).toBe(false);
    expect(opensAsBlank({ name: 'a.docx', bytes: empty, emptyOnDisk: false })).toBe(false);
    // Defensive: flag present but the read wasn't actually empty.
    expect(
      opensAsBlank({ name: 'a.docx', bytes: new Uint8Array([1]), emptyOnDisk: true }),
    ).toBe(false);
  });

  it('never blank-opens a journal — a 0-byte journal is corrupt', () => {
    expect(
      opensAsBlank({ name: 'a.cmir-journal', bytes: empty, emptyOnDisk: true }),
    ).toBe(false);
  });
});

describe('blankDocumentBytes', () => {
  it('cmir bytes parse back to the canonical blank doc', async () => {
    const bytes = await blankDocumentBytes('cmir', makeBlankDoc());
    expect(bytes.length).toBeGreaterThan(0);
    const parsed = parseNative(bytes);
    const blank = makeBlankDoc();
    // Same shape; a styled blank's heading id is freshly minted each time.
    expect(parsed.doc.childCount).toBe(1);
    expect(parsed.doc.firstChild!.type).toBe(blank.firstChild!.type);
    expect(parsed.doc.textContent).toBe('');
  });

  it('docx bytes parse back to a document', async () => {
    const bytes = await blankDocumentBytes('docx', makeBlankDoc());
    // 'PK' zip magic — what the parser-picking sniff downstream keys on.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const { doc } = await fromDocxFull(bytes);
    expect(doc.childCount).toBeGreaterThan(0);
    expect(doc.textContent).toBe('');
  });
});
