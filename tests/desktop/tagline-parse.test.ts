/**
 * The real parser behind the tagline index: read a file off disk and list the
 * card taglines, for both `.cmir` and `.docx`.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';
import { toDocx } from '../../src/index.js';
import { parseTaglines } from '../../apps/desktop/src/tagline-parse.js';

const n = schema.nodes;
function doc(): PMNode {
  return n['doc']!.create(null, [
    n['pocket']!.create({ id: 'P' }, schema.text('1AC')),
    n['card']!.create(null, [
      n['tag']!.create({ id: 'T1' }, schema.text('Heg decline causes war')),
      n['card_body']!.create(null, schema.text('body one')),
    ]),
    n['card']!.create(null, [
      n['tag']!.create({ id: 'T2' }, schema.text('Warming is fast')),
      n['card_body']!.create(null, schema.text('body two')),
    ]),
  ]);
}

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'tparse-'));

describe('parseTaglines', () => {
  it('reads taglines from a .cmir file', async () => {
    const p = path.join(tmp(), 'a.cmir');
    fs.writeFileSync(p, serializeNative(doc()));
    expect((await parseTaglines(p)).tags).toEqual(['Heg decline causes war', 'Warming is fast']);
  });

  it('reads taglines from a .docx file', async () => {
    const p = path.join(tmp(), 'a.docx');
    fs.writeFileSync(p, await toDocx(doc()));
    expect((await parseTaglines(p)).tags).toEqual(['Heg decline causes war', 'Warming is fast']);
  });

  it('rejects a file that is not a document, so the index can record it as empty', async () => {
    const p = path.join(tmp(), 'bad.cmir');
    fs.writeFileSync(p, 'not a document');
    await expect(parseTaglines(p)).rejects.toThrow();
  });
});
