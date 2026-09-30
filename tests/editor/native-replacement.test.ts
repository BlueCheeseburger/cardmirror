// @vitest-environment jsdom
/**
 * A replacement the OS makes on its own (macOS turning "---" into an em
 * dash) must not fold the next line into the one being typed. When the
 * range the system means to replace runs on to the start of the next
 * textblock, the browser's own edit deletes the block boundary — a Pocket
 * typed below a Block line ends up inside it, restyled. The plugin cancels
 * that edit at `beforeinput` and replaces only up to the end of the line.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { typeOverBoundaryPlugin } from '../../src/editor/type-over-boundary.js';

const heading = (type: 'pocket' | 'block' | 'hat', text: string): PMNode =>
  schema.nodes[type]!.create({ id: newHeadingId() }, schema.text(text));
const para = (text: string): PMNode => schema.nodes['paragraph']!.create(null, schema.text(text));
const docOf = (...children: PMNode[]): PMNode => schema.nodes['doc']!.createChecked(null, children);

function mount(doc: PMNode): EditorView {
  const host = document.body.appendChild(document.createElement('div'));
  return new EditorView(host, { state: EditorState.create({ doc, plugins: [typeOverBoundaryPlugin] }) });
}

interface FakeInput {
  inputType: string;
  data?: string | null;
  replacement?: string;
  isComposing?: boolean;
  cancelable?: boolean;
  ranges?: Array<{ startContainer: Node; startOffset: number; endContainer: Node; endOffset: number }>;
}

/** A `beforeinput` the way Chromium delivers it, with the parts jsdom lacks. */
function beforeInput(view: EditorView, init: FakeInput): InputEvent {
  const event = new InputEvent('beforeinput', {
    inputType: init.inputType,
    data: init.data ?? null,
    isComposing: init.isComposing ?? false,
    cancelable: init.cancelable ?? true,
    bubbles: true,
  });
  Object.defineProperty(event, 'getTargetRanges', { value: () => init.ranges ?? [] });
  if (init.replacement !== undefined) {
    Object.defineProperty(event, 'dataTransfer', {
      value: { getData: (type: string) => (type === 'text/plain' ? init.replacement : '') },
    });
  }
  view.dom.dispatchEvent(event);
  return event;
}

const blocksOf = (doc: PMNode): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  doc.descendants((n) => {
    if (n.isTextblock) out.push([n.type.name, n.textContent]);
    return true;
  });
  return out;
};

/** "Block line ---" above a Pocket, with the system's replacement range
 *  running from the three hyphens on to the start of the Pocket. */
function scenario(): { view: EditorView; ranges: NonNullable<FakeInput['ranges']> } {
  const view = mount(docOf(heading('block', 'Block line ---'), heading('pocket', 'Disad pocket')));
  const blockText = view.dom.querySelector('h3')!.firstChild!;
  const pocket = view.dom.querySelector('h1')!;
  return {
    view,
    ranges: [{ startContainer: blockText, startOffset: 'Block line '.length, endContainer: pocket, endOffset: 0 }],
  };
}

