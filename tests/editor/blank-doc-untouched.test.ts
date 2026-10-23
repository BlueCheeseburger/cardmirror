/**
 * `isUntouchedBlank` — the "is this still the doc New made?" check the
 * three-pane shell uses before letting an opened file replace an
 * Untitled doc. Blank content alone isn't enough: anything in the undo
 * history means the user has worked in the doc.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { history } from 'prosemirror-history';
import { schema } from '../../src/schema/index.js';
import { isUntouchedBlank, makeBlankDoc, seedCursorOffset } from '../../src/editor/blank-doc.js';
import { settings } from '../../src/editor/settings.js';

function freshState(doc = makeBlankDoc()): EditorState {
  return EditorState.create({ doc, plugins: [history()] });
}

describe('isUntouchedBlank', () => {
  afterEach(() => settings.set('defaultTextStyle', 'analytic'));

  it('a new doc in each default text style is untouched', () => {
    for (const style of ['pocket', 'hat', 'block', 'tag', 'analytic', 'undertag', 'normal'] as const) {
      settings.set('defaultTextStyle', style);
      expect(isUntouchedBlank(freshState())).toBe(true);
    }
  });

  it('stays untouched when the default style changes after the doc was made', () => {
    settings.set('defaultTextStyle', 'analytic');
    const state = freshState();
    settings.set('defaultTextStyle', 'normal');
    expect(isUntouchedBlank(state)).toBe(true);
  });

  it('a brand-new blank doc is untouched', () => {
    expect(isUntouchedBlank(freshState())).toBe(true);
  });

  it('works without the history plugin', () => {
    expect(isUntouchedBlank(EditorState.create({ doc: makeBlankDoc() }))).toBe(true);
  });

  it('a doc with text is not', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['paragraph']!.create(null, schema.text('hi')),
    ]);
    expect(isUntouchedBlank(freshState(doc))).toBe(false);
  });

  it('a doc with a heading that has text is not', () => {
    const doc = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['pocket']!.create({ id: 'p1' }, schema.text('1NC')),
    ]);
    expect(isUntouchedBlank(freshState(doc))).toBe(false);
  });

  it('typing then deleting leaves it blank but no longer untouched', () => {
    let state = freshState();
    const at = seedCursorOffset(state.doc.firstChild!);
    state = state.apply(state.tr.insertText('x', at));
    state = state.apply(state.tr.delete(at, at + 1));
    expect(state.doc.textContent).toBe('');
    expect(isUntouchedBlank(state)).toBe(false);
  });
});
