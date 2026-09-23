/**
 * Copy All Cards With Matching Cite (copy-matching-cite.ts): what the
 * selection asks for, which cards answer, in what order, with numbering
 * cleared.
 */
import { describe, it, expect } from 'vitest';
import { TextSelection, EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { citeQueryFromSelection, cardsWithMatchingCite, collectCardsWithMatchingCite, normalizeCiteText } from '../../src/editor/copy-matching-cite.js';

const citeMark = schema.marks['cite_mark']!.create();
function card(tag: string, cite: string | null, opts: { role?: string; body?: string; analytic?: boolean } = {}): PMNode {
  const heading = opts.analytic
    ? schema.nodes['analytic']!.create({ id: newHeadingId() }, schema.text(tag))
    : schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag));
  const children: PMNode[] = [heading];
  if (cite !== null) {
    // First word carries the cite mark, as a real cite does.
    const [lead, ...rest] = cite.split(' ');
    const inl = [schema.text(lead!, [citeMark])];
    if (rest.length) inl.push(schema.text(' ' + rest.join(' ')));
    children.push(schema.nodes['cite_paragraph']!.create(null, inl));
  }
  children.push(schema.nodes['card_body']!.create(null, schema.text(opts.body ?? 'body text')));
  const type = opts.analytic ? 'analytic_unit' : 'card';
  return schema.nodes[type]!.createChecked({ numRole: opts.role ?? 'number', numRestart: opts.role === 'number' }, children);
}
const doc = (...c: PMNode[]) => schema.nodes['doc']!.create(null, c);
/** Position of the first character of the n-th cite paragraph. */
function citeStart(d: PMNode, n: number): number {
  let seen = 0;
  let out = -1;
  d.descendants((node, pos) => {
    if (out >= 0) return false;
    if (node.type.name === 'cite_paragraph') {
      if (seen === n) out = pos + 1;
      seen++;
    }
    return out < 0;
  });
  return out;
}
const tagsOf = (cards: PMNode[]) => cards.map((c) => c.child(0).textContent);
const sel = (d: PMNode, from: number, to = from) => TextSelection.create(d, from, to);

const SMITH = 'Smith 24, Journal of Things, https://example.org/smith';
const D = doc(
  card('A', SMITH),
  card('B', 'Jones 23, Other Journal', { role: 'sub' }),
  card('C', 'smith 24,  Journal of Things, https://example.org/smith'), // case + spacing differ
  card('D', null),
  card('E', 'Smith 24, Journal of Things, https://example.org/other'),
  card('F', 'Lee 22, Journal of Things', { analytic: true }),
);

describe('citeQueryFromSelection', () => {
  it('a cursor in a cite asks for cards with the same cite', () => {
    const q = citeQueryFromSelection(D, sel(D, citeStart(D, 0) + 3));
    expect(q).toEqual({ needle: normalizeCiteText(SMITH), whole: true });
  });

  it('a selection of part of a cite asks for cards containing it', () => {
    const s = citeStart(D, 0);
    const q = citeQueryFromSelection(D, sel(D, s, s + 8)); // "Smith 24"
    expect(q).toEqual({ needle: 'smith 24', whole: false });
  });

  it('a selection past the cite counts only the part inside it; a whole card is the whole cite', () => {
    const s = citeStart(D, 0);
    const cite = D.nodeAt(s - 1)!;
    // From mid-cite through the body: just the cite tail.
    const q = citeQueryFromSelection(D, sel(D, s + 10, s + cite.content.size + 6));
    expect(q!.whole).toBe(false);
    expect(q!.needle).toBe(normalizeCiteText(SMITH.slice(10)));
    // The whole first card selected: equality on its cite.
    const q2 = citeQueryFromSelection(D, sel(D, 1, D.child(0).nodeSize - 1));
    expect(q2).toEqual({ needle: normalizeCiteText(SMITH), whole: true });
  });

  it('touching no cite asks for nothing', () => {
    const bodyPos = D.child(0).nodeSize - 3; // inside card A's body
    expect(D.resolve(bodyPos).parent.type.name).toBe('card_body');
    expect(citeQueryFromSelection(D, sel(D, bodyPos))).toBeNull();
    expect(citeQueryFromSelection(D, sel(D, bodyPos - 2, bodyPos))).toBeNull();
    expect(citeQueryFromSelection(D, sel(D, 2))).toBeNull(); // in the tag
  });
});

describe('cardsWithMatchingCite', () => {
  it('equality: folds case and whitespace, keeps document order, clears numbering', () => {
    const cards = cardsWithMatchingCite(D, { needle: normalizeCiteText(SMITH), whole: true });
    expect(tagsOf(cards)).toEqual(['A', 'C']);
    for (const c of cards) {
      expect(c.attrs['numRole']).toBe('none');
      expect(c.attrs['numRestart']).toBe(false);
    }
    // The document itself is untouched.
    expect(D.child(0).attrs['numRole']).toBe('number');
  });

  it('containment: any card whose cite contains the text, analytic units included', () => {
    expect(tagsOf(cardsWithMatchingCite(D, { needle: 'journal of things', whole: false }))).toEqual(['A', 'C', 'E', 'F']);
    expect(tagsOf(cardsWithMatchingCite(D, { needle: 'https://example.org/smith', whole: false }))).toEqual(['A', 'C']);
    expect(tagsOf(cardsWithMatchingCite(D, { needle: 'nobody', whole: false }))).toEqual([]);
  });

  it('folds curly quotes and dashes like Find', () => {
    const d = doc(card('A', 'O’Neil 24 — “Title”'), card('B', "O'Neil 24 - \"Title\""));
    expect(tagsOf(cardsWithMatchingCite(d, { needle: normalizeCiteText('O\'Neil 24 - "Title"'), whole: true }))).toEqual(['A', 'B']);
  });

  it('end to end from an editor selection', () => {
    // Card D has no cite, so E's cite paragraph is the fourth (index 3).
    const state = EditorState.create({ doc: D, selection: sel(D, citeStart(D, 3) + 1) });
    const found = collectCardsWithMatchingCite(state.doc, state.selection)!;
    expect(found.query.whole).toBe(true);
    expect(tagsOf(found.cards)).toEqual(['E']);
    expect(collectCardsWithMatchingCite(state.doc, sel(D, 2))).toBeNull();
  });
});
