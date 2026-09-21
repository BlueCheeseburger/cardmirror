// @vitest-environment jsdom
/**
 * "Read mode: show undertags" (2026-09-21): with the setting on, every
 * undertag paragraph's runs are kept (the block itself returns through
 * the host's `pmd-rm-show-undertags` class in CSS); off, only highlighted
 * runs are kept as before. Either way the word count does not move: the
 * counter is mark-based and never consults the setting.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { readModePlugin, PMD_READ_MODE_TOGGLE, isReadModeKeptText } from '../../src/editor/read-mode-plugin.js';
import { countReadAloudSplit, totalWords } from '../../src/editor/word-count.js';
import { settings } from '../../src/editor/settings.js';

const before = settings.get('readModeShowUndertags');
afterEach(() => settings.set('readModeShowUndertags', before));

function buildDoc(): PMNode {
  const undertag = schema.nodes['undertag']!.create(null, [
    schema.text('Uniqueness plain words '),
    schema.text('highlighted bit', [schema.marks['highlight']!.create({ color: 'yellow' })]),
  ]);
  return schema.nodes['doc']!.createChecked(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag words')),
      undertag,
      schema.nodes['card_body']!.create(null, [schema.text('body '), schema.text('read this', [schema.marks['highlight']!.create({ color: 'yellow' })])]),
    ]),
    schema.nodes['undertag']!.create(null, schema.text('doc level undertag')),
  ]);
}
function readModeView(doc: PMNode): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, { state: EditorState.create({ doc, plugins: [readModePlugin] }) });
  view.dispatch(view.state.tr.setMeta(PMD_READ_MODE_TOGGLE, true));
  return view;
}
function classOf(view: EditorView, needle: string): string | null {
  for (const el of view.dom.querySelectorAll('.pmd-rm-keep, .pmd-rm-hide')) {
    if (el.textContent?.includes(needle)) return el.classList.contains('pmd-rm-keep') ? 'keep' : 'hide';
  }
  return null;
}

describe('"Read mode: show undertags"', () => {
  it('off: only highlighted undertag runs are kept', () => {
    settings.set('readModeShowUndertags', false);
    const view = readModeView(buildDoc());
    expect(classOf(view, 'Uniqueness plain')).toBe('hide');
    expect(classOf(view, 'highlighted bit')).toBe('keep');
    expect(classOf(view, 'doc level undertag')).toBe('hide');
  });

  it('on: every run of every undertag is kept; body text is unaffected', () => {
    settings.set('readModeShowUndertags', true);
    const view = readModeView(buildDoc());
    expect(classOf(view, 'Uniqueness plain')).toBe('keep');
    expect(classOf(view, 'highlighted bit')).toBe('keep');
    expect(classOf(view, 'doc level undertag')).toBe('keep');
    expect(classOf(view, 'body ')).toBe('hide');
    expect(classOf(view, 'read this')).toBe('keep');
  });

  it('the shared predicate follows it, so Convert Cards to Read Mode does too', () => {
    const doc = buildDoc();
    const undertag = doc.child(0).child(1);
    const plain = undertag.child(0);
    settings.set('readModeShowUndertags', false);
    expect(isReadModeKeptText(plain, undertag)).toBe(false);
    settings.set('readModeShowUndertags', true);
    expect(isReadModeKeptText(plain, undertag)).toBe(true);
  });

  it('never changes the word count or read time: unhighlighted undertag text stays uncounted', () => {
    const doc = buildDoc();
    settings.set('readModeShowUndertags', false);
    const off = countReadAloudSplit(doc);
    settings.set('readModeShowUndertags', true);
    const on = countReadAloudSplit(doc);
    expect(on).toEqual(off);
    // tag (2, other) + highlighted undertag bit (2, body) + highlighted body (2, body)
    expect(totalWords(on)).toBe(6);
    expect(on.body).toBe(4);
  });
});
