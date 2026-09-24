/**
 * Logos card search (https://logos-debate.netlify.app) — the `l ` source
 * in the Search Everything palette.
 *
 * Logos indexes cards cut from the round docs teams open-source on
 * opencaselist (college + high school policy). Its backend has no
 * documented API; the two endpoints used here are the ones its own
 * frontend calls:
 *   GET /query?search=<q>&cursor=<n> → { results: LogosResult[], cursor }
 *   GET /card?id=<id>                → LogosCard (full body + formatting)
 * The server echoes any Origin in Access-Control-Allow-Origin, so a
 * plain renderer fetch works on desktop (file://) and web alike.
 *
 * Formatting ranges on a full card are `[paragraph, start, end]` with
 * end exclusive, where paragraph 0 is the tag, 1 the cite, and 2+ index
 * `body` (body[i] ↔ paragraph i + 2). The cite's own bolded span comes
 * separately as `cite_emphasis: [start, end][]`.
 */
import { Fragment, Slice, type Mark, type Node as PMNode } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../schema/index.js';

export const LOGOS_API = 'https://logos-debate.duckdns.org';

/** One row of a Logos search. Only the fields the palette shows. */
export interface LogosResult {
  id: string;
  tag: string;
  cite: string;
  division?: string;
  year?: string;
  school?: string;
  side?: string;
}

/** A full card from `/card`. */
export interface LogosCard {
  id: string;
  tag: string;
  cite: string;
  cite_emphasis?: [number, number][];
  body: string[];
  highlights?: [number, number, number][];
  underlines?: [number, number, number][];
  emphasis?: [number, number, number][];
}

export async function searchLogos(query: string, signal?: AbortSignal): Promise<LogosResult[]> {
  const url = `${LOGOS_API}/query?search=${encodeURIComponent(query)}&cursor=0`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Logos search failed (HTTP ${res.status})`);
  const body = (await res.json()) as { results?: unknown };
  if (!Array.isArray(body.results)) return [];
  return body.results.filter(
    (r): r is LogosResult =>
      !!r && typeof r === 'object' &&
      typeof (r as LogosResult).id === 'string' &&
      typeof (r as LogosResult).tag === 'string' &&
      typeof (r as LogosResult).cite === 'string',
  );
}

export async function fetchLogosCard(id: string): Promise<LogosCard> {
  const res = await fetch(`${LOGOS_API}/card?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Couldn't load the card from Logos (HTTP ${res.status})`);
  const card = (await res.json()) as LogosCard;
  if (typeof card?.tag !== 'string' || typeof card.cite !== 'string' || !Array.isArray(card.body)) {
    throw new Error('Logos returned a card in an unexpected shape');
  }
  return card;
}

/** Short right-aligned label for a result row: "HS 24 · Lowell · Neg". */
export function logosResultMeta(r: LogosResult): string {
  const div = r.division === 'ndtceda' ? 'College' : r.division === 'hspolicy' ? 'HS' : '';
  const side = r.side === 'A' ? 'Aff' : r.side === 'N' ? 'Neg' : '';
  return [[div, r.year].filter(Boolean).join(' '), r.school, side].filter(Boolean).join(' · ');
}

type Range = [number, number];

/** Text of `text` cut at every range boundary, each piece carrying the
 *  marks whose ranges cover it. Ranges are clamped; empty ones skipped. */
function markedText(text: string, layers: { ranges: Range[]; marks: Mark[] }[]): PMNode[] {
  const cuts = new Set<number>([0, text.length]);
  const clamped = layers.map((l) => ({
    marks: l.marks,
    ranges: l.ranges
      .map(([s, e]): Range => [Math.max(0, Math.min(s, text.length)), Math.max(0, Math.min(e, text.length))])
      .filter(([s, e]) => e > s),
  }));
  for (const l of clamped) for (const [s, e] of l.ranges) cuts.add(s).add(e);
  const points = [...cuts].sort((a, b) => a - b);
  const out: PMNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    let marks: readonly Mark[] = [];
    for (const l of clamped) {
      if (l.ranges.some(([s, e]) => s <= from && to <= e)) {
        for (const m of l.marks) marks = m.addToSet(marks);
      }
    }
    out.push(schema.text(text.slice(from, to), marks));
  }
  return out;
}

