/**
 * Applying a custom style (see `custom-styles-model.ts` for what one is):
 * a named bundle of direct marks added to — or, when already fully there,
 * removed from — the selection, like Bold. Defined in Settings → Editing →
 * Custom styles; run from the palette, a keybinding or a custom ribbon button.
 */

import type { Mark } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../schema/index.js';
import type { CustomStyle } from './custom-styles-model.js';

export * from './custom-styles-model.js';

/** The marks a style sets, built against the schema. */
export function marksForCustomStyle(style: CustomStyle): Mark[] {
  const f = style.format;
  const m = schema.marks;
  const out: Mark[] = [];
  if (f.bold) out.push(m['bold']!.create());
  if (f.italic) out.push(m['italic']!.create());
  if (f.strikethrough) out.push(m['strikethrough']!.create());
  if (f.superscript) out.push(m['superscript']!.create());
  else if (f.subscript) out.push(m['subscript']!.create());
  if (f.color) out.push(m['font_color']!.create({ color: f.color }));
  if (f.highlight) out.push(m['highlight']!.create({ color: f.highlight }));
  if (f.font) out.push(m['font_family']!.create({ name: f.font }));
  if (f.size) out.push(m['font_size']!.create({ halfPoints: Math.round(f.size * 2) }));
  return out;
}

/** Is every mark of `style` already on ALL the selected text (or, for a caret,
 *  in force at the caret)? Decides whether running the style adds or removes it. */
export function isCustomStyleActive(state: EditorState, style: CustomStyle): boolean {
  const marks = marksForCustomStyle(style);
  if (marks.length === 0) return false;
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const here = state.storedMarks ?? $from.marks();
    return marks.every((mk) => mk.isInSet(here));
  }
  let sawText = false;
  let all = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    sawText = true;
    if (!marks.every((mk) => mk.isInSet(node.marks))) all = false;
  });
  return sawText && all;
}

/** Build the transaction that applies (or, when already fully applied, strips)
 *  the style — a toggle, like Bold. Null when the style sets nothing. */
export function customStyleTransaction(state: EditorState, style: CustomStyle): Transaction | null {
  const marks = marksForCustomStyle(style);
  if (marks.length === 0) return null;
  const remove = isCustomStyleActive(state, style);
  const { from, to, empty, $from } = state.selection;
  let tr = state.tr;
  if (empty) {
    let set = state.storedMarks ?? $from.marks();
    for (const mk of marks) set = remove ? mk.removeFromSet(set) : mk.addToSet(set);
    return tr.setStoredMarks(set);
  }
  for (const mk of marks) {
    tr = remove ? tr.removeMark(from, to, mk) : tr.addMark(from, to, mk);
  }
  return tr;
}

/** Run a custom style on the view's selection. */
export function applyCustomStyle(view: EditorView, style: CustomStyle): boolean {
  const tr = customStyleTransaction(view.state, style);
  if (!tr) return false;
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}
