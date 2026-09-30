/**
 * Unhighlight Card / Rehighlight Card: strip a card's highlighting in one
 * undoable step, and put it back while that step is still in the undo
 * history.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { history, undo, redo } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  cardHighlightPlugin,
  cardHighlightAction,
  cardRangesForSelection,
  unhighlightCard,
  rehighlightCard,
  unhighlightRanges,
  rehighlightRanges,
} from '../../src/editor/card-highlight-toggle.js';

const mark = (name: string, attrs?: Record<string, unknown>) => schema.marks[name]!.create(attrs);
const yellow = () => mark('highlight', { color: 'yellow' });
const green = () => mark('highlight', { color: 'green' });
const text = (t: string, ...marks: ReturnType<typeof mark>[]) => schema.text(t, marks);

function card(tagText: string, ...bodies: PMNode[][]): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tagText)),
    ...bodies.map((inlines) => schema.nodes['card_body']!.create(null, inlines)),
  ]);
}
const docOf = (...children: PMNode[]): PMNode => schema.nodes['doc']!.createChecked(null, children);

function stateFor(doc: PMNode, cursorInside = 3): EditorState {
  let state = EditorState.create({ doc, plugins: [history(), cardHighlightPlugin()] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursorInside)));
  return state;
}

function run(state: EditorState, cmd: (s: EditorState, d?: (tr: Transaction) => void) => boolean): EditorState | null {
  let next: EditorState | null = null;
  const ok = cmd(state, (tr) => {
    next = state.apply(tr);
  });
  return ok ? next : null;
}

/** Document position of the first text node containing `needle`, at the needle. */
function posOf(doc: PMNode, needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return true;
    const i = node.text!.indexOf(needle);
    if (i >= 0) found = pos + i;
    return true;
  });
  if (found < 0) throw new Error(`"${needle}" not in the document`);
  return found;
}

/** The highlight color on the text `needle`, or null when it has none. */
function colorOf(doc: PMNode, needle: string): string | null {
  const node = doc.nodeAt(posOf(doc, needle))!;
  const hl = node.marks.find((m) => m.type === schema.marks['highlight']);
  return hl ? String(hl.attrs['color']) : null;
}

/** Highlight colors by text run, e.g. ['warrant:yellow', 'rest:-']. */
function highlights(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (!node.isText) return true;
    const hl = node.marks.find((m) => m.type === schema.marks['highlight']);
    out.push(`${node.text}:${hl ? String(hl.attrs['color']) : '-'}`);
    return true;
  });
  return out;
}

const sample = (): PMNode =>
  docOf(
    card('Tag one', [text('lead '), text('warrant', yellow()), text(' middle '), text('claim', green()), text(' tail')]),
    card('Tag two', [text('other ', yellow()), text('words')]),
  );

describe('Unhighlight Card', () => {
  it('strips every highlight in the card at the cursor and leaves other cards alone', () => {
    const next = run(stateFor(sample()), unhighlightCard())!;
    expect(next).not.toBeNull();
    const list = highlights(next.doc);
    expect(list.filter((r) => r.startsWith('warrant') || r.startsWith('claim')).every((r) => r.endsWith(':-'))).toBe(true);
    // The second card keeps its highlight.
    expect(list).toContain('other :yellow');
  });

  it('keeps other marks on the text it unhighlights', () => {
    const bold = mark('bold');
    const doc = docOf(card('T', [text('bold lit', yellow(), bold)]));
    const next = run(stateFor(doc), unhighlightCard())!;
    let seen = false;
    next.doc.descendants((n) => {
      if (n.isText && n.text === 'bold lit') {
        seen = true;
        expect(n.marks.some((m) => m.type === schema.marks['bold'])).toBe(true);
        expect(n.marks.some((m) => m.type === schema.marks['highlight'])).toBe(false);
      }
      return true;
    });
    expect(seen).toBe(true);
  });

  it('does nothing when the card has no highlighting, or the cursor is outside a card', () => {
    const plain = docOf(card('T', [text('no marks here')]));
    expect(run(stateFor(plain), unhighlightCard())).toBeNull();
    const loose = docOf(schema.nodes['paragraph']!.create(null, text('loose', yellow())));
    expect(run(stateFor(loose, 2), unhighlightCard())).toBeNull();
  });

  it('is one undo step', () => {
    const start = stateFor(sample());
    const next = run(start, unhighlightCard())!;
    let undone: EditorState = next;
    undo(next, (tr) => {
      undone = next.apply(tr);
    });
    expect(highlights(undone.doc)).toEqual(highlights(start.doc));
  });

  it('a selection across two cards covers both', () => {
    let state = stateFor(sample());
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, state.doc.content.size - 3)));
    expect(cardRangesForSelection(state)).toHaveLength(1); // adjacent cards merge into one span
    const next = run(state, unhighlightCard())!;
    expect(highlights(next.doc).some((r) => r.endsWith(':yellow') || r.endsWith(':green'))).toBe(false);
  });
});

