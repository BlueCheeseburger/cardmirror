import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  formatMarkerTime,
  isReadingMarkerColor,
  readingMarkerRunAt,
  buildInsertReadingMarkerTransaction,
  buildToggleReadingMarkerTransaction,
  buildMarkCardsTransaction,
  cardMarkAction,
  markerLabel,
  markCardsCommand,
  computeMarkInfo,
  READING_MARKER_COLOR,
  READING_MARKER_META,
  READ_MODE_DRAG_META,
} from '../../src/editor/reading-marker.js';
import { history } from 'prosemirror-history';
import {
  readModePlugin,
  PMD_READ_MODE_TOGGLE,
  readModeAwareUndo,
  readModeAwareRedo,
} from '../../src/editor/read-mode-plugin.js';

function tag(text: string) { return schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(text)); }
function cardBody(text: string) { return schema.nodes['card_body']!.create(null, schema.text(text)); }
function card(...c: any[]) { return schema.nodes['card']!.createChecked(null, c); }
function makeDoc(...c: any[]) { return schema.nodes['doc']!.createChecked(null, c); }

const NOW = new Date(2024, 0, 1, 7, 32);

function cursorAt(doc: any, text: string, offset: number): EditorState {
  let pos = -1;
  doc.descendants((n: any, p: number) => { if (n.isText && n.text === text) pos = p + offset; return true; });
  const base = EditorState.create({ doc });
  return base.apply(base.tr.setSelection(TextSelection.create(base.doc, pos)));
}

function markerText(doc: any): { text: string; color: string | undefined } | null {
  let found: { text: string; color: string | undefined } | null = null;
  doc.descendants((n: any) => {
    if (n.isText && n.text?.startsWith('Marked')) {
      const fc = n.marks.find((m: any) => m.type.name === 'font_color');
      found = { text: n.text, color: fc?.attrs['color'] };
    }
    return true;
  });
  return found;
}

describe('formatMarkerTime', () => {
  it('formats as h:mm, 12-hour, no leading zero on the hour', () => {
    expect(formatMarkerTime(new Date(2024, 0, 1, 7, 32))).toBe('7:32');
    expect(formatMarkerTime(new Date(2024, 0, 1, 19, 5))).toBe('7:05');
    expect(formatMarkerTime(new Date(2024, 0, 1, 0, 0))).toBe('12:00');
  });
});

describe('isReadingMarkerColor', () => {
  it('matches the marker red case-insensitively', () => {
    expect(isReadingMarkerColor('FF0000')).toBe(true);
    expect(isReadingMarkerColor('ff0000')).toBe(true);
    expect(isReadingMarkerColor('000000')).toBe(false);
    expect(isReadingMarkerColor(undefined)).toBe(false);
  });
});

describe('reading marker toggle', () => {
  it('inserts a red "Marked h:mm" run when the cursor is on plain text', () => {
    const state = cursorAt(makeDoc(card(tag('TAG'), cardBody('hello world'))), 'hello world', 5);
    const tr = buildToggleReadingMarkerTransaction(state, NOW)!;
    const next = state.apply(tr);
    const m = markerText(next.doc);
    expect(m).toEqual({ text: 'Marked 7:32', color: READING_MARKER_COLOR });
    expect((next.storedMarks ?? []).some((mk) => mk.type.name === 'font_color')).toBe(false);
  });

  it('removes the marker when the cursor is on an existing one (toggle off)', () => {
    // Insert one, then toggle again at the caret (which lands after it).
    const state = cursorAt(makeDoc(card(tag('TAG'), cardBody('hello world'))), 'hello world', 5);
    const afterInsert = state.apply(buildToggleReadingMarkerTransaction(state, NOW)!);
    expect(markerText(afterInsert.doc)).not.toBeNull();
    // Caret is right after the marker → run is detected.
    expect(readingMarkerRunAt(afterInsert)).not.toBeNull();
    const afterRemove = afterInsert.apply(buildToggleReadingMarkerTransaction(afterInsert, NOW)!);
    expect(markerText(afterRemove.doc)).toBeNull();
    // Original text is intact.
    expect(afterRemove.doc.textContent).toBe('TAGhello world');
  });

  it('readingMarkerRunAt is null when the cursor is on plain text', () => {
    const state = cursorAt(makeDoc(card(tag('TAG'), cardBody('hello world'))), 'hello world', 5);
    expect(readingMarkerRunAt(state)).toBeNull();
  });

  it('buildInsertReadingMarkerTransaction always inserts (no toggle)', () => {
    const state = cursorAt(makeDoc(card(tag('TAG'), cardBody('x'))), 'x', 1);
    const next = state.apply(buildInsertReadingMarkerTransaction(state, NOW)!);
    expect(markerText(next.doc)?.text).toBe('Marked 7:32');
  });
});

