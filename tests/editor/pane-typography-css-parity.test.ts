/**
 * Single-doc and multi-pane editors style the same document through two
 * parallel sets of rules: the single-doc ones key on a class on `#editor`,
 * the pane ones on the same flag mirrored onto <html>. When the two drift,
 * a style shows in one layout and silently vanishes in the other (underlined
 * cites lost their line over highlighted words in panes, and ignored the
 * underline thickness). This guards the typography flags against that, by
 * reading the stylesheet; the rendered comparison was run in Chromium.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/editor/style.css', import.meta.url), 'utf8');

/** Flags `applyDisplayTypography` puts on both `#editor` and <html>. */
const FLAGS_WITH_SINGLE_DOC_RULES = [
  'pmd-undertag-italic',
  'pmd-undertag-bold',
  'pmd-cite-underlined',
  'pmd-underline-bold',
  'pmd-emphasis-bold',
  'pmd-emphasis-italic',
  'pmd-emphasis-box',
];

describe('typography flag rules exist for both layouts', () => {
  for (const flag of FLAGS_WITH_SINGLE_DOC_RULES) {
    it(`${flag} styles panes as well as #editor`, () => {
      expect(css).toContain(`#editor.${flag}`);
      expect(css).toContain(`html.${flag} .pmd-pane-editor`);
    });
  }
});

describe('underlined cites in panes', () => {
  it('carry the underline thickness', () => {
    const rule = css.match(/html\.pmd-cite-underlined \.pmd-pane-editor \.pmd-cite \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain('text-decoration-thickness: var(--pmd-underline-size');
  });

  it('keep their underline over highlighted and shaded words, in both bands', () => {
    for (const band of ['light', 'dark']) {
      const selector = new RegExp(
        `:is\\(\\.pmd-underline, \\.pmd-emphasis, #editor\\.pmd-cite-underlined \\.pmd-cite,\\s*html\\.pmd-cite-underlined \\.pmd-pane-editor \\.pmd-cite\\)\\s*:is\\(\\[data-highlight-band="${band}"\\], \\[data-shading-band="${band}"\\]\\)`,
      );
      expect(css).toMatch(selector);
    }
  });
});
