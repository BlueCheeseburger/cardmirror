// @vitest-environment jsdom
//
// "Search within selection only" (the ⌖ toggle / Alt-L) always starts OFF
// when the find bar opens, even over a selection: Ctrl-F searches the whole
// document. The selection is still remembered, so Alt-L scopes to it.
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../../src/schema/index.js';
import { FindReplaceBar } from '../../src/editor/find-replace-ui.js';
import { findReplacePlugin, findReplaceKey } from '../../src/editor/find-replace-plugin.js';
import { settings } from '../../src/editor/settings.js';

function makeView(): EditorView {
  const doc = schema.nodes['doc']!.create(null, [
    schema.nodes['paragraph']!.create(null, schema.text('foo one')),
    schema.nodes['paragraph']!.create(null, schema.text('foo two')),
  ]);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, {
    state: EditorState.create({ doc, plugins: [findReplacePlugin()] }),
  });
  // Select the first paragraph's text.
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8)));
  return view;
}

const OPEN = { mode: 'find', sortMode: 'categorized' } as const;
const toggle = () => document.querySelector<HTMLInputElement>('.pmd-find-scope-toggle input')!;
const scope = (view: EditorView) => findReplaceKey.getState(view.state)!.scope;

beforeEach(() => {
  document.body.innerHTML = '';
  settings.set('findRememberLastQuery', false);
  settings.set('findLastQuery', '');
  settings.set('findResultsExpanded', false);
});

describe('find bar: search-within-selection default', () => {
  it('opens with the scope toggle off, even over a selection', () => {
    const view = makeView();
    const bar = new FindReplaceBar(() => view);
    bar.open(OPEN);
    expect(toggle().checked).toBe(false);
    expect(scope(view)).toBeNull();
  });

  it('Alt-L still scopes to the selection captured at open', () => {
    const view = makeView();
    const bar = new FindReplaceBar(() => view);
    bar.open(OPEN);
    const input = document.querySelector<HTMLInputElement>('.pmd-find-input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', altKey: true, bubbles: true }));
    expect(toggle().checked).toBe(true);
    expect(scope(view)).toEqual({ from: 1, to: 8 });
  });

  it('stays off when re-opened while already open', () => {
    const view = makeView();
    const bar = new FindReplaceBar(() => view);
    bar.open(OPEN);
    bar.open({ mode: 'replace', sortMode: 'categorized' });
    expect(toggle().checked).toBe(false);
    expect(scope(view)).toBeNull();
  });
});
