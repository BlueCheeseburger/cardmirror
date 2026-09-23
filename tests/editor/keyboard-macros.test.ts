import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../../src/schema/index.js';
import { buildMacroKeymap } from '../../src/editor/keyboard-macros.js';
import { REPEAT_TYPING_META } from '../../src/editor/repeat-last-action.js';

function docWithPara(text: string) {
  return schema.nodes['doc']!.createChecked(null, [
    schema.nodes['paragraph']!.create(null, text ? schema.text(text) : null),
  ]);
}

function runKey(km: ReturnType<typeof buildMacroKeymap>, key: string, startText: string) {
  let state = EditorState.create({ schema, doc: docWithPara(startText) });
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
  let applied: EditorState | null = null;
  const ok = km[key]!(state, (tr) => {
    applied = state.apply(tr);
  });
  return { ok, text: applied ? (applied as EditorState).doc.textContent : null };
}

describe('buildMacroKeymap', () => {
  it('binds keys with text; skips empty key or text', () => {
    const km = buildMacroKeymap([
      { id: 'a', key: 'Mod-Shift-q', text: 'cf.' },
      { id: 'b', key: '', text: 'x' },
      { id: 'c', key: 'Mod-j', text: '' },
    ]);
    expect(Object.keys(km)).toEqual(['Mod-Shift-q']);
  });

  it('the command types the macro text at the cursor', () => {
    const km = buildMacroKeymap([{ id: 'a', key: 'Mod-Shift-q', text: 'cf.' }]);
    const { ok, text } = runKey(km, 'Mod-Shift-q', 'cite');
    expect(ok).toBe(true);
    expect(text).toBe('citecf.');
  });

  it('the insert carries its text for Word-style Repeat, which counts it as typing', () => {
    const km = buildMacroKeymap([{ id: 'a', key: 'F9', text: 'cf.' }]);
    const state = EditorState.create({ schema, doc: docWithPara('') });
    let meta: unknown;
    expect(km['F9']!(state, (tr) => { meta = tr.getMeta(REPEAT_TYPING_META); })).toBe(true);
    expect(meta).toBe('cf.');
  });

  it('a later macro on the same key wins', () => {
    const km = buildMacroKeymap([
      { id: 'a', key: 'Mod-j', text: 'first' },
      { id: 'b', key: 'Mod-j', text: 'second' },
    ]);
    expect(runKey(km, 'Mod-j', '').text).toBe('second');
  });
});
