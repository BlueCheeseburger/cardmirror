/**
 * A one-line preview of a formatted macro for the Settings list: its text with
 * the marks it will carry (underline, emphasis, highlight, cite, bold, italic),
 * lines separated by a return arrow, headings and tags in bold. The marks are
 * drawn by the same serializer and classes as the document, so what the list
 * shows is what the key will type.
 */

import { DOMSerializer } from 'prosemirror-model';
import { schema } from '../schema/index.js';
import { macroSlice } from './keyboard-macros.js';
import type { KeyboardMacro } from './settings.js';

const STRUCTURAL = new Set(['pocket', 'hat', 'block', 'tag', 'analytic', 'undertag', 'cite_paragraph']);

export function renderMacroPreview(m: Pick<KeyboardMacro, 'text' | 'contentJson'>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pmd-macro-preview';
  const slice = macroSlice(m);
  if (!slice) {
    wrap.textContent = m.text;
    return wrap;
  }
  const serializer = DOMSerializer.fromSchema(schema);
  let first = true;
  slice.content.descendants((node) => {
    if (!node.isTextblock) return true;
    if (!first) wrap.appendChild(Object.assign(document.createElement('span'), { className: 'pmd-macro-preview-break', textContent: ' ⏎ ' }));
    first = false;
    const line = document.createElement('span');
    if (STRUCTURAL.has(node.type.name)) line.className = 'pmd-macro-preview-structural';
    node.forEach((child) => line.appendChild(serializer.serializeNode(child)));
    wrap.appendChild(line);
    return false;
  });
  return wrap;
}
