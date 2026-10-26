/**
 * The blank document New creates — exactly one empty line (a plain
 * paragraph, or the user's "Default text style": Analytic by default), shared
 * by single-pane and the three-pane shell so the two modes cannot
 * drift. Pocket seeding is a speech-doc-only, setting-gated affordance
 * (`makeSpeechBlankDoc` behind "Seed new speech docs with a Pocket
 * heading"); a plain New must not grow headings — the pane chip / window
 * title already carry the doc's name, and the speech path's pocket-OFF
 * cursor math assumes position 1 is inside the only paragraph.
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { undoDepth } from 'prosemirror-history';
import { schema } from '../schema/index.js';
import { newHeadingId } from '../schema/ids.js';
import { settings } from './settings.js';

/** The empty top-level block a new doc starts with, in the user's "Default
 *  text style". An analytic is always anchored by an `analytic_unit` and a tag
 *  by a `card`; the others are bare doc-level blocks. */
export function makeStyledBlock(): PMNode {
  switch (settings.get('defaultTextStyle')) {
    case 'normal':
      return schema.nodes['paragraph']!.create();
    case 'undertag':
      return schema.nodes['undertag']!.create();
    case 'pocket':
    case 'hat':
    case 'block':
      return schema.nodes[settings.get('defaultTextStyle')]!.create({ id: newHeadingId() });
    case 'tag':
      return schema.nodes['card']!.createChecked(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }),
      ]);
    default:
      return schema.nodes['analytic_unit']!.createChecked(null, [
        schema.nodes['analytic']!.create({ id: newHeadingId() }),
      ]);
  }
}

export function makeBlankDoc(): PMNode {
  return schema.nodes['doc']!.createChecked(null, [makeStyledBlock()]);
}

/** True when `block` is an empty block `makeBlankDoc` can produce, whatever
 *  default style was in force when it was made. */
function isBlankSeedBlock(block: PMNode): boolean {
  if (block.type === schema.nodes['analytic_unit']) {
    return block.childCount === 1 && block.firstChild!.type === schema.nodes['analytic'] && block.firstChild!.content.size === 0;
  }
  if (block.type === schema.nodes['card']) {
    return block.childCount === 1 && block.firstChild!.type === schema.nodes['tag'] && block.firstChild!.content.size === 0;
  }
  return (
    (block.type === schema.nodes['paragraph'] ||
      block.type === schema.nodes['undertag'] ||
      block.type === schema.nodes['pocket'] ||
      block.type === schema.nodes['hat'] ||
      block.type === schema.nodes['block']) &&
    block.content.size === 0
  );
}

/** Offset from a seed block's start to the caret position inside its text:
 *  an `analytic_unit` wraps its analytic and a `card` wraps its tag, so the text
 *  sits one level deeper. */
export function seedCursorOffset(block: PMNode): number {
  return block.type === schema.nodes['analytic_unit'] || block.type === schema.nodes['card'] ? 2 : 1;
}

/** True when `state` is still exactly what New made: one empty
 *  paragraph AND nothing in the undo history. The history check is what
 *  keeps "typed something, then deleted it" from counting as untouched —
 *  the doc looks blank, but the user has worked in it. Used by the
 *  three-pane shell to let an opened file take an Untitled doc's place. */
export function isUntouchedBlank(state: EditorState): boolean {
  const doc = state.doc;
  if (doc.childCount !== 1) return false;
  if (!isBlankSeedBlock(doc.firstChild!)) return false;
  return undoDepth(state) === 0;
}
