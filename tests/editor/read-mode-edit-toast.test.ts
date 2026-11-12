// @vitest-environment jsdom
/**
 * Trying to edit while read mode is on says why nothing happened.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  readModePlugin,
  PMD_READ_MODE_TOGGLE,
  READ_MODE_EDIT_MESSAGE,
  resetReadModeNoticeForTests,
} from '../../src/editor/read-mode-plugin.js';
import { READING_MARKER_META } from '../../src/editor/reading-marker.js';

function mkView(readMode: boolean): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const doc = schema.nodes['doc']!.createChecked(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
      schema.nodes['card_body']!.create(null, schema.text('body words here')),
    ]),
  ]);
  const view = new EditorView(el, { state: EditorState.create({ doc, plugins: [readModePlugin] }) });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)));
  if (readMode) view.dispatch(view.state.tr.setMeta(PMD_READ_MODE_TOGGLE, true));
  return view;
}
const toasts = (): string[] =>
  [...document.querySelectorAll('.pmd-toast')].map((t) => t.textContent ?? '');
const key = (view: EditorView, init: KeyboardEventInit): void => {
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
};

describe('read mode refuses an edit and says so', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    resetReadModeNoticeForTests();
  });

  it('typing a letter shows the notice and changes nothing', () => {
    const view = mkView(true);
    const before = view.state.doc;
    key(view, { key: 'a' });
    expect(toasts()).toEqual([READ_MODE_EDIT_MESSAGE]);
    expect(view.state.doc.eq(before)).toBe(true);
    view.destroy();
  });

  it('a refused document change (a paste, a command) shows it too', () => {
    const view = mkView(true);
    const before = view.state.doc;
    view.dispatch(view.state.tr.insertText('typed', 8));
    expect(view.state.doc.eq(before)).toBe(true);
    expect(toasts()).toEqual([READ_MODE_EDIT_MESSAGE]);
    view.destroy();
  });

  it('a burst makes one notice, not a stack', () => {
    const view = mkView(true);
    key(view, { key: 'a' });
    key(view, { key: 'b' });
    view.dispatch(view.state.tr.insertText('x', 8));
    expect(toasts()).toHaveLength(1);
    view.destroy();
  });

  it('shows again once the gap has passed', () => {
    vi.useFakeTimers();
    try {
      const view = mkView(true);
      key(view, { key: 'a' });
      vi.advanceTimersByTime(2000);
      key(view, { key: 'b' });
      expect(toasts().filter((t) => t === READ_MODE_EDIT_MESSAGE).length).toBe(2);
      view.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says nothing outside read mode, for selection moves, or for a marker edit', () => {
    const off = mkView(false);
    key(off, { key: 'a' });
    off.dispatch(off.state.tr.insertText('x', 8));
    expect(toasts()).toEqual([]);
    off.destroy();

    const on = mkView(true);
    on.dispatch(on.state.tr.setSelection(TextSelection.create(on.state.doc, 10)));
    on.dispatch(on.state.tr.insertText('M', 10).setMeta(READING_MARKER_META, true));
    key(on, { key: 'ArrowLeft' });
    key(on, { key: 'c', ctrlKey: true });
    expect(toasts()).toEqual([]);
    on.destroy();
  });
});
