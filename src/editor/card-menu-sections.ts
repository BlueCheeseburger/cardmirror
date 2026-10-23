/**
 * The Card menu's rows, defined once. The toolbar's Card dropdown and the
 * "Card" submenu of the outline's right-click menu both build from this, so
 * the two are the same list by construction: add a row here and both get it.
 * Each host says which cards the rows act on (the cursor's card, or the
 * right-clicked heading(s)) and how to run a command over them.
 */
import type { EditorState } from 'prosemirror-state';
import type { DocMenuSection } from './doc-menu-ui.js';
import { cardHighlightAction } from './card-highlight-toggle.js';
import type { DocRange } from './card-highlight-toggle.js';
import { cardMarkAction } from './reading-marker.js';
import type { RibbonCommandId } from './ribbon-commands.js';

export interface CardMenuHost {
  /** The state the rows are decided from when the menu opens. */
  state(): EditorState | null;
  /** The ranges the rows act on. */
  ranges(state: EditorState): DocRange[];
  /** Run a Card-menu command over those ranges. */
  run(id: RibbonCommandId): void;
  /** Offer the Marking section (Mark Card / Unmark Card). The toolbar menu
   *  does; the outline's submenu leaves it out. Defaults to true. */
  marking?: boolean;
}

export function buildCardMenuSections(host: CardMenuHost): DocMenuSection[] {
  const state = host.state();
  const ranges = state ? host.ranges(state) : [];
  const highlight = state ? cardHighlightAction(state, ranges) : null;
  const mark = state && host.marking !== false ? cardMarkAction(state, ranges) : null;
  const row = (label: string, commandId: RibbonCommandId) => ({
    label,
    commandId,
    run: () => host.run(commandId),
  });
  // Sections are kept alphabetical by title.
  const sections: DocMenuSection[] = [
    {
      title: 'Condense',
      items: [
        row('Condense', 'condenseDefault'),
        row('Condense without paragraph integrity', 'condenseNoIntegrity'),
        row('Condense with pilcrows', 'condenseNoIntegrityWithPilcrows'),
        row('Condense with warning', 'condenseWithWarning'),
        row('Uncondense', 'uncondense'),
      ],
    },
    {
      title: 'Excerpt',
      items: [row('Create Reference', 'createReference'), row('Extract Undertag', 'extractUndertag')],
    },
    {
      title: 'Highlighting',
      items: [
        row('Lock Highlighting', 'lockHighlighting'),
        // One slot, two states: after Unhighlight Card the same row reads
        // Rehighlight Card for as long as the unhighlight is undoable.
        highlight === 'rehighlight'
          ? row('Rehighlight Card', 'rehighlightCard')
          : row('Unhighlight Card', 'unhighlightCard'),
        row('Highlight to Background', 'highlightToShading'),
        row('Background to Highlight', 'shadingToHighlight'),
      ],
    },
    { title: 'Shrink', items: [row('Shrink', 'shrink')] },
  ];
  if (host.marking !== false) {
    sections.splice(sections.length - 1, 0, {
      title: 'Marking',
      // One slot, two states: Unmark once every card in range carries a marker.
      items: [row(mark === 'unmark' ? 'Unmark Card' : 'Mark Card', 'markCards')],
    });
  }
  return sections;
}
