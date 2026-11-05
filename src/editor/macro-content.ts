/**
 * Turning what a user typed in the macro editor into a formatted macro's saved
 * content, and back. Pure (no DOM), so the rules are testable.
 *
 * The saved content is a ProseMirror slice as JSON, the form Quick Cards store.
 * One thing differs from a quick card: a macro of a single plain paragraph is
 * saved as an INLINE slice (open on both sides), so pressing the key types the
 * text into the paragraph you are in, with its marks, instead of splitting the
 * paragraph the way a block would. Anything with styles (a tag, a cite line, an
 * analytic, headings) or several paragraphs is saved as blocks and arrives the
 * way a paste of it would.
 */

import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../schema/index.js';
import { checkedSliceFromJSON } from '../schema/slice-check.js';

export interface MacroContent {
  /** The slice to store (`Slice.toJSON()`). */
  json: unknown;
  /** The text of it, one line per block: the macro's label and its fallback. */
  plainText: string;
}

/** The content of the edited doc, or null when it is empty. A trailing empty
 *  paragraph (the editor leaves one after a block) is dropped. */
export function macroContentFromDoc(doc: PMNode): MacroContent | null {
  let end = doc.content.size;
  const last = doc.lastChild;
  if (last && last.isTextblock && last.content.size === 0 && doc.childCount > 1) end -= last.nodeSize;
  const plainText = doc.textBetween(0, end, '\n', '\n');
  if (end === 0 || (plainText.trim() === '' && doc.childCount <= 1)) return null;
  const only = doc.childCount === 1 ? doc.firstChild : null;
  const inline = only !== null && only.type.name === 'paragraph';
  const slice = inline ? doc.slice(1, doc.content.size - 1) : doc.slice(0, end);
  return { json: slice.toJSON(), plainText };
}

/** An editable doc for the macro editor, seeded from the macro's content, else
 *  from its plain text. Inserting the slice into an empty doc handles an inline
 *  slice and a block slice alike, as a paste would. */
export function docForMacro(m: { text: string; contentJson?: unknown }): PMNode {
  const empty = schema.topNodeType.createAndFill() ?? schema.topNodeType.create();
  let state = EditorState.create({ doc: empty, schema });
  try {
    if (m.contentJson != null) {
      state = state.apply(state.tr.replaceSelection(checkedSliceFromJSON(m.contentJson)));
      return state.doc;
    }
  } catch {
    /* damaged content: seed from the plain text below */
  }
  if (m.text) state = state.apply(state.tr.insertText(m.text));
  return state.doc;
}