describe('native replacements that reach the next block', () => {
  it('insertText: replaces the hyphens and leaves the Pocket alone', () => {
    const { view, ranges } = scenario();
    const event = beforeInput(view, { inputType: 'insertText', data: '—', ranges });
    expect(event.defaultPrevented).toBe(true);
    expect(blocksOf(view.state.doc)).toEqual([
      ['block', 'Block line —'],
      ['pocket', 'Disad pocket'],
    ]);
    // The caret lands right after the dash, still in the Block line.
    expect(view.state.selection.from).toBe(1 + 'Block line —'.length);
  });

  it('insertReplacementText: the text comes from dataTransfer', () => {
    const { view, ranges } = scenario();
    const event = beforeInput(view, { inputType: 'insertReplacementText', replacement: '—', ranges });
    expect(event.defaultPrevented).toBe(true);
    expect(blocksOf(view.state.doc)).toEqual([
      ['block', 'Block line —'],
      ['pocket', 'Disad pocket'],
    ]);
  });

  it('with no target ranges it falls back to the selection', () => {
    const { view } = scenario();
    const from = 1 + 'Block line '.length;
    const pocketStart = view.state.doc.child(0).nodeSize; // start of the Pocket node
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, pocketStart + 1)));
    const event = beforeInput(view, { inputType: 'insertText', data: '—' });
    expect(event.defaultPrevented).toBe(true);
    expect(blocksOf(view.state.doc)).toEqual([
      ['block', 'Block line —'],
      ['pocket', 'Disad pocket'],
    ]);
  });

  it('keeps formatting on the replaced text', () => {
    const bold = schema.marks['bold']!;
    const view = mount(docOf(schema.nodes['paragraph']!.create(null, schema.text('Line ---', [bold.create()])), para('next')));
    // The mark wraps the text in an element — the range starts in the text node.
    const text = document.createTreeWalker(view.dom.querySelector('p')!, NodeFilter.SHOW_TEXT).nextNode()!;
    const next = view.dom.querySelectorAll('p')[1]!;
    beforeInput(view, {
      inputType: 'insertText',
      data: '—',
      ranges: [{ startContainer: text, startOffset: 'Line '.length, endContainer: next, endOffset: 0 }],
    });
    const first = view.state.doc.child(0);
    expect(first.textContent).toBe('Line —');
    expect(first.lastChild!.marks.some((m) => m.type === bold)).toBe(true);
  });
});

describe('native inserts it leaves to the browser', () => {
  it('a replacement inside one line', () => {
    const view = mount(docOf(heading('block', 'Block line ---'), heading('pocket', 'Disad pocket')));
    const text = view.dom.querySelector('h3')!.firstChild!;
    const event = beforeInput(view, {
      inputType: 'insertText',
      data: '—',
      ranges: [{ startContainer: text, startOffset: 'Block line '.length, endContainer: text, endOffset: 'Block line ---'.length }],
    });
    expect(event.defaultPrevented).toBe(false);
    expect(blocksOf(view.state.doc)[1]).toEqual(['pocket', 'Disad pocket']);
  });

  it('a replacement that reaches INTO the next line keeps the merging behavior', () => {
    const view = mount(docOf(heading('block', 'Block line ---'), heading('pocket', 'Disad pocket')));
    const text = view.dom.querySelector('h3')!.firstChild!;
    const pocketText = view.dom.querySelector('h1')!.firstChild!;
    const event = beforeInput(view, {
      inputType: 'insertText',
      data: 'X',
      ranges: [{ startContainer: text, startOffset: 'Block line '.length, endContainer: pocketText, endOffset: 3 }],
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it('a collapsed cursor, composition, an uncancelable event, and other input types', () => {
    const { view, ranges } = scenario();
    const collapsed = [{ ...ranges[0]!, endContainer: ranges[0]!.startContainer, endOffset: ranges[0]!.startOffset }];
    expect(beforeInput(view, { inputType: 'insertText', data: '—', ranges: collapsed }).defaultPrevented).toBe(false);
    expect(beforeInput(view, { inputType: 'insertText', data: '—', ranges, isComposing: true }).defaultPrevented).toBe(false);
    expect(beforeInput(view, { inputType: 'insertText', data: '—', ranges, cancelable: false }).defaultPrevented).toBe(false);
    expect(beforeInput(view, { inputType: 'insertCompositionText', data: '—', ranges }).defaultPrevented).toBe(false);
    expect(beforeInput(view, { inputType: 'insertFromPaste', data: '—', ranges }).defaultPrevented).toBe(false);
    expect(blocksOf(view.state.doc)).toEqual([
      ['block', 'Block line ---'],
      ['pocket', 'Disad pocket'],
    ]);
  });

  it('replacement text with a line break in it', () => {
    const { view, ranges } = scenario();
    expect(beforeInput(view, { inputType: 'insertText', data: 'a\nb', ranges }).defaultPrevented).toBe(false);
  });
});
