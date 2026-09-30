// @vitest-environment jsdom
//
// Opening the find bar over a selection pre-fills the input with the
// selected text (one line, up to 200 chars) and searches the whole
// document: "Search within selection only" (the ⌖ toggle / Alt-L) always
// starts OFF. The selection is still remembered, so Alt-L scopes to it.
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../../src/schema/index.js';
import { FindReplaceBar } from '../../src/editor/find-replace-ui.js';
import { findReplacePlugin, findReplaceKey } from '../../src/editor/find-replace-plugin.js';
import { settings } from '../../src/editor/settings.js';

function makeView(sel: [number, number] = [1, 8]): EditorView {
  const doc = schema.nodes['doc']!.create(null, [
    schema.nodes['paragraph']!.create(null, schema.text('foo one')),
    schema.nodes['paragraph']!.create(null, schema.text('foo two')),
  ]);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, {
    state: EditorState.create({ doc, plugins: [findReplacePlugin()] }),
  });
  // Default: select the first paragraph's text ("foo one").
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, ...sel)));
  return view;
}

const OPEN = { mode: 'find', sortMode: 'categorized' } as const;
const toggle = () => document.querySelector<HTMLInputElement>('.pmd-find-scope-toggle input')!;
const input = () => document.querySelector<HTMLInputElement>('.pmd-find-input')!;
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
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', altKey: true, bubbles: true }));
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

  it('pre-fills the input with the selected text and searches the whole doc', () => {
    const view = makeView([1, 4]); // "foo"
    const bar = new FindReplaceBar(() => view);
    bar.open(OPEN);
    expect(input().value).toBe('foo');
    expect(findReplaceKey.getState(view.state)!.matches.length).toBe(2);
  });

  it('the selection wins over a remembered query', () => {
    settings.set('findRememberLastQuery', true);
    settings.set('findLastQuery', 'photons');
    const view = makeView([1, 4]);
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('foo');
  });

  it('a re-open while already open picks up a new selection', () => {
    const view = makeView([1, 4]);
    const bar = new FindReplaceBar(() => view);
    bar.open(OPEN);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5, 8)));
    bar.open(OPEN);
    expect(input().value).toBe('one');
  });

  it('a multi-paragraph selection does not pre-fill', () => {
    const view = makeView([1, 13]); // "foo one" ¶ "foo "
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('');
  });

  it('no selection keeps the old seeding (empty, or the remembered query)', () => {
    const view = makeView([3, 3]);
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('');
  });
});
