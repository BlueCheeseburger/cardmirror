// @vitest-environment jsdom
//
// What the find bar does with a selection when it opens, decided by WHAT
// is selected (never by how it was selected):
//   - a short highlight inside one paragraph is the thing to look FOR: it
//     fills the box and the whole document is searched;
//   - anything else holding text (several paragraphs or cards, a long
//     passage, a whole card, a section selected from the nav pane) is the
//     place to look IN: the search is limited to it;
//   - a selection with no text (an image) is ignored.
// Alt-L (the ⌖ toggle) switches the limit either way.
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { FindReplaceBar } from '../../src/editor/find-replace-ui.js';
import { findReplacePlugin, findReplaceKey } from '../../src/editor/find-replace-plugin.js';
import { settings } from '../../src/editor/settings.js';
import { NodeSelection } from 'prosemirror-state';
import { classifyFindSelection } from '../../src/editor/find-replace-ui.js';

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

describe('find bar: a short highlight is the search term', () => {
  it('opens with the scope toggle off over a one-line highlight', () => {
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

  it('a multi-paragraph selection does not pre-fill, and limits the search to itself', () => {
    const view = makeView([1, 13]); // "foo one" ¶ "foo "
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('');
    expect(toggle().checked).toBe(true);
    expect(scope(view)).toEqual({ from: 1, to: 13 });
  });

  it('no selection keeps the old seeding (empty, or the remembered query)', () => {
    const view = makeView([3, 3]);
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('');
  });
});

describe('find bar: selection edges', () => {
  it('a selection running into the next paragraph still pre-fills', () => {
    const view = makeView([1, 10]); // "foo one" + the break into paragraph 2
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('foo one');
  });
});

/** A view over arbitrary top-level nodes, with the given selection. */
function viewOf(children: PMNode[], select: (v: EditorView) => void): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, {
    state: EditorState.create({ doc: schema.nodes['doc']!.create(null, children), plugins: [findReplacePlugin()] }),
  });
  select(view);
  return view;
}
const p = (text: string) => schema.nodes['paragraph']!.create(null, text ? schema.text(text) : []);

describe('find bar: a region limits the search', () => {
  it('a passage longer than 200 characters inside one paragraph is a region', () => {
    const long = 'word '.repeat(60); // 300 chars
    const view = viewOf([p(long), p('word')], (v) =>
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 1 + 250))),
    );
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('');
    expect(toggle().checked).toBe(true);
    expect(scope(view)).toEqual({ from: 1, to: 251 });
  });

  it('exactly 200 characters is still a term; 201 is a region', () => {
    const view = viewOf([p('x'.repeat(300))], (v) =>
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 201))),
    );
    expect(classifyFindSelection(view.state)).toEqual({ kind: 'term', text: 'x'.repeat(200) });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 202)));
    expect(classifyFindSelection(view.state)).toEqual({ kind: 'region' });
  });

  it('a whole card selected as an object is a region', () => {
    const card = schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: 'h-1' }, schema.text('Tag')),
      schema.nodes['card_body']!.create(null, schema.text('foo body')),
    ]);
    const view = viewOf([card, p('foo elsewhere')], (v) =>
      v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, 0))),
    );
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('');
    expect(toggle().checked).toBe(true);
    input().value = 'foo';
    input().dispatchEvent(new Event('input'));
    expect(scope(view)).toEqual({ from: 0, to: card.nodeSize });
  });

  it('a highlight holding a footnote marker is a region, not a query that finds nothing', () => {
    const para = schema.nodes['paragraph']!.create(null, [
      schema.text('foo'),
      schema.nodes['footnote']!.create({ kind: 'footnote', content: [[{ text: 'note' }]] }),
      schema.text('bar'),
    ]);
    const view = viewOf([para, p('foobar')], (v) =>
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 1 + para.content.size))),
    );
    expect(classifyFindSelection(view.state)).toEqual({ kind: 'region' });
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('');
    expect(toggle().checked).toBe(true);
  });

  it('Alt-L turns the limit off again', () => {
    const view = makeView([1, 13]);
    new FindReplaceBar(() => view).open(OPEN);
    expect(toggle().checked).toBe(true);
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', altKey: true, bubbles: true }));
    expect(toggle().checked).toBe(false);
    expect(scope(view)).toBeNull();
  });
});

describe('find bar: a selection with no text is ignored', () => {
  it('a selected footnote marker on its own neither fills the box nor limits the search', () => {
    const para = schema.nodes['paragraph']!.create(null, [
      schema.text('foo'),
      schema.nodes['footnote']!.create({ kind: 'footnote', content: [[{ text: 'note' }]] }),
    ]);
    const view = viewOf([para, p('foo')], (v) =>
      v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, 4))),
    );
    expect(classifyFindSelection(view.state)).toEqual({ kind: 'none' });
    new FindReplaceBar(() => view).open(OPEN);
    expect(input().value).toBe('');
    expect(toggle().checked).toBe(false);
    // Nothing to scope to by hand either.
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', altKey: true, bubbles: true }));
    expect(scope(view)).toBeNull();
  });
});

describe('find bar: re-opening while it is up', () => {
  it('over the current match keeps the typed query and the scope', () => {
    const view = makeView([1, 4]); // "foo" → pre-filled, two matches
    const bar = new FindReplaceBar(() => view);
    bar.open(OPEN);
    const st = findReplaceKey.getState(view.state)!;
    expect(st.matches.length).toBe(2);
    const m = st.matches[st.currentIndex]!;
    // What the user typed differs from the match's literal text only in case.
    input().value = 'FOO';
    // Stepping through matches puts the editor selection on the match.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)));
    bar.open({ mode: 'replace', sortMode: 'categorized' });
    expect(input().value, 'not overwritten with the match text "foo"').toBe('FOO');
    expect(toggle().checked).toBe(false);
  });
});