describe('Rehighlight Card', () => {
  it('puts back each highlight in its own color', () => {
    const start = stateFor(sample());
    const unhl = run(start, unhighlightCard())!;
    const back = run(unhl, rehighlightCard())!;
    expect(back).not.toBeNull();
    expect(highlights(back.doc)).toEqual(highlights(start.doc));
  });

  it('is offered exactly when the card has no highlighting and a stash is live', () => {
    const start = stateFor(sample());
    const ranges = cardRangesForSelection(start);
    expect(cardHighlightAction(start, ranges)).toBe('unhighlight');
    const unhl = run(start, unhighlightCard())!;
    expect(cardHighlightAction(unhl, ranges)).toBe('rehighlight');
    const back = run(unhl, rehighlightCard())!;
    expect(cardHighlightAction(back, ranges)).toBe('unhighlight');
    // A card that never had any: nothing to offer.
    const plain = stateFor(docOf(card('T', [text('plain')])));
    expect(cardHighlightAction(plain, cardRangesForSelection(plain))).toBeNull();
  });

  it('has nothing to restore without an earlier unhighlight', () => {
    expect(run(stateFor(sample()), rehighlightCard())).toBeNull();
  });

  it('lands on the right text after edits elsewhere in the card', () => {
    const unhl = run(stateFor(sample()), unhighlightCard())!;
    // Type at the very start of the tag, well before the stashed spans.
    const typed = unhl.apply(unhl.tr.insertText('NEW ', 2));
    const back = run(typed, rehighlightCard())!;
    expect(colorOf(back.doc, 'warrant')).toBe('yellow');
    expect(colorOf(back.doc, 'claim')).toBe('green');
  });

  it('does not overwrite a highlight applied since', () => {
    const unhl = run(stateFor(sample()), unhighlightCard())!;
    // Re-highlight "warrant" in another color by hand.
    const from = posOf(unhl.doc, 'warrant');
    const hand = unhl.apply(unhl.tr.addMark(from, from + 'warrant'.length, mark('highlight', { color: 'cyan' })));
    const back = run(hand, rehighlightCard())!;
    expect(colorOf(back.doc, 'warrant')).toBe('cyan');
    expect(colorOf(back.doc, 'claim')).toBe('green');
  });

  it('drops highlights whose text was deleted', () => {
    const unhl = run(stateFor(sample()), unhighlightCard())!;
    const from = posOf(unhl.doc, 'claim');
    const cut = unhl.apply(unhl.tr.delete(from, from + 'claim'.length));
    const back = run(cut, rehighlightCard())!;
    expect(colorOf(back.doc, 'warrant')).toBe('yellow');
    expect(back.doc.textContent).not.toContain('claim');
    // Nothing got highlighted in the gap the deletion closed.
    expect(highlights(back.doc).filter((r) => r.endsWith(':green'))).toEqual([]);
  });

  it('a second unhighlight after a rehighlight stashes again', () => {
    const a = run(stateFor(sample()), unhighlightCard())!;
    const b = run(a, rehighlightCard())!;
    const c = run(b, unhighlightCard())!;
    expect(cardHighlightAction(c, cardRangesForSelection(c))).toBe('rehighlight');
    expect(highlights(run(c, rehighlightCard())!.doc)).toContain('warrant:yellow');
  });
});

