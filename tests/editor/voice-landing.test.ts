// @vitest-environment jsdom
/**
 * Dictation landing: dictated text goes through the view's typing hook
 * chunk by chunk (words whole, every other character alone) so input
 * rules fire as they do for typing; the sticky pen marks the inserted
 * span; the whole utterance is one undo step.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { typingChunks, typeThroughInputRules, landDictation, splitDictationBreaks } from '../../src/editor/voice/landing.js';
import { voicePlugin } from '../../src/editor/voice/plugin.js';
import type { DispatchDeps } from '../../src/editor/voice/dispatch.js';
import type { RibbonContext } from '../../src/editor/ribbon-commands.js';

function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, body ? schema.text(body) : undefined),
  ]);
}
/** A typing-hook plugin standing in for autocorrect: `---` becomes an em dash on the third dash. */
const dashRule = new Plugin({
  props: {
    handleTextInput(view, from, to, text) {
      if (text !== '-') return false;
      const before = view.state.doc.textBetween(Math.max(0, from - 2), from);
      if (before !== '--') return false;
      view.dispatch(view.state.tr.insertText('—', from - 2, to));
      return true;
    },
  },
});
function makeView(bodyText = 'alpha') {
  const doc = schema.nodes['doc']!.create(null, [card('Tag', bodyText)]);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, { state: EditorState.create({ doc, plugins: [history(), dashRule, voicePlugin()] }) });
  const bodyEnd = 1 + doc.child(0).child(0).nodeSize + 1 + bodyText.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyEnd)));
  return view;
}
const deps: DispatchDeps = { ribbonCtx: undefined as unknown as RibbonContext, ui: { echo() {}, hint() {} } };

describe('dictation landing', () => {
  it('"new paragraph" / "new line" break a dictation into paragraphs, the next one capitalized, one undo step', () => {
    expect(splitDictationBreaks('first bit new paragraph second bit new line third')).toEqual(['first bit', 'second bit', 'third']);
    expect(splitDictationBreaks('the new line of argument'), 'the phrase always breaks').toEqual(['the', 'of argument']);
    expect(splitDictationBreaks('a newline\nhere')).toEqual(['a', 'here']);
    const view = makeView('alpha');
    const before = (() => { let n = 0; view.state.doc.descendants((node) => { if (node.isTextblock) n++; return true; }); return n; })();
    landDictation(view, { utteranceId: 1, pen: null, deps, text: 'first sentence new paragraph second sentence' });
    let after = 0;
    view.state.doc.descendants((node) => { if (node.isTextblock) after++; return true; });
    expect(after).toBe(before + 1);
    expect(view.state.doc.textContent, 'the first segment continues the sentence in progress').toContain('alpha first sentence');
    expect(view.state.doc.textContent, 'the segment after the break starts a sentence').toContain('Second sentence');
    undo(view.state, view.dispatch);
    expect(view.state.doc.textContent).toBe('Tagalpha');
  });

  it('dictating with text selected replaces the selection (no replace verb needed)', () => {
    const view = makeView('alpha bravo charlie');
    const bodyStart = 1 + view.state.doc.child(0).child(0).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart + 6, bodyStart + 11)));
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('bravo');
    landDictation(view, { utteranceId: 1, pen: null, deps, text: 'delta' });
    expect(view.state.doc.child(0).child(1).textContent).toBe('alpha delta charlie');
    undo(view.state, view.dispatch);
    expect(view.state.doc.child(0).child(1).textContent, 'one undo step restores the selection text').toBe('alpha bravo charlie');
  });

  it('chunks words whole and every other character alone', () => {
    expect(typingChunks('hello, world---end')).toEqual(['hello', ',', ' ', 'world', '-', '-', '-', 'end']);
  });

  it('types through the input-rule hook so rules fire as for typing', () => {
    const view = makeView('');
    typeThroughInputRules(view, 'x---y', (tr) => view.dispatch(tr));
    expect(view.state.doc.child(0).child(1).textContent).toBe('x—y');
  });

  it('lands with a leading space after a word, applies the armed pen, and undoes as one step', () => {
    const view = makeView('alpha');
    const before = view.state.doc.textContent;
    landDictation(view, { utteranceId: 3, pen: 'underline', deps, text: 'bravo charlie' });
    const body = view.state.doc.child(0).child(1);
    expect(body.textContent).toBe('alpha bravo charlie');
    const ul = schema.marks['underline_mark']!;
    const bodyStart = 1 + view.state.doc.child(0).child(0).nodeSize + 1;
    expect(view.state.doc.rangeHasMark(bodyStart + 'alpha '.length, bodyStart + 'alpha bravo charlie'.length, ul)).toBe(true);
    expect(view.state.doc.rangeHasMark(bodyStart, bodyStart + 'alpha'.length, ul)).toBe(false);
    undo(view.state, view.dispatch);
    expect(view.state.doc.textContent).toBe(before);
  });

  it('resolves spoken punctuation and capitalizes a sentence start', () => {
    const view = makeView('First sentence.');
    landDictation(view, { utteranceId: 4, pen: null, deps, text: 'the perm solves comma the link is nonunique period' });
    expect(view.state.doc.child(0).child(1).textContent).toBe('First sentence. The perm solves, the link is nonunique.');
  });
});
