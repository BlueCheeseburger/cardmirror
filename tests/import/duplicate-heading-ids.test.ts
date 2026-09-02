/**
 * Duplicate heading-id dedupe (field bug, 2026-08-28: a hat "Overview"
 * imported carrying the same id as the block "DA – Taiwan – 1NC", so
 * the nav pane's first-match [data-id] jump — and transclusion's
 * extractSection, same semantics — resolved the wrong heading).
 *
 * The vector: the importer adopts `pmd-heading-*` bookmark ids
 * verbatim, and while Word enforces bookmark uniqueness, the tools
 * around it (Verbatim OOXML ops, LibreOffice, Google Docs) duplicate
 * a bookmarked heading paragraph happily — the everyday move of
 * copying a heading line as a style template and retyping it.
 *
 * Pinned here:
 *  - import re-mints the SECOND occurrence; the first keeps its id
 *    (first-wins matches every resolver's first-match lookup, so the
 *    dedupe is behavior-preserving for anything that resolved before)
 *  - re-export writes each bookmark once again (no propagation)
 *  - the .cmir load chain heals already-infected files the same way
 *  - clean docs pass through untouched (same node, no rebuild)
 */
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { dedupeHeadingIds } from '../../src/schema/ids.js';
import { toDocx } from '../../src/export/index.js';
import { fromDocx } from '../../src/import/index.js';
import { serializeNative, parseNative } from '../../src/native/index.js';
import { Docx } from '../../src/ooxml/docx.js';

const BLOCK_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const HAT_ID = 'bbbbbbbb-1111-2222-3333-444444444444';

/** Mirrors the field file's shape: a 1NC block, body, then the section
 *  heading that was "templated" from the block in Word-land. */
function sampleDoc(): PMNode {
  const n = schema.nodes;
  return n['doc']!.createChecked(null, [
    n['block']!.create({ id: BLOCK_ID }, schema.text('DA – Taiwan – 1NC')),
    n['paragraph']!.create(null, schema.text('card body text')),
    n['hat']!.create({ id: HAT_ID }, schema.text('Overview')),
    n['paragraph']!.create(null, schema.text('overview body')),
  ]);
}

/** Simulate the Word-adjacent template-copy: the hat's paragraph ends
 *  up carrying the BLOCK's bookmark name. */
async function withClonedBookmark(bytes: Uint8Array): Promise<Uint8Array> {
  const docx = await Docx.load(bytes);
  const xml = (await docx.readText('word/document.xml'))!;
  docx.writeText(
    'word/document.xml',
    xml.replace(`pmd-heading-${HAT_ID}`, `pmd-heading-${BLOCK_ID}`),
  );
  return docx.toBuffer();
}

function headings(doc: PMNode): Array<{ type: string; text: string; id: string }> {
  const out: Array<{ type: string; text: string; id: string }> = [];
  doc.descendants((node) => {
    if (['pocket', 'hat', 'block', 'tag', 'analytic'].includes(node.type.name)) {
      out.push({ type: node.type.name, text: node.textContent, id: String(node.attrs['id']) });
    }
    return true;
  });
  return out;
}

describe('docx import dedupes duplicated pmd-heading bookmarks', () => {
  it('first occurrence keeps its id; the second is re-minted', async () => {
    const infected = await withClonedBookmark(await toDocx(sampleDoc()));
    const heads = headings(await fromDocx(infected));
    expect(heads.map((h) => `${h.type}:${h.text}`)).toEqual([
      'block:DA – Taiwan – 1NC',
      'hat:Overview',
    ]);
    expect(heads[0]!.id).toBe(BLOCK_ID);
    expect(heads[1]!.id).not.toBe(BLOCK_ID);
    expect(heads[1]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('re-export carries each bookmark once — the duplicate no longer propagates', async () => {
    const infected = await withClonedBookmark(await toDocx(sampleDoc()));
    const reexported = await toDocx(await fromDocx(infected));
    const xml = (await (await Docx.load(reexported)).readText('word/document.xml'))!;
    expect(xml.split(`pmd-heading-${BLOCK_ID}`).length - 1).toBe(1);
    // The re-minted hat has its own bookmark.
    expect((xml.match(/pmd-heading-/g) ?? []).length).toBe(2);
  });

  it('a clean round-trip keeps both ids stable', async () => {
    const heads = headings(await fromDocx(await toDocx(sampleDoc())));
    expect(heads[0]!.id).toBe(BLOCK_ID);
    expect(heads[1]!.id).toBe(HAT_ID);
  });
});

describe('cmir load chain heals already-infected files', () => {
  it('parseNative re-mints later duplicates, first occurrence keeps the id', () => {
    const n = schema.nodes;
    // createChecked can't stop us: duplicate ids are attr-level, so an
    // infected file (imported before the fix) serializes fine.
    const infected = n['doc']!.createChecked(null, [
      n['block']!.create({ id: BLOCK_ID }, schema.text('DA – Taiwan – 1NC')),
      n['card']!.createChecked(null, [
        n['tag']!.create({ id: HAT_ID }, schema.text('a tag')),
        n['card_body']!.create(null, schema.text('body')),
      ]),
      n['hat']!.create({ id: BLOCK_ID }, schema.text('Overview')),
      n['block']!.create({ id: HAT_ID }, schema.text('UQ – AT: Tariffs – 2NC')),
    ]);
    const { doc } = parseNative(serializeNative(infected));
    const heads = headings(doc);
    expect(heads.map((h) => h.text)).toEqual([
      'DA – Taiwan – 1NC',
      'a tag',
      'Overview',
      'UQ – AT: Tariffs – 2NC',
    ]);
    expect(heads[0]!.id).toBe(BLOCK_ID); // first wins
    expect(heads[1]!.id).toBe(HAT_ID); // first wins (tag inside a card)
    expect(heads[2]!.id).not.toBe(BLOCK_ID);
    expect(heads[3]!.id).not.toBe(HAT_ID);
    const ids = heads.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('dedupeHeadingIds', () => {
  it('returns the SAME node when every id is unique (no rebuild)', () => {
    const doc = sampleDoc();
    expect(dedupeHeadingIds(doc)).toBe(doc);
  });

  it('never touches non-heading nodes or unique headings around a duplicate', () => {
    const n = schema.nodes;
    const doc = n['doc']!.createChecked(null, [
      n['block']!.create({ id: BLOCK_ID }, schema.text('one')),
      n['paragraph']!.create(null, schema.text('prose stays')),
      n['block']!.create({ id: BLOCK_ID }, schema.text('two')),
      n['block']!.create({ id: HAT_ID }, schema.text('three')),
    ]);
    const out = dedupeHeadingIds(doc);
    const heads = headings(out);
    expect(heads[0]!.id).toBe(BLOCK_ID);
    expect(heads[1]!.id).not.toBe(BLOCK_ID);
    expect(heads[2]!.id).toBe(HAT_ID);
    expect(out.child(1).textContent).toBe('prose stays');
    expect(out.textContent).toBe(doc.textContent);
  });
});
