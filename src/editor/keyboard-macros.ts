/**
 * Keyboard macros — user-defined "press a key → type this" bindings.
 *
 * A plain-text macro maps a ProseMirror-keymap key string to a command that
 * inserts its literal text at the cursor (replacing any selection), the same as
 * if the user had typed it. A FORMATTED macro (`contentJson`) inserts its saved
 * slice instead, the way a paste would: the text arrives with its styles (tag,
 * cite, analytic …) and marks (underline, emphasis, highlight, bold, italic …).
 * Built into a `keymap()` and slotted into the editor plugin stack ahead of the
 * ribbon keymap, so a macro key wins over a command bound to the same key.
 * Configured in Settings → Keyboard shortcuts → Keyboard macros.
 *
 * Word-style Repeat (repeat-last-action.ts) repeats a plain macro as typing and
 * a formatted one as a paste of the same slice.
 */

import type { Command } from 'prosemirror-state';
import type { Slice } from 'prosemirror-model';
import type { KeyboardMacro } from './settings.js';
import { REPEAT_TYPING_META } from './repeat-last-action.js';
import { checkedSliceFromJSON } from '../schema/slice-check.js';

/** The macro's formatted content as a validated slice, or null when it has none
 *  or it is damaged (the macro then types its plain `text`). */
export function macroSlice(m: Pick<KeyboardMacro, 'contentJson'>): Slice | null {
  if (m.contentJson == null) return null;
  try {
    const slice = checkedSliceFromJSON(m.contentJson);
    return slice.size > 0 ? slice : null;
  } catch {
    return null;
  }
}

/** Whether the macro carries formatting (a readable `contentJson`). */
export function isFormattedMacro(m: Pick<KeyboardMacro, 'contentJson'>): boolean {
  return macroSlice(m) !== null;
}

/** Produce a `keymap()`-ready binding object from the macro list. Macros
 *  with no key, or neither content nor text, are skipped; a later macro on
 *  the same key overrides an earlier one. */
export function buildMacroKeymap(macros: KeyboardMacro[]): Record<string, Command> {
  const out: Record<string, Command> = {};
  for (const m of macros) {
    if (!m.key) continue;
    const slice = macroSlice(m);
    if (slice) {
      out[m.key] = (state, dispatch) => {
        if (dispatch) {
          dispatch(
            state.tr
              .replaceSelection(slice)
              .setMeta('cm-repeat-set', { kind: 'paste', slice })
              .scrollIntoView(),
          );
        }
        return true;
      };
      continue;
    }
    if (!m.text) continue;
    const text = m.text;
    out[m.key] = (state, dispatch) => {
      if (dispatch) dispatch(state.tr.insertText(text).setMeta(REPEAT_TYPING_META, text).scrollIntoView());
      return true;
    };
  }
  return out;
}
