// @vitest-environment jsdom
/**
 * A white (or "none") highlight is an ERASED one — "Highlight with White"
 * (Mod-F11) paints it to clear highlighting — so read mode must hide that
 * text like any other unhighlighted filler, and the read-time count must not
 * count it as read aloud.
 */

import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { readModePlugin, PMD_READ_MODE_TOGGLE, isReadModeKeptText } from '../../src/editor/read-mode-plugin.js';
import { countReadAloudSplit } from '../../src/editor/word-count.js';

function hl(text: string, color: string) {
  return schema.text(text, [schema.marks['highlight']!.create({ color })]);
}

function makeDoc() {
  const body = schema.nodes['card_body']!.create(null, [
    hl('yellow words ', 'yellow'),
    hl('white erased ', 'white'),
    hl('none erased ', 'none'),
    schema.text('plain filler'),
  ]);
  return schema.nodes['doc']!.createChecked(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
      body,
    ]),
  ]);
}

describe('blank (white / none) highlights are not read-aloud text', () => {
  it('read mode keeps yellow and hides white / none / plain', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const view = new EditorView(el, { state: EditorState.create({ doc: makeDoc(), plugins: [readModePlugin] }) });
    view.dispatch(view.state.tr.setMeta(PMD_READ_MODE_TOGGLE, true));
    const cls = (needle: string): string | null => {
      for (const n of view.dom.querySelectorAll('.pmd-rm-keep, .pmd-rm-hide')) {
        if (n.textContent?.includes(needle)) return n.classList.contains('pmd-rm-keep') ? 'keep' : 'hide';
      }
      return null;
    };
    expect(cls('yellow words')).toBe('keep');
    expect(cls('white erased')).toBe('hide');
    expect(cls('none erased')).toBe('hide');
    view.destroy();
  });

  it('isReadModeKeptText agrees (so Read Doc conversions match the display)', () => {
    const body = makeDoc().child(0).child(1);
    const kept: string[] = [];
    body.forEach((child) => {
      if (isReadModeKeptText(child, body)) kept.push(child.text ?? '');
    });
    expect(kept).toEqual(['yellow words ']);
  });

  it('the read-time count skips them too', () => {
    const doc = makeDoc();
    const counts = countReadAloudSplit(doc, 0, doc.content.size);
    expect(counts.body).toBe(2); // "yellow words"
  });
});