describe('only while the unhighlight is in the undo history', () => {
  it('undoing the unhighlight drops the stash for good — even after new edits or a redo', () => {
    const start = stateFor(sample());
    const ranges = cardRangesForSelection(start);
    const unhl = run(start, unhighlightCard())!;
    let undone: EditorState = unhl;
    undo(unhl, (tr) => {
      undone = unhl.apply(tr);
    });
    // The highlighting is back, so the menu offers Unhighlight.
    expect(cardHighlightAction(undone, ranges)).toBe('unhighlight');
    // A new edit pushes the history depth back up — it must not revive the stash.
    const stripped = undone.apply(undone.tr.removeMark(0, undone.doc.content.size, schema.marks['highlight']!));
    expect(run(stripped, rehighlightCard())).toBeNull();
    // Nor does redoing the unhighlight.
    let redone: EditorState = undone;
    redo(undone, (tr) => {
      redone = undone.apply(tr);
    });
    expect(colorOf(redone.doc, 'warrant')).toBeNull();
    expect(cardHighlightAction(redone, ranges)).toBeNull();
  });

  it('a fresh state — the document closed and reopened — has no stash', () => {
    const unhl = run(stateFor(sample()), unhighlightCard())!;
    const reopened = stateFor(unhl.doc);
    expect(run(reopened, rehighlightCard())).toBeNull();
  });

  it('a reconfigure that keeps the history (collab or settings rebuilds the plugin list) keeps the stash', () => {
    const unhl = run(stateFor(sample()), unhighlightCard())!;
    const rebuilt = unhl.reconfigure({ plugins: [history(), cardHighlightPlugin()] });
    expect(cardHighlightAction(rebuilt, cardRangesForSelection(rebuilt))).toBe('rehighlight');
  });

  it('a history that goes away (undo handed to a collaboration session) ends the stash', () => {
    const unhl = run(stateFor(sample()), unhighlightCard())!;
    const noHistory = unhl.reconfigure({ plugins: [cardHighlightPlugin()] });
    expect(cardHighlightAction(noHistory, cardRangesForSelection(noHistory))).toBeNull();
  });

  it('survives edits made after it (the history only grows)', () => {
    const unhl = run(stateFor(sample()), unhighlightCard())!;
    let s = unhl;
    for (let i = 0; i < 3; i++) {
      s = s.apply(s.tr.insertText('x', 2).setMeta('addToHistory', true));
    }
    expect(cardHighlightAction(s, cardRangesForSelection(s))).toBe('rehighlight');
  });
});

describe('range-based use (the outline menu)', () => {
  it('unhighlights every card under a section and rehighlights them together', () => {
    const start = stateFor(sample());
    const whole = [{ from: 0, to: start.doc.content.size }];
    const unhl = run(start, unhighlightRanges(whole))!;
    expect(highlights(unhl.doc).some((r) => r.endsWith(':yellow') || r.endsWith(':green'))).toBe(false);
    expect(cardHighlightAction(unhl, whole)).toBe('rehighlight');
    const back = run(unhl, rehighlightRanges(whole))!;
    expect(highlights(back.doc)).toEqual(highlights(start.doc));
  });

  it('rehighlighting one card leaves the other card unhighlighted', () => {
    const start = stateFor(sample());
    const whole = [{ from: 0, to: start.doc.content.size }];
    const unhl = run(start, unhighlightRanges(whole))!;
    const firstCard = { from: 0, to: unhl.doc.child(0).nodeSize };
    const back = run(unhl, rehighlightRanges([firstCard]))!;
    expect(colorOf(back.doc, 'warrant')).toBe('yellow');
    expect(colorOf(back.doc, 'other')).toBeNull();
    // The second card's stash is still there for a later rehighlight.
    const second = { from: firstCard.to, to: back.doc.content.size };
    expect(cardHighlightAction(back, [second])).toBe('rehighlight');
  });
});
