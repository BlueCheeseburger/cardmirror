/**
 * Reading view (paginated columns) — the testable core: column math,
 * wheel-input paging, and the transaction lock (marker edits only, NO
 * drag exception, sync/normalizer pass, combinable with read mode).
 * Layout/flip mechanics live in the DOM controller and are verified
 * in the dev build.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  computeReaderLayout,
  pageCount,
  pageOfOffset,
  WheelPager,
  readerViewPlugin,
  PMD_READER_VIEW_TOGGLE,
  READER_IDEAL_COL,
} from '../../src/editor/reader-view.js';
import { READING_MARKER_META, READ_MODE_UNDO_META } from '../../src/editor/reading-marker.js';
import { READ_MODE_DRAG_META } from '../../src/editor/reading-marker.js';
import { NORMALIZER_META } from '../../src/editor/normalizer-guard.js';

describe('computeReaderLayout', () => {
  it('narrow pane (three-pane third) → one column', () => {
    expect(computeReaderLayout(480, 0).count).toBe(1);
  });
  it('laptop-width pane → two columns', () => {
    const l = computeReaderLayout(1440, 0);
    expect(l.count).toBe(2);
    expect(l.stride).toBe(l.count * (l.colW + l.gap));
  });
  it('very wide pane clamps at three columns', () => {
    expect(computeReaderLayout(4000, 0).count).toBe(3);
  });
  it('the accessibility cap is a hard max column width', () => {
    const l = computeReaderLayout(900, 380);
    expect(l.count).toBe(1);
    expect(l.colW).toBe(380); // never stretched past the cap
  });
  it('a narrow cap lets more columns fit', () => {
    expect(computeReaderLayout(1300, 0).count).toBe(2);
    expect(computeReaderLayout(1300, 300).count).toBe(3);
    expect(computeReaderLayout(1300, 300).colW).toBeLessThanOrEqual(300);
  });
  it('columns never fall below the readable minimum', () => {
    const l = computeReaderLayout(200, 0);
    expect(l.count).toBe(1);
    expect(l.colW).toBeGreaterThan(0);
  });
  it('ideal column default holds when uncapped', () => {
    const l = computeReaderLayout(READER_IDEAL_COL + 96, 0);
    expect(l.count).toBe(1);
  });
});

describe('page math', () => {
  it('page count rounds up and never reports zero', () => {
    expect(pageCount(0, 600)).toBe(1);
    expect(pageCount(601, 600)).toBe(2);
    expect(pageCount(1800, 600)).toBe(3);
  });
  it('offset → page', () => {
    expect(pageOfOffset(0, 600)).toBe(0);
    expect(pageOfOffset(599, 600)).toBe(0);
    expect(pageOfOffset(600, 600)).toBe(1);
  });
});

describe('WheelPager', () => {
  it('a classic detent flips immediately; cooldown absorbs the tail', () => {
    const p = new WheelPager(90, 220);
    expect(p.feed(120, 0)).toBe(1); // one detent
    expect(p.feed(120, 100)).toBe(0); // still cooling
    expect(p.feed(120, 300)).toBe(1); // next detent after cooldown
  });
  it('trackpad deltas accumulate to ONE flip per swipe', () => {
    const p = new WheelPager(90, 220);
    let flips = 0;
    // A swipe: many small deltas over ~150ms.
    for (let t = 0; t <= 150; t += 10) flips += Math.abs(p.feed(14, t));
    expect(flips).toBe(1);
  });
  it('direction follows the accumulated sign', () => {
    const p = new WheelPager(90, 220);
    expect(p.feed(-120, 0)).toBe(-1);
  });
});

describe('reader lock (filterTransaction)', () => {
  const n = schema.nodes;
  function state(on: boolean): EditorState {
    const doc = n['doc']!.createChecked(null, [
      n['card']!.createChecked(null, [
        n['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
        n['card_body']!.create(null, schema.text('body text')),
      ]),
    ]);
    let s = EditorState.create({ doc, plugins: [readerViewPlugin] });
    if (on) s = s.apply(s.tr.setMeta(PMD_READER_VIEW_TOGGLE, true));
    return s;
  }

  it('typing is blocked while the view is on, allowed while off', () => {
    const on = state(true);
    const before = on.doc;
    const after = on.apply(on.tr.insertText('x', 3, 3));
    expect(after.doc.eq(before)).toBe(true); // filtered out
    const off = state(false);
    expect(off.apply(off.tr.insertText('x', 3, 3)).doc.eq(off.doc)).toBe(false);
  });

  it('reading-marker and marker-undo transactions pass', () => {
    const on = state(true);
    for (const meta of [READING_MARKER_META, READ_MODE_UNDO_META, NORMALIZER_META]) {
      const tr = on.tr.insertText('x', 3, 3).setMeta(meta, true);
      expect(on.apply(tr).doc.eq(on.doc)).toBe(false);
    }
  });

  it("read mode's DRAG exception does NOT exist here", () => {
    const on = state(true);
    const tr = on.tr.insertText('x', 3, 3).setMeta(READ_MODE_DRAG_META, true);
    expect(on.apply(tr).doc.eq(on.doc)).toBe(true); // still blocked
  });

  it('selection-only transactions pass (caret stays placeable for markers)', () => {
    const on = state(true);
    const moved = on.apply(on.tr.setSelection(TextSelection.create(on.doc, 4)));
    expect(moved.selection.from).toBe(4);
  });

  it('the toggle meta flips per-view state', () => {
    let s = state(true);
    s = s.apply(s.tr.setMeta(PMD_READER_VIEW_TOGGLE, false));
    expect(s.apply(s.tr.insertText('x', 3, 3)).doc.eq(s.doc)).toBe(false);
  });
});
