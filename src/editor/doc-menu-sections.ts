/**
 * The Doc menu's rows, defined once. The toolbar's Doc dropdown and the "Doc"
 * submenu of the outline's right-click menu (on pockets, hats and blocks) both
 * build from this, so the two are the same list by construction. Each host
 * says how to run a command: the toolbar runs it on the editor's selection (or
 * the whole document when nothing is selected); the outline runs it over the
 * right-clicked heading and everything under it.
 */
import type { DocMenuSection } from './doc-menu-ui.js';
import type { RibbonCommandId } from './ribbon-commands.js';
import { highlightColorLabel, shadingColorLabel } from './color-palette.js';
import { settings } from './settings.js';

export interface DocMenuHost {
  /** Run a Doc-menu command over the host's scope. */
  run(id: RibbonCommandId): void;
}

export function buildDocMenuSections(host: DocMenuHost): DocMenuSection[] {
  const row = (label: string, commandId: RibbonCommandId) => ({
    label,
    commandId,
    run: () => host.run(commandId),
  });
  // Sections alphabetical by title — Cleanup, Highlighting, Select. The
  // exception rows read the live colors from settings, so the menu is built
  // fresh each time it opens.
  return [
    {
      title: 'Cleanup',
      items: [
        row('Convert Analytics to Tags', 'convertAnalyticsToTags'),
        row('Convert Cited Analytics to Tags', 'convertCitedAnalyticsToTags'),
        row('Fix Formatting Gaps', 'fixFormattingGaps'),
        row('Remove Hyperlinks', 'removeHyperlinks'),
        row('Link URLs', 'linkUrls'),
      ],
    },
    {
      title: 'Highlighting',
      items: [
        row('Standardize Highlighting', 'standardizeHighlight'),
        row('Standardize Background Color', 'standardizeShading'),
        row(
          `Standardize Highlighting (except ${highlightColorLabel(settings.get('standardizeHighlightException'))})`,
          'standardizeHighlightExcept',
        ),
        row(
          `Standardize Background Color (except ${shadingColorLabel(settings.get('standardizeShadingException'))})`,
          'standardizeShadingExcept',
        ),
      ],
    },
    {
      title: 'Select',
      items: [row('Select Similar Formatting', 'selectSimilar')],
    },
  ];
}
