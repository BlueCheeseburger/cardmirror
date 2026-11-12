import { describe, it, expect } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { toDocx } from '../../src/export/index.js';
import { fromDocx, fromDocxFull } from '../../src/import/index.js';
import { Docx } from '../../src/ooxml/docx.js';
import {
  collectStarredIds,
  chunkStarredIds,
  parseStarredChunks,
  applyStarredIds,
  STARRED_CHUNK_CHARS,
} from '../../src/schema/starred.js';
import { serializeNative, parseNative } from '../../src/native/index.js';

const n = schema.nodes;
function card(tag: string, starred: boolean) {
  return n['card']!.createChecked(null, [
    n['tag']!.create({ id: newHeadingId(), starred }, schema.text(tag)),
    n['cite_paragraph']!.create(null, schema.text('Smith 24')),
    n['card_body']!.create(null, schema.text('body')),
  ]);
}
const block = (title: string, starred: boolean, ...kids: any[]) =>
  n['block']!.createChecked({ id: newHeadingId(), starred }, schema.text(title));
const doc = (...c: any[]) => n['doc']!.createChecked(null, c);
const starredTags = (d: any): string[] => {
  const out: string[] = [];
  d.descendants((x: any) => {
    if (x.attrs['starred'] === true) out.push(x.textContent);
    return true;
  });
  return out;
};

describe('stars saved in the file metadata', () => {
  const d = doc(card('Alpha', true), card('Beta', false), card('Gamma', true), block('Block B', true));

  it('survive a .docx round trip (by heading id)', async () => {
    const back = await fromDocx(await toDocx(d));
    expect(starredTags(back)).toEqual(['Alpha', 'Gamma', 'Block B']);
  });

  it('survive through fromDocxFull too, and the unstarred stay unstarred', async () => {
    const { doc: back } = await fromDocxFull(await toDocx(d));
    expect(starredTags(back)).toEqual(['Alpha', 'Gamma', 'Block B']);
    expect(collectStarredIds(back)).toHaveLength(3);
  });

  it('write nothing for a doc with no stars', async () => {
    const plain = doc(card('Alpha', false));
    const docx = await Docx.load(await toDocx(plain));
    expect(await docx.readStarred()).toEqual([]);
    expect(starredTags(await fromDocx(await toDocx(plain)))).toEqual([]);
  });

  it('survive a .cmir round trip', () => {
    const back = parseNative(serializeNative(d)).doc;
    expect(starredTags(back)).toEqual(['Alpha', 'Gamma', 'Block B']);
  });

  it('a long list is split across properties and read back whole, in order', async () => {
    const many = doc(...Array.from({ length: 40 }, (_, i) => card(`Card ${i}`, true)));
    const bytes = await toDocx(many);
    const docx = await Docx.load(bytes);
    expect((await docx.readCustomProperty('cmirStarred2')) !== null).toBe(true);
    const back = await fromDocx(bytes);
    expect(starredTags(back)).toEqual(Array.from({ length: 40 }, (_, i) => `Card ${i}`));
  });
});

describe('starred helpers', () => {
  it('chunk without splitting an id and without exceeding the limit', () => {
    const ids = Array.from({ length: 30 }, () => newHeadingId());
    const chunks = chunkStarredIds(ids);
    expect(chunks.every((c) => c.length <= STARRED_CHUNK_CHARS)).toBe(true);
    expect(parseStarredChunks(chunks)).toEqual(ids);
  });

  it('ignore ids that match no heading, and keep the doc when nothing changes', () => {
    const d = doc(card('Alpha', false));
    expect(applyStarredIds(d, ['not-a-real-id'])).toBe(d);
    expect(applyStarredIds(d, [])).toBe(d);
  });
});
