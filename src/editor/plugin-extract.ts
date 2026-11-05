// src/editor/plugin-extract.ts
/**
 * Plugin extraction - the core-owned, opinionated "what leaves the doc"
 * step of send-to-flow. Emits typed heading-like items only. Card
 * bodies and loose paragraphs NEVER emit (spec rule, no override).
 * Undertags always emit; the plugin decides what to do with them.
 */
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import {
  collectHeadings,
  computeHeadingRange,
  collectCiteText,
  TYPE_TO_LEVEL,
  type HeadingEntry,
} from './headings.js';
import { createDescriptorBuilder } from './learn-anchor.js';
import { mintSourceToken } from './plugin-source-token.js';
import type {
  ExtractResult,
  ExtractError,
  ExtractedItem,
  ExtractedKind,
} from './plugin-api.js';

/** The underlined stretches of a textblock's text, as `[start, end)` offsets
 *  into the text AFTER `text.replace(/\s+/g, ' ').trim()`: each character is
 *  flagged, a whitespace run collapses to one space (underlined only when the
 *  whole run was), and the ends are trimmed, so the offsets line up with the
 *  text that is emitted. Null when nothing is underlined, or when the rebuilt
 *  text doesn't equal `clean` (never hand a plugin offsets that don't fit). */
export function underlineRanges(node: PMNode, clean: string): [number, number][] | null {
  let text = '';
  const flags: boolean[] = [];
  node.descendants((child) => {
    if (!child.isText) return true;
    const u = child.marks.some((m) => m.type.name === 'underline_mark');
    const t = child.text ?? '';
    for (let i = 0; i < t.length; i++) flags.push(u);
    text += t;
    return false;
  });
  if (!flags.some(Boolean)) return null;
  // Collapse whitespace runs, tracking the flag of each kept character.
  let out = '';
  const kept: boolean[] = [];
  for (let i = 0; i < text.length; ) {
    if (/\s/.test(text[i]!)) {
      let all = true;
      while (i < text.length && /\s/.test(text[i]!)) {
        if (!flags[i]) all = false;
        i++;
      }
      out += ' ';
      kept.push(all);
    } else {
      out += text[i]!;
      kept.push(flags[i]!);
      i++;
    }
  }
  const lead = out.length - out.trimStart().length;
  const end = out.trimEnd().length;
  if (out.slice(lead, end) !== clean) return null;
  const ranges: [number, number][] = [];
  let start = -1;
  for (let i = lead; i < end; i++) {
    const u = kept[i]!;
    if (u && start < 0) start = i - lead;
    if (!u && start >= 0) {
      ranges.push([start, i - lead]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, end - lead]);
  return ranges.length > 0 ? ranges : null;
}

export function extractSelection(
  view: EditorView,
  ident: { docId: string; docTitle: string },
): ExtractResult | ExtractError {
  const { doc } = view.state;
  const sel = view.state.selection;
  let from: number;
  let to: number;
  if (sel.empty) {
    const range = enclosingSectionRange(doc, sel.from);
    if (!range) return { ok: false, error: 'no-heading-at-cursor' };
    from = range.from;
    to = range.to;
  } else {
    from = sel.from;
    to = sel.to;
  }
  const items = collectItems(doc, from, to, ident);
  if (items.length === 0) return { ok: false, error: 'empty-selection' };
  return { ok: true, docId: ident.docId, docTitle: ident.docTitle, items };
}

/** The section of the nearest heading whose range contains `pos` -
 *  walking outward: a tag whose card ended before `pos` is skipped in
 *  favor of the enclosing block/hat/pocket. Null above all headings. */
function enclosingSectionRange(
  doc: PMNode,
  pos: number,
): { from: number; to: number } | null {
  const headings = collectHeadings(doc, { skipCite: true });
  let idx = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i]!.pos <= pos) idx = i;
    else break;
  }
  for (let i = idx; i >= 0; i--) {
    const r = computeHeadingRange(doc, headings[i]!);
    if (r && pos >= r.from && pos <= r.to) return r;
  }
  return null;
}

/** The governing heading id at `pos` - for selections that start
 *  mid-card (undertag selected without its tag). */
function governingHeadingId(doc: PMNode, pos: number): string | null {
  const headings = collectHeadings(doc, { skipCite: true });
  let best: HeadingEntry | null = null;
  for (const h of headings) {
    if (h.pos <= pos) best = h;
    else break;
  }
  return best?.id ?? null;
}

function collectItems(
  doc: PMNode,
  from: number,
  to: number,
  ident: { docId: string; docTitle: string },
): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  let lastHeadingId = governingHeadingId(doc, from);
  const buildDescriptor = createDescriptorBuilder(doc); // flatten once, not per item
  doc.nodesBetween(from, to, (node, pos) => {
    // Live-view / linked-copy containers hold DERIVED, id-less mirror content
    // (a duplicate of a section that lives elsewhere in this doc, or in
    // another file). Emitting it would double up items with wrong
    // attribution, so skip the whole subtree - same guard collectHeadings
    // uses for self_ref.
    if (node.type.name === 'self_ref' || node.type.name === 'transclusion_ref') return false;
    // Emission is per-TEXTBLOCK: a selection that merely grazes a block
    // still emits that block's full text. Deliberate — the emitted text
    // doubles as the jump anchor's quote, and a partial-line quote would
    // fail to re-resolve after ordinary edits.
    if (!node.isTextblock) return true; // descend into card / analytic_unit / etc.
    const type = node.type.name;
    let kind: ExtractedKind | null = null;
    let text = '';
    if (type in TYPE_TO_LEVEL) {
      kind = type as ExtractedKind;
      text = node.textContent;
      const id = node.attrs['id'];
      lastHeadingId = typeof id === 'string' && id ? id : lastHeadingId;
    } else if (type === 'undertag') {
      kind = 'undertag';
      text = node.textContent;
    } else if (type === 'cite_paragraph') {
      kind = 'cite';
      text = collectCiteText(node);
    }
    if (!kind) return false; // card_body / paragraph: never emitted
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return false;
    const contentFrom = pos + 1;
    const contentTo = pos + node.nodeSize - 1;
    const anchor = contentTo > contentFrom ? buildDescriptor(contentFrom, contentTo) : null;
    const underline =
      kind === 'tag' || kind === 'analytic' || kind === 'undertag' ? underlineRanges(node, clean) : null;
    items.push({
      kind,
      text: clean,
      ...(underline ? { underline } : {}),
      source: mintSourceToken({
        docId: ident.docId,
        docTitle: ident.docTitle,
        headingId: lastHeadingId,
        anchor,
      }),
    });
    return false;
  });
  return items;
}
