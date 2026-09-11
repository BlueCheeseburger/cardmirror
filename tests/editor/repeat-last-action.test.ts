// @vitest-environment jsdom
/**
 * Word-style Repeat (repeat-last-action.ts): the recorder remembers the
 * last editing action per view and replays it at the selection.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Slice, Fragment } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { repeatLastActionPlugin, repeatLastAction, lastActionOf, noteCommandRun } from '../../src/editor/repeat-last-action.js';

function makeView(bodyText = 'alpha bravo'): EditorView {
  const doc = schema.nodes['doc']!.create(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('T')),
      schema.nodes['card_body']!.create(null, bodyText ? schema.text(bodyText) : undefined),
    ]),
  ]);
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: EditorState.create({ doc, plugins: [repeatLastActionPlugin(), history()] }) });
}
const bodyStart = (v: EditorView): number => {
  let s = -1;
  v.state.doc.descendants((n, pos) => { if (s < 0 && n.type.name === 'card_body') s = pos + 1; return s < 0; });
  return s;
};
const body = (v: EditorView): string => v.state.doc.child(0).child(1).textContent;
const caretAt = (v: EditorView, pos: number): void => v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
/** What ProseMirror does for a typed character: the handleTextInput hook, then the insert. */
function typeText(v: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = v.state.selection;
    v.someProp('handleTextInput', (f) => f(v, from, to, ch, () => v.state.tr));
    v.dispatch(v.state.tr.insertText(ch, from, to));
  }
}
const noCommands = (_id: string): void => {};
const noKeys = (): boolean => false;
const repeat = (v: EditorView, run: (id: string) => void = noCommands, keys: () => boolean = noKeys): boolean =>
  repeatLastAction(v, run, keys);

describe('typing', () => {
  it('repeats the last contiguous burst; a caret move ends the burst', () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    typeText(v, 'abc');
    expect(lastActionOf(v.state)).toMatchObject({ kind: 'typing', text: 'abc' });
    expect(repeat(v)).toBe(true);
    expect(body(v)).toBe('abcabc');
    // Repeating again repeats the same burst.
    expect(repeat(v)).toBe(true);
    expect(body(v)).toBe('abcabcabc');
    // Move the caret to the start and type: a NEW burst.
    caretAt(v, bodyStart(v));
    typeText(v, 'x');
    expect(lastActionOf(v.state)).toMatchObject({ kind: 'typing', text: 'x' });
    repeat(v);
    expect(body(v)).toBe('xxabcabcabc');
  });

  it('a document change the recorder does not understand clears the record', () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    typeText(v, 'ab');
    v.dispatch(v.state.tr.insertText('!', bodyStart(v))); // e.g. a drop
    expect(lastActionOf(v.state)).toBeNull();
    expect(repeat(v)).toBe(false);
  });

  it('undo and redo leave the record alone, so Repeat works after redoing everything', () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    typeText(v, 'ab');
    undo(v.state, v.dispatch, v);
    redo(v.state, v.dispatch, v);
    expect(lastActionOf(v.state)).toMatchObject({ kind: 'typing', text: 'ab' });
  });
});

describe('delete, paste, commands', () => {
  it('Backspace repeats as one more Backspace (through the app key handlers first, else the base command)', () => {
    const v = makeView('alpha');
    caretAt(v, bodyStart(v) + 5);
    v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: 'Backspace' })));
    v.dispatch(v.state.tr.delete(bodyStart(v) + 4, bodyStart(v) + 5)); // what the real handler did
    expect(body(v)).toBe('alph');
    expect(lastActionOf(v.state)).toEqual({ kind: 'delete', key: 'Backspace' });
    let handled = 0;
    expect(repeat(v, noCommands, () => { handled++; return false; })).toBe(true);
    expect(handled, 'the app handlers were offered the key first').toBe(1);
    expect(body(v)).toBe('alp');
    repeat(v);
    expect(body(v)).toBe('al');
  });

  it('paste repeats the same slice at the selection', () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    const slice = new Slice(Fragment.from(schema.text('PASTED')), 0, 0);
    v.someProp('handlePaste', (f) => f(v, new Event('paste') as ClipboardEvent, slice));
    v.dispatch(v.state.tr.replaceSelection(slice));
    expect(body(v)).toBe('PASTED');
    expect(repeat(v)).toBe(true);
    expect(body(v)).toBe('PASTEDPASTED');
  });

  it('a command that changed the document is remembered by id and re-run; one that changed nothing is not', () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    noteCommandRun('bold', 'begin');
    v.dispatch(v.state.tr.insertText('B'));
    noteCommandRun('bold', 'end', v, true);
    expect(lastActionOf(v.state)).toEqual({ kind: 'command', id: 'bold' });
    const ran: string[] = [];
    expect(repeat(v, (id) => { ran.push(id); })).toBe(true);
    expect(ran).toEqual(['bold']);
    noteCommandRun('openSettings', 'begin');
    noteCommandRun('openSettings', 'end', v, false);
    expect(lastActionOf(v.state), 'unchanged doc: record kept').toEqual({ kind: 'command', id: 'bold' });
    noteCommandRun('undo', 'begin');
    noteCommandRun('undo', 'end', v, true);
    expect(lastActionOf(v.state), 'undo/redo are never a last action').toEqual({ kind: 'command', id: 'bold' });
  });
});
