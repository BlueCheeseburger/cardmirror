// @vitest-environment jsdom

/**
 * Live enclosing-container read time (`liveContainerReadTime`, default
 * on): the word-count readout's second segment shows the smallest
 * container enclosing the cursor — card, analytic unit, or block
 * section — or the selection's time when one exists. Pocket/hat
 * headings and loose doc-level content show nothing (design call,
 * 2026-07-26). With `liveSelectionWordCount` on, a selection is
 * already the primary readout, so the segment is dropped.
 *
 * Also the remaining read time (`liveRemainingReadTime`, default off):
 * the third segment counts the read-aloud words still ahead of the
 * cursor, off the per-doc suffix table.
 */

import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  findEnclosingContainer,
  liveContainerSegment,
  remainingReadSegment,
  primaryReadSegment,
} from '../../src/editor/live-read-time.js';
import { countReadAloudSplit, totalWords } from '../../src/editor/word-count.js';
import { settings } from '../../src/editor/settings.js';

function tag(text: string): PMNode {
  return schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(text));
}
function card(tagText: string, bodyText: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    tag(tagText),
    schema.nodes['card_body']!.create(null, schema.text(bodyText)),
  ]);
}
function analytic(tagText: string, bodyText: string): PMNode {
  return schema.nodes['analytic_unit']!.createChecked(null, [
    schema.nodes['analytic']!.create({ id: newHeadingId() }, schema.text(tagText)),
    schema.nodes['card_body']!.create(null, schema.text(bodyText)),
  ]);
}
function heading(type: 'pocket' | 'hat' | 'block', text: string): PMNode {
  return schema.nodes[type]!.create({ id: newHeadingId() }, schema.text(text));
}
function para(text: string): PMNode {
  return schema.nodes['paragraph']!.create(null, schema.text(text));
}

/** State with the cursor inside the text node containing `needle`. */
function stateAt(children: PMNode[], needle: string): EditorState {
  const doc = schema.nodes['doc']!.createChecked(null, children);
  let at = -1;
  doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isText && (node.text ?? '').includes(needle)) {
      at = pos + 1;
      return false;
    }
    return true;
  });
  if (at < 0) throw new Error(`text "${needle}" not found`);
  return EditorState.create({ doc, selection: TextSelection.create(doc, at) });
}

function textOfRange(state: EditorState, c: { from: number; to: number }): string {
  return state.doc.textBetween(c.from, c.to, ' ', ' ');
}

afterEach(() => {
  settings.set('liveContainerReadTime', true);
  settings.set('liveDocWordCount', true);
  settings.set('liveRemainingReadTime', false);
  settings.set('liveSelectionWordCount', false);
  settings.set('readers', [
    { name: 'Reader 1', wpm: 200 },
    { name: 'Reader 2', wpm: 250 },
  ]);
});

describe('findEnclosingContainer', () => {
  const children = [
    heading('pocket', 'Pocket A'),
    heading('hat', 'Hat A'),
    heading('block', 'Block One'),
    card('Alpha tag', 'alpha body'),
    para('loose analysis under block one'),
    heading('block', 'Block Two'),
    card('Beta tag', 'beta body'),
    analytic('Gamma analytic', 'gamma body'),
  ];

  it('cursor in a card body → the card', () => {
    const state = stateAt(children, 'alpha body');
    const c = findEnclosingContainer(state)!;
    expect(c.label).toBe('Card');
    expect(textOfRange(state, c)).toContain('Alpha tag');
    expect(textOfRange(state, c)).not.toContain('Block One');
  });

  it('cursor in an analytic unit → the unit, not the block', () => {
    const state = stateAt(children, 'gamma body');
    const c = findEnclosingContainer(state)!;
    expect(c.label).toBe('Analytic');
    expect(textOfRange(state, c)).toContain('Gamma analytic');
    expect(textOfRange(state, c)).not.toContain('Beta tag');
  });

  it('cursor in a loose paragraph under a block → the block section', () => {
    const state = stateAt(children, 'loose analysis');
    const c = findEnclosingContainer(state)!;
    expect(c.label).toBe('Block');
    const text = textOfRange(state, c);
    expect(text).toContain('Block One');
    expect(text).toContain('alpha body'); // section spans its cards
    expect(text).not.toContain('Block Two'); // ends at equal-level heading
  });

  it('cursor ON a block heading → its own section', () => {
    const state = stateAt(children, 'Block Two');
    const c = findEnclosingContainer(state)!;
    expect(c.label).toBe('Block');
    const text = textOfRange(state, c);
    expect(text).toContain('beta body');
    expect(text).toContain('gamma body'); // runs to end of doc
  });

  it('pocket / hat headings stay silent', () => {
    expect(findEnclosingContainer(stateAt(children, 'Pocket A'))).toBeNull();
    expect(findEnclosingContainer(stateAt(children, 'Hat A'))).toBeNull();
  });

  it('loose paragraph with no preceding block stays silent', () => {
    const state = stateAt(
      [heading('hat', 'Hat Solo'), para('orphan paragraph'), heading('block', 'Later Block')],
      'orphan paragraph',
    );
    expect(findEnclosingContainer(state)).toBeNull();
  });
});