/** Ranges from a `[paragraph, start, end][]` list that fall on `paragraph`. */
function rangesFor(list: [number, number, number][] | undefined, paragraph: number): Range[] {
  return (list ?? []).filter((r) => r[0] === paragraph).map((r): Range => [r[1], r[2]]);
}

/** Build an insertable card — tag, cite (its cite_emphasis span as the
 *  Cite style), then one body paragraph per `body` entry carrying
 *  underline / emphasis / highlight. Emphasis wins over underline where
 *  both cover a run (the named-style marks exclude each other). */
export function buildLogosCardSlice(card: LogosCard, highlightColor: string): Slice {
  const underline = schema.marks['underline_mark']!.create();
  const emphasis = schema.marks['emphasis_mark']!.create();
  const highlight = schema.marks['highlight']!.create({ color: highlightColor });
  const cite = schema.marks['cite_mark']!.create();

  const tag = schema.nodes['tag']!.create(
    { id: newHeadingId() },
    card.tag.trim() ? schema.text(card.tag.trim()) : undefined,
  );
  const citeText = card.cite ?? '';
  const citePara = schema.nodes['cite_paragraph']!.create(
    null,
    citeText
      ? markedText(citeText, [{ ranges: (card.cite_emphasis ?? []) as Range[], marks: [cite] }])
      : undefined,
  );
  const bodyParas = card.body
    .map((text, i) => ({ text: typeof text === 'string' ? text : '', paragraph: i + 2 }))
    .filter((p) => p.text.length > 0)
    .map(({ text, paragraph }) => {
      // Layer order matters: emphasis is added after underline, and
      // `addToSet` drops the underline it excludes on overlapping runs.
      const nodes = markedText(text, [
        { ranges: rangesFor(card.underlines, paragraph), marks: [underline] },
        { ranges: rangesFor(card.emphasis, paragraph), marks: [emphasis] },
        { ranges: rangesFor(card.highlights, paragraph), marks: [highlight] },
      ]);
      return schema.nodes['card_body']!.create(null, nodes);
    });
  const cardNode = schema.nodes['card']!.createChecked(null, [tag, citePara, ...bodyParas]);
  return new Slice(Fragment.from(cardNode), 0, 0);
}

/** Select the body paragraphs of the card just before the caret. After
 *  `insertSpeechSlice`, the caret sits in the blank line it adds right
 *  after the inserted card, so that's the card this finds. A body-only
 *  selection is what Condense With Warning requires, and every other
 *  condense/shrink accepts it. False (selection untouched) when there's
 *  no card with a body right before the caret. */
export function selectInsertedCardBody(view: EditorView): boolean {
  const { state } = view;
  const $pos = state.selection.$from;
  if ($pos.depth < 1) return false;
  const parent = $pos.node($pos.depth - 1);
  const index = $pos.index($pos.depth - 1);
  if (index === 0) return false;
  const card = parent.child(index - 1);
  if (card.type.name !== 'card') return false;
  const cardStart = $pos.before($pos.depth) - card.nodeSize;
  let from = -1;
  let to = -1;
  card.forEach((child, offset) => {
    if (child.type.name !== 'card_body') return;
    const start = cardStart + 1 + offset;
    if (from < 0) from = start + 1;
    to = start + child.nodeSize - 1;
  });
  if (from < 0) return false;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  return true;
}

/** Put the caret `fromEnd` positions before the end of the document —
 *  used to return to the line after an inserted card once commands that
 *  only edit the card itself (before that line) have run. */
export function restoreCaretFromEnd(view: EditorView, fromEnd: number): void {
  const { doc } = view.state;
  const pos = Math.max(0, Math.min(doc.content.size, doc.content.size - fromEnd));
  view.dispatch(view.state.tr.setSelection(Selection.near(doc.resolve(pos))));
}
