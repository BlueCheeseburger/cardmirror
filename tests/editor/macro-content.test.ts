// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { docForMacro, macroContentFromDoc } from '../../src/editor/macro-content.js';
import { buildMacroKeymap } from '../../src/editor/keyboard-macros.js';
import { renderMacroPreview } from '../../src/editor/macro-preview.js';

const mark = (name: string, attrs?: Record<string, unknown>) => schema.marks[name]!.create(attrs);
const para = (...runs: PMNode[]) => schema.nodes['paragraph']!.create(null, runs);
const docOf = (...children: PMNode[]) => schema.nodes['doc']!.createChecked(null, children);
const card = () =>
  schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag line')),
    schema.nodes['cite_paragraph']!.create(null, [schema.text('Smith 24', [mark('cite_mark')]), schema.text(', 2024')]),
    schema.nodes['card_body']!.create(null, schema.text('Body', [mark('underline_mark'), mark('highlight', { color: 'yellow' })])),
  ]);

describe('macroContentFromDoc', () => {
  it('is null for an empty document', () => {
    expect(macroContentFromDoc(docOf(para()))).toBeNull();
    expect(macroContentFromDoc(docOf(para(schema.text('  '))))).toBeNull();
  });

  it('saves a single plain paragraph as an inline slice, so it types into the line you are on', () => {
    const content = macroContentFromDoc(docOf(para(schema.text('cf. ', [mark('underline_mark')]), schema.text('Smith'))))!;
    expect(content.plainText).toBe('cf. Smith');
    const km = buildMacroKeymap([{ id: 'a', key: 'Mod-j', text: content.plainText, contentJson: content.json }]);
    let state = EditorState.create({ schema, doc: docOf(para(schema.text('abcdef'))) });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
    let next = state;
    km['Mod-j']!(state, (tr) => { next = state.apply(tr); });
    // One paragraph, text typed in the middle: not split into three.
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.textContent).toBe('abccf. Smithdef');
  });

  it('saves styled blocks as blocks, tag and cite and marks intact', () => {
    const content = macroContentFromDoc(docOf(card()))!;
    expect(content.plainText).toBe('Tag line\nSmith 24, 2024\nBody');
    const json = JSON.stringify(content.json);
    expect(json).toContain('"type":"tag"');
    expect(json).toContain('"type":"cite_paragraph"');
    expect(json).toContain('cite_mark');
    expect(json).toContain('underline_mark');
    expect(json).toContain('highlight');
  });

  it('drops the empty paragraph the editor leaves after a block', () => {
    const content = macroContentFromDoc(docOf(card(), para()))!;
    expect(content.plainText).toBe('Tag line\nSmith 24, 2024\nBody');
  });
});

describe('docForMacro', () => {
  it('re-opens a saved macro with the same text and formatting', () => {
    const content = macroContentFromDoc(docOf(card()))!;
    const back = docForMacro({ text: content.plainText, contentJson: content.json });
    expect(back.textContent).toContain('Tag line');
    let underlined = false;
    back.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'underline_mark')) underlined = true;
      return true;
    });
    expect(underlined).toBe(true);
  });

  it('seeds a plain-text macro with its text', () => {
    expect(docForMacro({ text: 'cf.' }).textContent).toBe('cf.');
  });

  it('falls back to the text when the saved content is damaged', () => {
    expect(docForMacro({ text: 'fallback', contentJson: { content: [{ type: 'nope' }] } }).textContent).toBe('fallback');
  });
});

describe('renderMacroPreview', () => {
  it('draws the marks with the document classes, lines split by a return arrow', () => {
    const content = macroContentFromDoc(docOf(card()))!;
    const el = renderMacroPreview({ text: content.plainText, contentJson: content.json });
    expect(el.querySelector('.pmd-cite')?.textContent).toBe('Smith 24');
    expect(el.querySelector('.pmd-underline')).not.toBeNull();
    expect(el.querySelector('.pmd-highlight')).not.toBeNull();
    expect(el.querySelectorAll('.pmd-macro-preview-break')).toHaveLength(2);
    expect(el.querySelector('.pmd-macro-preview-structural')?.textContent).toBe('Tag line');
  });

  it('shows a plain-text macro as just its text', () => {
    expect(renderMacroPreview({ text: 'cf.' }).textContent).toBe('cf.');
  });
});