describe('liveContainerSegment', () => {
  const children = [heading('block', 'Block One'), card('Alpha tag', 'alpha body two three')];

  it('renders label, count, and the first two readers', () => {
    settings.set('readers', [
      { name: 'Amy', wpm: 200 },
      { name: 'Ben', wpm: 100 },
      { name: 'Cal', wpm: 300 },
    ]);
    const seg = liveContainerSegment(stateAt(children, 'alpha body'))!;
    expect(seg).toMatch(/^Card: \d/);
    expect(seg).toContain('Amy: ');
    expect(seg).toContain('Ben: ');
    expect(seg).not.toContain('Cal'); // first two readers only
  });

  it('gates on the setting', () => {
    settings.set('liveContainerReadTime', false);
    expect(liveContainerSegment(stateAt(children, 'alpha body'))).toBeNull();
  });

  it('a selection shows Sel — unless liveSelectionWordCount already does', () => {
    const base = stateAt(children, 'alpha body');
    const sel = base.apply(
      base.tr.setSelection(
        TextSelection.create(base.doc, base.selection.from, base.selection.from + 5),
      ),
    );
    expect(liveContainerSegment(sel)).toMatch(/^Sel: \d/);
    settings.set('liveSelectionWordCount', true);
    expect(liveContainerSegment(sel)).toBeNull();
  });
});

describe('remainingReadSegment', () => {
  const m = schema.marks;
  const hl = () => m['highlight']!.create();
  const shaded = () => m['shading']!.create();

  /**
   * A doc whose top-level children mix every read-aloud kind with the
   * kinds that must NOT count — plain body text and shaded highlight.
   * Read-aloud totals: body 9 (4 + 2 + 3), other 7 (3 tag + 2 tag +
   * 2 cite) = 16, against 27 words of raw text.
   */
  function fixture(): PMNode[] {
    return [
      heading('block', 'Block One'),
      schema.nodes['card']!.createChecked(null, [
        tag('ALPHA TAG HERE'),
        schema.nodes['card_body']!.create(null, [
          schema.text('one two three four', [hl()]),
          schema.text(' plain unread words'),
          schema.text(' shaded skip here', [hl(), shaded()]),
        ]),
      ]),
      schema.nodes['paragraph']!.create(null, schema.text('five six', [hl()])),
      schema.nodes['card']!.createChecked(null, [
        tag('BETA TAG'),
        schema.nodes['cite_paragraph']!.create(null, [
          schema.text('Smith 25', [m['cite_mark']!.create()]),
          schema.text(' filler text here'),
        ]),
        schema.nodes['card_body']!.create(null, schema.text('seven eight nine', [hl()])),
      ]),
    ];
  }

  const doc = schema.nodes['doc']!.createChecked(null, fixture());

  /** Doc position where `needle` starts. */
  function textStart(node: PMNode, needle: string): number {
    let at = -1;
    node.descendants((child, pos) => {
      if (at >= 0) return false;
      const text = child.text ?? '';
      if (child.isText && text.includes(needle)) {
        at = pos + text.indexOf(needle);
        return false;
      }
      return true;
    });
    if (at < 0) throw new Error(`text "${needle}" not found`);
    return at;
  }

  function cursorAt(node: PMNode, pos: number): EditorState {
    return EditorState.create({ doc: node, selection: TextSelection.create(node, pos) });
  }

  /** The number the segment leads with. */
  function left(state: EditorState): number {
    const seg = remainingReadSegment(state);
    if (seg === null) throw new Error('segment is off');
    const match = /^Left: ([\d,]+) /.exec(seg);
    if (!match) throw new Error(`unexpected segment "${seg}"`);
    return Number(match[1]!.replace(/,/g, ''));
  }

  beforeEach(() => {
    settings.set('liveRemainingReadTime', true);
    settings.set('readers', [
      { name: 'Amy', wpm: 200 },
      { name: 'Ben', wpm: 100 },
      { name: 'Cal', wpm: 300 },
    ]);
  });

  it('gates on the setting', () => {
    settings.set('liveRemainingReadTime', false);
    expect(remainingReadSegment(cursorAt(doc, textStart(doc, 'five six')))).toBeNull();
  });

  it('renders label, count, and the first two readers', () => {
    const seg = remainingReadSegment(cursorAt(doc, textStart(doc, 'five six')))!;
    expect(seg).toMatch(/^Left: \d/);
    expect(seg).toContain('Amy: ');
    expect(seg).toContain('Ben: ');
    expect(seg).not.toContain('Cal'); // first two readers only
  });

  it('cursor at the doc start counts the whole doc', () => {
    const state = EditorState.create({ doc, selection: TextSelection.atStart(doc) });
    expect(left(state)).toBe(totalWords(countReadAloudSplit(doc)));
    expect(left(state)).toBe(16);
  });

  it('cursor at the doc end counts nothing', () => {
    const state = EditorState.create({ doc, selection: TextSelection.atEnd(doc) });
    expect(left(state)).toBe(0);
  });

  it('counts only read-aloud words ahead of the cursor', () => {
    // Mid-card: the rest of the highlighted run (4) + the loose
    // highlighted paragraph (2) + the last card's tag, cite, and body
    // (2 + 2 + 3).
    expect(left(cursorAt(doc, textStart(doc, 'one two three four')))).toBe(13);
    // Parked right before the plain text: what's left is the loose
    // paragraph and the last card — the plain run and the shaded
    // highlight after it are silent, exactly as the read-aloud
    // predicate says.
    expect(left(cursorAt(doc, textStart(doc, 'plain unread words')))).toBe(9);
    // Inside the last card's cite: the cite's own filler doesn't count,
    // the body after it does.
    expect(left(cursorAt(doc, textStart(doc, 'filler text here')))).toBe(3);
  });

  it('a selection measures from its end — what precedes it reads as read', () => {
    const from = textStart(doc, 'one two three four');
    const state = EditorState.create({
      doc,
      // Through "one two ", leaving "three four" of the run ahead.
      selection: TextSelection.create(doc, from, from + 8),
    });
    expect(left(state)).toBe(11);
    // …and NOT the 13 a from-anchored count would report.
    expect(left(cursorAt(doc, from))).toBe(13);
  });

  it('a node selection ends on a child boundary — everything after it is left', () => {
    // `to` lands between two top-level children (depth 0), the one
    // position the child-relative math has to clamp.
    const at = textStart(doc, 'five six') - 1;
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, at) });
    expect(left(state)).toBe(7); // just the last card
  });

  it('recounts after an edit — the suffix table is keyed on the doc', () => {
    const at = textStart(doc, 'five six');
    const before = cursorAt(doc, at);
    expect(left(before)).toBe(9);
    // Three more highlighted words, inserted AFTER the cursor so the
    // selection maps to the same place. A table surviving the edit
    // would still say 9.
    const insertAt = textStart(doc, 'seven eight nine');
    const after = before.apply(
      before.tr.replaceWith(insertAt, insertAt, schema.text('ten eleven twelve ', [hl()])),
    );
    expect(after.selection.from).toBe(at);
    expect(left(after)).toBe(12);
    // The original doc still counts 9 — rebuilding for the new doc
    // didn't poison the old answer.
    expect(left(cursorAt(doc, at))).toBe(9);
  });

  it('composes as the third segment, after the container one', () => {
    const state = cursorAt(doc, textStart(doc, 'one two three four'));
    const container = liveContainerSegment(state);
    const remaining = remainingReadSegment(state);
    expect(container).toMatch(/^Card: /);
    expect(remaining).toMatch(/^Left: /);
    // The bars join in scope order, skipping whatever is off (the join
    // itself lives in index.ts / multi-pane-shell.ts).
    const segments = ['Doc: 16 · Amy: 0:04 · Ben: 0:09', container, remaining].filter(
      (s): s is string => s !== null,
    );
    expect(segments.join(' | ')).toMatch(/^Doc: .+ \| Card: .+ \| Left: .+$/);
    // Container off, remaining on → two segments, still in order.
    settings.set('liveContainerReadTime', false);
    expect(liveContainerSegment(state)).toBeNull();
    expect(remainingReadSegment(state)).toMatch(/^Left: /);
  });
});