describe('read mode edit lock (filterTransaction)', () => {
  function readModeState(text: string, offset: number) {
    const doc = makeDoc(card(tag('TAG'), cardBody(text)));
    let pos = -1;
    doc.descendants((n: any, p: number) => { if (n.isText && n.text === text) pos = p + offset; return true; });
    let s = EditorState.create({ doc, plugins: [readModePlugin] });
    s = s.applyTransaction(s.tr.setSelection(TextSelection.create(s.doc, pos))).state;
    s = s.applyTransaction(s.tr.setMeta(PMD_READ_MODE_TOGGLE, true)).state;
    return s;
  }

  it('blocks a plain edit while read mode is on', () => {
    const s = readModeState('hello world', 5);
    const after = s.applyTransaction(s.tr.insertText('Z', s.selection.head)).state;
    expect(after.doc.textContent).toBe('TAGhello world'); // unchanged
  });

  it('allows a transaction flagged as the reading marker', () => {
    const s = readModeState('hello world', 5);
    const tr = s.tr.insertText('Z', s.selection.head).setMeta(READING_MARKER_META, true);
    const after = s.applyTransaction(tr).state;
    expect(after.doc.textContent).toContain('Z');
  });

  it('allows a drag/shelf edit (drag-move, dropzone, receive pill)', () => {
    const s = readModeState('hello world', 5);
    const tr = s.tr.insertText('Z', s.selection.head).setMeta(READ_MODE_DRAG_META, true);
    const after = s.applyTransaction(tr).state;
    expect(after.doc.textContent).toContain('Z');
  });

  it('allows selection-only changes (cursor stays usable)', () => {
    const s = readModeState('hello world', 5);
    const tr = s.tr.setSelection(TextSelection.create(s.doc, s.selection.head + 2));
    const after = s.applyTransaction(tr).state;
    expect(after.selection.head).toBe(s.selection.head + 2);
  });

  it('allows edits again once read mode is off', () => {
    let s = readModeState('hello world', 5);
    s = s.applyTransaction(s.tr.setMeta(PMD_READ_MODE_TOGGLE, false)).state;
    const after = s.applyTransaction(s.tr.insertText('Z', s.selection.head)).state;
    expect(after.doc.textContent).toContain('Z');
  });
});

describe('read-mode undo/redo is bounded to markers', () => {
  function dispatchCmd(s: EditorState, cmd: typeof readModeAwareUndo): EditorState {
    let next = s;
    cmd(s, (tr) => { next = s.applyTransaction(tr).state; });
    return next;
  }

  function enterReadModeWithPreEdit(): EditorState {
    const doc = makeDoc(card(tag('TAG'), cardBody('hello')));
    let s = EditorState.create({ doc, plugins: [history(), readModePlugin] });
    let pos = -1;
    doc.descendants((n: any, p: number) => { if (n.isText && n.text === 'hello') pos = p + 5; return true; });
    s = s.applyTransaction(s.tr.setSelection(TextSelection.create(s.doc, pos))).state;
    // A normal (non-marker) edit BEFORE read mode — must never be undoable
    // from inside read mode.
    s = s.applyTransaction(s.tr.insertText(' world', s.selection.head)).state;
    expect(s.doc.textContent).toBe('TAGhello world');
    // Enter read mode, then drop a marker.
    s = s.applyTransaction(s.tr.setMeta(PMD_READ_MODE_TOGGLE, true)).state;
    s = s.applyTransaction(buildToggleReadingMarkerTransaction(s, NOW)!).state;
    expect(markerText(s.doc)).not.toBeNull();
    return s;
  }

  it('undoes the marker but stops there (never the pre-read-mode edit)', () => {
    let s = enterReadModeWithPreEdit();
    s = dispatchCmd(s, readModeAwareUndo); // removes the marker
    expect(markerText(s.doc)).toBeNull();
    expect(s.doc.textContent).toBe('TAGhello world');
    s = dispatchCmd(s, readModeAwareUndo); // blocked — does NOT undo " world"
    expect(s.doc.textContent).toBe('TAGhello world');
  });

  it('redo re-applies the undone marker', () => {
    let s = enterReadModeWithPreEdit();
    s = dispatchCmd(s, readModeAwareUndo);
    expect(markerText(s.doc)).toBeNull();
    s = dispatchCmd(s, readModeAwareRedo);
    expect(markerText(s.doc)).not.toBeNull();
  });
});

