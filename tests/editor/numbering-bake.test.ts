// @vitest-environment jsdom
/**
 * Freezing numbers into text for lossy exports (numbering-bake.ts): the
 * glyphs become literal heading text, the roles clear, and the strips that
 * follow can no longer renumber what survives.
 */
import { describe, it, expect } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { computeNumbering, type NumRole } from '../../src/editor/numbering.js';
import { bakeCardNumbers, exportFreezesNumbering } from '../../src/editor/numbering-bake.js';
import { transformForExport } from '../../src/export/transform-for-export.js';

function card(tag: string, role: NumRole = 'none', restart = false): PMNode {
  return schema.nodes['card']!.createChecked({ numRole: role, numRestart: restart }, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text('body')),
  ]);
}
function analytic(tag: string, role: NumRole = 'none'): PMNode {
  return schema.nodes['analytic_unit']!.createChecked({ numRole: role, numRestart: false }, [
    schema.nodes['analytic']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text('body')),
  ]);
}
function block(text: string): PMNode {
  return schema.nodes['block']!.create({ id: newHeadingId(), numRestart: true }, schema.text(text));
}
function doc(...children: PMNode[]): PMNode {
  return schema.nodes['doc']!.create(null, children);
}
/** Heading text of every card / analytic unit in document order. */
function headings(d: PMNode): string[] {
  const out: string[] = [];
  d.descendants((n) => {
    if (n.type.name === 'card' || n.type.name === 'analytic_unit') out.push(n.child(0).textContent);
    return true;
  });
  return out;
}

describe('bakeCardNumbers', () => {
  it('writes each computed number into its heading and clears the roles', () => {
    const d = doc(block('B'), card('One', 'number'), card('Sub', 'sub'), analytic('Two', 'number'), card('Skip'), card('Three', 'number', true));
    const baked = bakeCardNumbers(d);
    expect(headings(baked)).toEqual(['1. One', 'a. Sub', '2. Two', 'Skip', '1. Three']);
    expect(computeNumbering(baked).cards.size, 'nothing is numbered any more').toBe(0);
    baked.descendants((n) => {
      if (n.type.name === 'card' || n.type.name === 'analytic_unit') {
        expect(n.attrs['numRole']).toBe('none');
        expect(n.attrs['numRestart']).toBe(false);
      }
      return true;
    });
    // The source is untouched, and baking again is a no-op.
    expect(headings(d)).toEqual(['One', 'Sub', 'Two', 'Skip', 'Three']);
    expect(bakeCardNumbers(baked)).toBe(baked);
  });

  it('returns the same node when nothing is numbered', () => {
    const d = doc(card('A'), analytic('B'));
    expect(bakeCardNumbers(d)).toBe(d);
  });

  it('keeps the prepped numbers through the Send Doc strip (the bug: 1, 3 became 1, 2)', () => {
    const d = doc(card('One', 'number'), analytic('Two', 'number'), card('Three', 'number'));
    const strip = { includeComments: false, includeAnalytics: false, includeUndertags: false, readMode: false };
    // Without the bake, the survivors renumber.
    const live = transformForExport(d, strip);
    expect(computeNumbering(live).cards.size).toBe(2);
    expect(Array.from(computeNumbering(live).cards.values()).map((l) => l.text)).toEqual(['1', '2']);
    // Baked first, the survivors carry the numbers they had.
    const frozen = transformForExport(bakeCardNumbers(d), strip);
    expect(headings(frozen)).toEqual(['1. One', '3. Three']);
    expect(computeNumbering(frozen).cards.size).toBe(0);
  });

  it('survives the read-mode and marked-cards transforms', () => {
    const d = doc(card('One', 'number'), card('Two', 'number'));
    const read = transformForExport(bakeCardNumbers(d), { includeComments: false, includeAnalytics: false, includeUndertags: false, readMode: true });
    expect(headings(read)).toEqual(['1. One', '2. Two']);
  });
});

describe('exportFreezesNumbering', () => {
  it('freezes for the lossy presets and not for a full save', () => {
    const full = { includeAnalytics: true, readMode: false, markedCardsOnly: false };
    expect(exportFreezesNumbering(full)).toBe(false);
    expect(exportFreezesNumbering({ ...full, includeAnalytics: false }), 'Send Doc').toBe(true);
    expect(exportFreezesNumbering({ ...full, includeAnalytics: false, readMode: true }), 'Read Doc').toBe(true);
    expect(exportFreezesNumbering({ ...full, includeAnalytics: false, markedCardsOnly: true }), 'Marked Doc').toBe(true);
    expect(exportFreezesNumbering({ includeAnalytics: true, readMode: false }), 'no markedCardsOnly given').toBe(false);
  });
});