describe('primaryReadSegment (the whole-document readout)', () => {
  const doc = schema.nodes['doc']!.createChecked(null, [card('Tag one', 'alpha bravo charlie'), card('Tag two', 'delta echo')]);
  const counts = () => countReadAloudSplit(doc);

  it('labels the whole-doc side "Doc:" only while the container segment is on', () => {
    expect(primaryReadSegment(counts(), { selection: false, selectionLabel: 'Selection' })).toMatch(/^Doc: \d/);
    settings.set('liveContainerReadTime', false);
    expect(primaryReadSegment(counts(), { selection: false, selectionLabel: 'Selection' })).toMatch(/^\d/);
  });

  it('turning the whole-doc readout off drops the segment entirely', () => {
    settings.set('liveDocWordCount', false);
    expect(primaryReadSegment(counts(), { selection: false, selectionLabel: 'Selection' })).toBeNull();
    expect(primaryReadSegment(counts(), { selection: false, selectionLabel: 'Sel' })).toBeNull();
  });

  it('a live selection still shows with the whole-doc readout off', () => {
    settings.set('liveDocWordCount', false);
    expect(primaryReadSegment(counts(), { selection: true, selectionLabel: 'Selection' })).toMatch(/^Selection: \d/);
    expect(primaryReadSegment(counts(), { selection: true, selectionLabel: 'Sel' })).toMatch(/^Sel: \d/);
  });

  it('carries the first two readers, like every other segment', () => {
    const seg = primaryReadSegment(counts(), { selection: false, selectionLabel: 'Selection' })!;
    expect(seg).toContain('Reader 1:');
    expect(seg).toContain('Reader 2:');
    expect(seg.split(' · ')).toHaveLength(3);
  });
});
