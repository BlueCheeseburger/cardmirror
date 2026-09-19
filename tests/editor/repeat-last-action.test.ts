// @vitest-environment jsdom
/**
 * Word-style Repeat (repeat-last-action.ts): the recorder remembers the
 * last editing action per view and replays it at the selection.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, PluginKey, TextSelection, type Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Slice, Fragment } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { repeatLastActionPlugin, repeatLastAction, lastActionOf, noteCommandRun, type RepeatKey } from '../../src/editor/repeat-last-action.js';
import { makeAutocorrectPlugin, type AutocorrectRule, type AutocorrectState } from '../../src/editor/autocorrect.js';
import { buildMacroKeymap } from '../../src/editor/keyboard-macros.js';
import type { KeyboardMacro } from '../../src/editor/settings.js';

function makeView(bodyText = 'alpha bravo', extra: Plugin[] = []): EditorView {
  const doc = schema.nodes['doc']!.create(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('T')),
      schema.nodes['card_body']!.create(null, bodyText ? schema.text(bodyText) : undefined),
    ]),
  ]);
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: EditorState.create({ doc, plugins: [repeatLastActionPlugin(), history(), ...extra] }) });
}
const bodyStart = (v: EditorView): number => {
  let s = -1;
  v.state.doc.descendants((n, pos) => { if (s < 0 && n.type.name === 'card_body') s = pos + 1; return s < 0; });
  return s;
};
const body = (v: EditorView): string => v.state.doc.child(0).child(1).textContent;
const caretAt = (v: EditorView, pos: number): void => v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
/** What ProseMirror does for a typed character: the handleTextInput hook,
 *  then the insert unless a hook claimed it (autocorrect dispatches its own). */
function typeText(v: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = v.state.selection;
    const handled = v.someProp('handleTextInput', (f) => f(v, from, to, ch, () => v.state.tr));
    if (!handled) v.dispatch(v.state.tr.insertText(ch, from, to));
  }
}
/** A keydown as the recorder's hook sees it (the real handler's edit is dispatched by the test). */
function pressKey(v: EditorView, key: string, init: KeyboardEventInit = {}): void {
  v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key, ...init })));
}
const noCommands = (_id: string): void => {};
const noKeys = (): boolean => false;
const repeat = (v: EditorView, run: (id: string) => void = noCommands, keys: (v: EditorView, key: RepeatKey) => boolean = noKeys): boolean =>
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
    expect(lastActionOf(v.state)).toEqual({ kind: 'key', key: 'Backspace' });
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

describe('Enter, Tab, macros, autocorrect (2026-09-18)', () => {
  it('Enter, Tab and Shift-Tab are recorded and replayed as one more press through the app handlers', () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    for (const [key, init, expected] of [
      ['Enter', {}, 'Enter'],
      ['Tab', {}, 'Tab'],
      ['Tab', { shiftKey: true }, 'Shift-Tab'],
    ] as const) {
      pressKey(v, key, init);
      v.dispatch(v.state.tr.insertText('x')); // what the real handler did
      expect(lastActionOf(v.state)).toEqual({ kind: 'key', key: expected });
      const seen: string[] = [];
      expect(repeat(v, noCommands, (_view, k) => { seen.push(k); return true; })).toBe(true);
      expect(seen).toEqual([expected]);
      expect(lastActionOf(v.state), 'a replayed key stays the record').toEqual({ kind: 'key', key: expected });
    }
    // Enter and Tab have no base fallback: nothing claimed it → nothing replayed.
    expect(repeat(v, noCommands, () => false)).toBe(false);
  });

  it('chorded Enter / Tab and Shift-Enter are other bindings, not repeatable keys', () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    typeText(v, 'ab');
    for (const [key, init] of [['Enter', { shiftKey: true }], ['Enter', { metaKey: true }], ['Tab', { ctrlKey: true }], ['Enter', { altKey: true }]] as const) {
      pressKey(v, key, init);
      v.dispatch(v.state.tr.insertText('!', bodyStart(v)));
      expect(lastActionOf(v.state), `${key} ${JSON.stringify(init)} is not a recorded key`).toBeNull();
      typeText(v, 'ab');
    }
  });

  it('a key that changed nothing leaves no stale announcement for a later caret move to record', () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    typeText(v, 'ab');
    pressKey(v, 'Delete'); // at the end of the body: the real handler did nothing
    caretAt(v, bodyStart(v));
    expect(lastActionOf(v.state)).toMatchObject({ kind: 'typing', text: 'ab' });
    expect(repeat(v)).toBe(true);
    expect(body(v)).toBe('abab');
  });

  it('a command run supersedes the announcement of the key that triggered it', () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    pressKey(v, 'Tab'); // a command bound to Tab
    noteCommandRun('indentParagraph', 'begin');
    v.dispatch(v.state.tr.insertText('\t'));
    noteCommandRun('indentParagraph', 'end', v, true);
    expect(lastActionOf(v.state)).toEqual({ kind: 'command', id: 'indentParagraph' });
    caretAt(v, bodyStart(v));
    expect(lastActionOf(v.state), 'no lingering Tab announcement').toEqual({ kind: 'command', id: 'indentParagraph' });
  });

  it("a keyboard macro's text is typing: repeatable, and it continues a burst it follows", () => {
    const v = makeView('');
    caretAt(v, bodyStart(v));
    typeText(v, 'ab');
    const macro = buildMacroKeymap([{ id: 'm', key: 'F9', text: 'XY' } as KeyboardMacro])['F9']!;
    macro(v.state, v.dispatch.bind(v));
    expect(body(v)).toBe('abXY');
    expect(lastActionOf(v.state)).toMatchObject({ kind: 'typing', text: 'abXY' });
    expect(repeat(v)).toBe(true);
    expect(body(v)).toBe('abXYabXY');
    // On its own, after a caret move, the macro text is its own burst.
    caretAt(v, bodyStart(v));
    macro(v.state, v.dispatch.bind(v));
    expect(lastActionOf(v.state)).toMatchObject({ kind: 'typing', text: 'XY' });
    repeat(v);
    expect(body(v)).toBe('XYXYabXYabXY');
  });

  it('typing replays through the text-input hooks, so autocorrect converts the replay as it did the original', () => {
    // A stand-in for smart quotes on the real autocorrect engine: a typed
    // straight double quote becomes a curled one.
    const rule: AutocorrectRule = {
      triggers: (text) => text === '"',
      enabled: () => true,
      match: (_state, from) => ({ replaceFrom: from, insert: '\u201c', revertTo: '"' }),
    };
    const v = makeView('', [makeAutocorrectPlugin(new PluginKey<AutocorrectState>('test-curl'), [rule])]);
    caretAt(v, bodyStart(v));
    typeText(v, 'a"b');
    expect(body(v)).toBe('a\u201cb');
    expect(lastActionOf(v.state), 'the record is the raw keystrokes').toMatchObject({ kind: 'typing', text: 'a"b' });
    caretAt(v, bodyStart(v));
    expect(repeat(v)).toBe(true);
    expect(body(v), 'the replay was converted too').toBe('a\u201cba\u201cb');
  });
});