describe('marking whole cards (outline right-click)', () => {
  const countMarkers = (doc: any): number => {
    let n = 0;
    doc.descendants((x: any) => { if (x.isText && x.text?.startsWith('Marked ')) n++; return true; });
    return n;
  };
  const all = (doc: any) => [{ from: 0, to: doc.content.size }];

  it('marks every unmarked card at the end of its last body paragraph, in one transaction', () => {
    const doc = makeDoc(card(tag('A'), cardBody('a1'), cardBody('a2')), card(tag('B'), cardBody('b1')));
    const state = EditorState.create({ doc });
    expect(cardMarkAction(state, all(doc))).toBe('mark');
    const tr = buildMarkCardsTransaction(state, all(doc), NOW)!;
    expect(tr.getMeta(READING_MARKER_META)).toBe(true);
    const next = state.apply(tr).doc;
    expect(countMarkers(next)).toBe(2);
    const a = next.child(0);
    expect(a.child(2).textContent).toBe('a2Marked 7:32');
    expect(a.child(1).textContent).toBe('a1');
    expect(next.child(1).child(1).textContent).toBe('b1Marked 7:32');
  });

  it('only touches cards in range, and skips ones that already have a marker', () => {
    const doc = makeDoc(card(tag('A'), cardBody('a1')), card(tag('B'), cardBody('b1')));
    let state = EditorState.create({ doc });
    const firstOnly = [{ from: 0, to: doc.child(0).nodeSize }];
    state = state.apply(buildMarkCardsTransaction(state, firstOnly, NOW)!);
    expect(countMarkers(state.doc)).toBe(1);
    const tr = buildMarkCardsTransaction(state, all(state.doc), NOW)!;
    expect(countMarkers(state.apply(tr).doc)).toBe(2);
  });

  it('unmarks when every card in range already has a marker', () => {
    const doc = makeDoc(card(tag('A'), cardBody('a1')), card(tag('B'), cardBody('b1')));
    let state = EditorState.create({ doc });
    state = state.apply(buildMarkCardsTransaction(state, all(doc), NOW)!);
    expect(cardMarkAction(state, all(state.doc))).toBe('unmark');
    state = state.apply(buildMarkCardsTransaction(state, all(state.doc), NOW)!);
    expect(countMarkers(state.doc)).toBe(0);
    expect(state.doc.child(0).child(1).textContent).toBe('a1');
  });

  it('adds a body paragraph to a card that has none, and does nothing with no card in range', () => {
    const doc = makeDoc(card(tag('A')));
    const state = EditorState.create({ doc });
    const next = state.apply(buildMarkCardsTransaction(state, all(doc), NOW)!).doc;
    expect(next.child(0).childCount).toBe(2);
    expect(next.child(0).child(1).type.name).toBe('card_body');
    expect(cardMarkAction(state, [])).toBeNull();
    expect(buildMarkCardsTransaction(state, [], NOW)).toBeNull();
  });
});

describe('marker text: speech-timer time, else clock', () => {
  const base = {
    mode: 'speech', running: true, runningSince: NOW.getTime() - 135_000,
    speechBaseRemainingMs: 6 * 60_000, speechTotalMs: 6 * 60_000,
    stopwatch: false, speechStopwatchBaseMs: 0,
  } as any;
  it('says how far into the speech when the speech timer is running', () => {
    expect(markerLabel(NOW, base)).toBe('Marked at 2:15');
  });
  it('counts up for a stopwatch speech', () => {
    expect(markerLabel(NOW, { ...base, stopwatch: true, speechBaseRemainingMs: 0, speechStopwatchBaseMs: 30_000 })).toBe('Marked at 2:45');
  });
  it('falls back to the clock when the timer is not running or is in prep', () => {
    expect(markerLabel(NOW, { ...base, running: false })).toBe('Marked 7:32');
    expect(markerLabel(NOW, { ...base, mode: 'affPrep' })).toBe('Marked 7:32');
  });
});

describe('Mark Card command and outline info', () => {
  it('marks the card at the cursor, then unmarks it', () => {
    const doc = makeDoc(card(tag('T'), cardBody('hello')));
    const st = cursorAt(doc, 'hello', 2);
    let next: EditorState | null = null;
    expect(markCardsCommand(st, (tr) => { next = st.apply(tr); })).toBe(true);
    expect(markerText(next!.doc)?.text).toMatch(/^Marked /);
    let again: EditorState | null = null;
    markCardsCommand(next!, (tr) => { again = next!.apply(tr); });
    expect(markerText(again!.doc)).toBeNull();
  });
  it('lists marked cards and rolls them up under the headings above', () => {
    const doc = makeDoc(
      schema.nodes['block']!.create({ id: newHeadingId() }, schema.text('B')),
      card(tag('A'), cardBody('a')),
      card(tag('B'), cardBody('b')),
    );
    const st = cursorAt(doc, 'b', 0);
    let next: EditorState | null = null;
    markCardsCommand(st, (tr) => { next = st.apply(tr); });
    const info = computeMarkInfo(next!.doc);
    expect([...info.cards.values()].length).toBe(1);
    expect(info.rollups.get(0)).toBe(1);
  });
});

describe('plain red text is not a marker', () => {
  it('ignores red text that does not read "Marked …" in marker detection and counts', () => {
    const red = schema.marks['font_color']!.create({ color: READING_MARKER_COLOR });
    const doc = makeDoc(card(tag('T'), schema.nodes['card_body']!.create(null, schema.text('ableist torture', [red]))));
    expect(cardMarkAction(EditorState.create({ doc }), [{ from: 0, to: doc.content.size }])).toBe('mark');
    expect(computeMarkInfo(doc).cards.size).toBe(0);
  });
});
