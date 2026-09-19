/**
 * Freeze card numbers into text for derived exports (2026-09-19).
 *
 * Numbering is display-only: the document stores a skeleton
 * (`numRole` / `numRestart`) and the numbers are computed from position at
 * render and at docx export (numbering.ts). That is right for the working
 * document and wrong for a Send Doc, Read Doc or Marked Doc: those exports
 * DROP analytics or unmarked cards, so whatever is left renumbers
 * (1, 2, 3 where the speech had 1, 3, 5), and any card deleted from the
 * copy during the round shifts the rest again. The debater wants the
 * numbers they prepped with.
 *
 * So a lossy export bakes the numbers first, on the FULL document, before
 * the strips run: each numbered heading gets its glyph as literal text
 * (the user's display separators, e.g. "3. " / "b) "), and the card's
 * role is cleared so neither the docx exporter nor a later CardMirror
 * session numbers it a second time. The text carries no marks — it takes
 * the heading's own style, as a Word number takes the paragraph's — and
 * the working document is untouched (this runs on the export copy).
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';
import { computeNumbering } from './numbering.js';
import { glyphText } from './numbering-plugin.js';

/** Whether an export drops content that takes part in numbering, so its
 *  numbers must be frozen: analytics stripped (numbered analytic units
 *  vanish), the read-mode view (same strip), or marked cards only. A
 *  full save keeps the live skeleton. */
export function exportFreezesNumbering(opts: { includeAnalytics: boolean; readMode: boolean; markedCardsOnly?: boolean }): boolean {
  return !opts.includeAnalytics || opts.readMode || !!opts.markedCardsOnly;
}

/** The document with every computed number written into its heading as
 *  text and the numbering roles cleared. Unchanged (same node) when nothing
 *  is numbered. */
export function bakeCardNumbers(doc: PMNode): PMNode {
  const { cards } = computeNumbering(doc);
  if (cards.size === 0) return doc;
  const tr = new Transform(doc);
  // Descending, so an insert never shifts a position still to be visited.
  const positions = Array.from(cards.keys()).sort((a, b) => b - a);
  for (const pos of positions) {
    const label = cards.get(pos)!;
    const unit = doc.nodeAt(pos);
    if (!unit || unit.childCount === 0) continue;
    // The heading (tag / analytic) is the unit's first child; its inline
    // content starts one past its own opening token — the same spot the
    // display glyph is anchored at (numbering-plugin.ts).
    tr.insert(pos + 2, doc.type.schema.text(`${glyphText(label)} `));
    tr.setNodeMarkup(pos, undefined, { ...unit.attrs, numRole: 'none', numRestart: false });
  }
  return tr.doc;
}
