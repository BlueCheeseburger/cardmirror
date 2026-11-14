/**
 * "New paragraph on Enter" — configurable per-structural-type Enter
 * behavior (the `enterAfter*` settings).
 *
 * When the cursor sits at the END of a structural textblock (pocket /
 * hat / block / tag / analytic / undertag) and that type's setting is
 * anything other than 'normal', pressing Enter behaves exactly like
 * pressing Enter and then the chosen style's command (F4 / F5 / F6 /
 * F7 / Mod-F7 / Mod-F8) on the fresh block. That equivalence is the
 * contract: all structural edge semantics — card splits, escaping a
 * card to doc level, analytic_unit wrapping — inherit the established
 * behavior of those commands rather than duplicating it here.
 *
 * The `enterAlwaysAnalytic` toggle (off by default) extends the same path
 * to plain paragraphs: Enter at the end of any line then makes the new line an
 * analytic, unless that block's own per-type setting already picks a style.
 * Card text (body, cite, undertag) is left out so a card keeps growing on Enter.
 *
 * 'normal' (the default for all six) returns false so the key falls
 * through to the regular Enter pipeline untouched — including the
 * tag-keymap overrides (Enter at end of a tag creates a card_body
 * INSIDE the card, not a doc-level paragraph) and user macro / ribbon
 * bindings between this keymap layer and baseKeymap.
 */

import { baseKeymap } from 'prosemirror-commands';
import type { Command, EditorState } from 'prosemirror-state';
import { settings, type EnterAfterStyle, type Settings } from './settings.js';
import { setAnalytic, setHeading, setTag, setUndertag } from './ribbon-commands.js';
import { enterAtTagEnd, enterInHeading, enterMidTag } from './tag-keymap.js';

const SETTING_KEY_BY_TYPE: Record<string, keyof Settings> = {
  pocket: 'enterAfterPocket',
  hat: 'enterAfterHat',
  block: 'enterAfterBlock',
  tag: 'enterAfterTag',
  analytic: 'enterAfterAnalytic',
  undertag: 'enterAfterUndertag',
};

/** The style commands, keyed by the setting's non-'normal' choices. */
const CONVERT_COMMAND: Record<Exclude<EnterAfterStyle, 'normal'>, () => Command> = {
  pocket: () => setHeading('pocket'),
  hat: () => setHeading('hat'),
  block: () => setHeading('block'),
  tag: () => setTag(),
  analytic: () => setAnalytic(),
  undertag: () => setUndertag(),
};

/** Lines that are part of a card's text. The "every new line is an analytic"
 *  toggle leaves these alone, so Enter at the end of a card's body, cite or
 *  undertag still adds a line to that card instead of ending it. */
const CARD_TEXT_TYPES = new Set(['card_body', 'cite_paragraph', 'undertag']);

/** The textblock type whose END the (empty) cursor sits at, or null. With
 *  `structuralOnly` just the six structural types count (the per-type
 *  settings); otherwise any textblock does (the "every Enter starts an
 *  analytic" toggle, which covers plain paragraphs and card text too). */
function typeAtEnd(state: EditorState, structuralOnly: boolean): string | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $from = sel.$from;
  const parent = $from.parent;
  if (!parent.isTextblock) return null;
  if (structuralOnly && !(parent.type.name in SETTING_KEY_BY_TYPE)) return null;
  if ($from.parentOffset !== parent.content.size) return null;
  return parent.type.name;
}

/** The Enter pipeline the styled path delegates to for the initial
 *  split — the same handlers the key would otherwise reach: the
 *  tag-keymap overrides first, then baseKeymap's Enter chain. */
const baseEnter: Command = (state, dispatch, view) =>
  enterAtTagEnd(state, dispatch, view) ||
  enterMidTag(state, dispatch, view) ||
  enterInHeading(state, dispatch, view) ||
  (baseKeymap['Enter'] as Command)(state, dispatch, view);

/**
 * Keymap command — bound FIRST in the Enter chain. Returns false
 * (untouched pipeline) unless the cursor is at the end of a
 * structural block whose setting picks a style; then it runs the
 * normal Enter and dispatches the style conversion on the result.
 * Two transactions, but prosemirror-history groups them into a
 * single undo event (verified by test).
 */
export const enterWithConfiguredStyle: Command = (state, dispatch, view) => {
  // The per-type choice wins; where it is 'normal' (or the block is not one of
  // the six structural types) the "every Enter starts an analytic" toggle,
  // when on, supplies the style. Either way only at the END of a block, so a
  // split in the middle of text keeps both halves as they were.
  let choice: EnterAfterStyle = 'normal';
  const structural = typeAtEnd(state, true);
  if (structural) choice = settings.get(SETTING_KEY_BY_TYPE[structural]!) as EnterAfterStyle;
  if (choice === 'normal' && settings.get('enterAlwaysAnalytic')) {
    const any = typeAtEnd(state, false);
    if (any && !CARD_TEXT_TYPES.has(any)) choice = 'analytic';
  }
  if (choice === 'normal') return false;
  if (!dispatch || !view) return baseEnter(state, dispatch, view);
  if (!baseEnter(state, dispatch, view)) return false;
  // `dispatch` was the view's own dispatch (keymap contract), so
  // view.state now reflects the split; convert the fresh block. A
  // conversion that's invalid where the block landed (a table cell, say)
  // returns false and leaves the plain Enter result — the same outcome as
  // pressing the style key there by hand.
  CONVERT_COMMAND[choice]()(view.state, view.dispatch.bind(view), view);
  return true;
};

/** Enter exactly as the key does it — the styled-paragraph rule first,
 *  then the tag / heading handlers, then the base split — for callers
 *  that are not a keymap: the voice "return" word and the dictation
 *  "new paragraph" break. (The keymap adds the live-view bottom-edge
 *  escape ahead of this; voice lands inside editable text only.) */
export const enterAsKey: Command = (state, dispatch, view) =>
  enterWithConfiguredStyle(state, dispatch, view) || baseEnter(state, dispatch, view);
