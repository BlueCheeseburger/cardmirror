// @vitest-environment jsdom
/**
 * The Card menu's "Export as New File…": the pieces a menu acts on become a
 * standalone document (document order, overlaps merged), named after their
 * first line; the row is on the shared Card menu list.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { sectionDocFromRanges, suggestedSectionName } from '../../src/editor/export-ranges.js';
import { buildCardMenuSections } from '../../src/editor/card-menu-sections.js';
import { EditorState } from 'prosemirror-state';

const heading = (type: 'pocket' | 'hat' | 'block', text: string) =>
  schema.nodes[type]!.create({ id: newHeadingId() }, schema.text(text));
const card = (tagText: string, bodyText: string) =>
  schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tagText)),
    schema.nodes['card_body']!.create(null, schema.text(bodyText)),
  ]);
const docOf = (...c: PMNode[]) => schema.nodes['doc']!.createChecked(null, c);

/** [from, to] of the top-level child at `index`. */
function childRange(doc: PMNode, index: number): { from: number; to: number } {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return { from: pos, to: pos + doc.child(index).nodeSize };
}

describe('sectionDocFromRanges', () => {
  const doc = docOf(
    heading('block', 'AT: Politics'),
    card('Link turns it', 'link body'),
    card('Uniqueness', 'uq body'),
    heading('block', 'Case'),
    card('Impact', 'impact body'),
  );

  it('keeps only the covered pieces as a standalone document', () => {
    const a = childRange(doc, 0);
    const b = childRange(doc, 2);
    const out = sectionDocFromRanges(doc, [{ from: a.from, to: b.to }])!;
    expect(out.childCount).toBe(3);
    expect(out.textContent).toContain('AT: Politics');
    expect(out.textContent).toContain('uq body');
    expect(out.textContent).not.toContain('impact body');
  });

  it('puts separate ranges in document order and merges overlapping ones', () => {
    const late = childRange(doc, 4);
    const early = childRange(doc, 1);
    const out = sectionDocFromRanges(doc, [late, early, early])!;
    expect(out.childCount).toBe(2);
    expect(out.child(0).textContent).toContain('link body');
    expect(out.child(1).textContent).toContain('impact body');
  });

  it('is null when the ranges cover nothing', () => {
    expect(sectionDocFromRanges(doc, [])).toBeNull();
    expect(sectionDocFromRanges(doc, [{ from: 5, to: 5 }])).toBeNull();
  });
});

describe('suggestedSectionName', () => {
  it("is the first line's text, made safe for a file name", () => {
    const d = docOf(heading('block', 'AT: Politics / “Link”?'), card('Link', 'x'));
    expect(suggestedSectionName(d)).toBe('AT Politics “Link”');
  });

  it('falls back to "Export" when there is no text', () => {
    expect(suggestedSectionName(docOf(schema.nodes['paragraph']!.create()))).toBe('Export');
  });

  it('is capped to a sane length', () => {
    expect(suggestedSectionName(docOf(heading('block', 'x'.repeat(300)))).length).toBeLessThanOrEqual(80);
  });
});

describe('the Card menu list', () => {
  const state = EditorState.create({ doc: docOf(card('T', 'b')) });
  it('has an Export row that hands the menu ranges to the host', () => {
    const exportRanges = vi.fn();
    const sections = buildCardMenuSections({
      state: () => state,
      ranges: () => [{ from: 0, to: 4 }],
      run: () => {},
      exportRanges,
    });
    const exp = sections.find((s) => s.title === 'Export')!;
    expect(exp.items.map((i) => i.label)).toEqual(['Export as New File…']);
    exp.items[0]!.run(undefined as never);
    expect(exportRanges).toHaveBeenCalledWith([{ from: 0, to: 4 }]);
  });

  it('leaves the row out when the host cannot export', () => {
    const sections = buildCardMenuSections({ state: () => state, ranges: () => [], run: () => {} });
    expect(sections.some((s) => s.title === 'Export')).toBe(false);
  });
});
