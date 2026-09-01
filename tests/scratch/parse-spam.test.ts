// @vitest-environment jsdom
// Scratch: run the reported crashy file through the real parse path.
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNative } from '../../src/native/index.js';

describe('single payer aff masterfile', () => {
  it('parses through the real load path', () => {
    const bytes = readFileSync('/Users/anthonytrufanov/Downloads/single payer aff masterfile.cmir');
    const t0 = Date.now();
    const result = parseNative(new Uint8Array(bytes));
    console.log('parse ms:', Date.now() - t0);
    console.log('result keys:', Object.keys(result));
    const doc = (result as any).doc;
    console.log('doc childCount:', doc.childCount, 'size:', doc.nodeSize);
    doc.check();
    console.log('check(): ok');
  });
});
