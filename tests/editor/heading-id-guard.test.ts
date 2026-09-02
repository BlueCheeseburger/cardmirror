/**
 * Heading-id integrity guard (field forensics 2026-08-31): repairs the
 * two ProseMirror-internal doors that mint id violations — replace-
 * splits copying a heading's id onto both halves, and fillBefore
 * synthesizing a required card/analytic head with a null id — on the
 * offending LOCAL transaction, with a provenance-aware keeper.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Slice } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { loroSyncPluginKey } from 'loro-prosemirror';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { headingIdGuardPlugin } from '../../src/editor/heading-id-guard.js';

const n = schema.nodes;
const block = (id: string, text: string) => n['block']!.create({ id }, schema.text(text));
const para = (text: string) => n['paragraph']!.create(null, schema.text(text));
const card = (id: string, tagText: string, body: string) =>
  n['card']!.createChecked(null, [
    n['tag']!.create({ id }, schema.text(tagText)),
    n['card_body']!.create(null, schema.text(body)),
  ]);

function withGuard(doc: PMNode): EditorState {
  return EditorState.create({ doc, plugins: [headingIdGuardPlugin] });
}
function headings(doc: PMNode): Array<{ type: string; id: unknown; text: string }> {
  const out: Array<{ type: string; id: unknown; text: string }> = [];
  doc.descendants((node) => {
    if (['pocket', 'hat', 'block', 'tag', 'analytic'].includes(node.type.name)) {
      out.push({ type: node.type.name, id: node.attrs['id'], text: node.textContent });
    }
    return true;
  });
  return out;
}
function assertInvariant(doc: PMNode): void {
  const hs = headings(doc);
  for (const h of hs) expect(h.id, `${h.type}:"${h.text}"`).toBeTypeOf('string');
  const ids = hs.map((h) => String(h.id));
  expect(new Set(ids).size).toBe(ids.length);
}

describe('headingIdGuardPlugin', () => {
  it('a replace-split heading gets its copy re-minted; the original keeps its id', () => {
    const C = newHeadingId();
    const state = withGuard(
      n['doc']!.createChecked(null, [block(C, 'Dedev Turn--Sust---AT: CO2'), para('after')]),
    );
    // Paste two paragraphs into the middle of the block header — PM's
    // fit splits the header around them, copying attrs onto both
    // halves (the field bug's minting mechanism).
    const open = new Slice(
      n['doc']!.createChecked(null, [para('one'), para('two')]).content,
      1,
      1,
    );
    const mid = 1 + 'Dedev Turn--'.length;
    let s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, mid)));
    s = s.apply(s.tr.replaceSelection(open));
    assertInvariant(s.doc);
    const hs = headings(s.doc);
    const bearers = hs.filter((h) => h.id === C);
    expect(bearers.length).toBe(1);
    // Provenance: the FIRST half is where the original mapped — it keeps.
    expect(bearers[0]!.text.startsWith('Dedev Turn--')).toBe(true);
  });

  it('pasting a copy ABOVE its original re-ids the copy, not the original', () => {
    const X = newHeadingId();
    const state = withGuard(n['doc']!.createChecked(null, [para('lead'), block(X, 'Original')]));
    // Simulate an unguarded door: insert a same-id copy BEFORE the
    // original in one transaction.
    const s = state.apply(state.tr.insert(0, block(X, 'The Copy')));
    assertInvariant(s.doc);
    const hs = headings(s.doc);
    expect(hs.map((h) => h.text)).toEqual(['The Copy', 'Original']);
    expect(hs[1]!.id).toBe(X); // original keeps
    expect(hs[0]!.id).not.toBe(X); // the copy was re-minted
  });

  it('a fit-synthesized required head gets a fresh id stamped', () => {
    const T = newHeadingId();
    const base = n['doc']!.createChecked(null, [para('hello there'), card(T, 'The Tag', 'body text')]);
    // Find a delete range that makes PM synthesize a card head with a
    // null id (search a few shapes so schema tweaks can't silently
    // void the test — the NO-guard state must show the violation).
    const bare = EditorState.create({ doc: base });
    let found: { from: number; to: number } | null = null;
    outer: for (let from = 1; from < 12 && !found; from++) {
      for (let to = from + 2; to < base.content.size - 2; to++) {
        try {
          const probe = bare.apply(bare.tr.deleteRange(from, to));
          if (headings(probe.doc).some((h) => typeof h.id !== 'string' || !h.id)) {
            found = { from, to };
            break outer;
          }
        } catch {
          /* unfittable shape — keep searching */
        }
      }
    }
    expect(found, 'no fill-synthesizing delete shape found — schema changed?').not.toBeNull();
    const s = withGuard(base);
    const fixed = s.apply(s.tr.deleteRange(found!.from, found!.to));
    assertInvariant(fixed.doc);
  });

  it('plain typing passes through untouched (ids identical)', () => {
    const A = newHeadingId();
    const state = withGuard(n['doc']!.createChecked(null, [block(A, 'Header'), para('text')]));
    const s = state.apply(state.tr.insertText('x', 3, 3));
    expect(headings(s.doc).map((h) => h.id)).toEqual([A]);
  });

  it('remote (loro-sync) transactions are NOT policed — mixed-version safety', () => {
    const X = newHeadingId();
    const state = withGuard(n['doc']!.createChecked(null, [block(X, 'Original')]));
    const tr = state.tr.insert(0, block(X, 'Remote Copy'));
    tr.setMeta((loroSyncPluginKey as unknown as { key: string }).key, { type: 'non-local-updates' });
    const s = state.apply(tr);
    // The duplicate stays (heals at next file open, as today).
    const ids = headings(s.doc).map((h) => h.id);
    expect(ids).toEqual([X, X]);
  });

  it('pins the loro-sync meta key string the guard matches', () => {
    expect((loroSyncPluginKey as unknown as { key: string }).key).toBe('loro-sync$');
  });
});
