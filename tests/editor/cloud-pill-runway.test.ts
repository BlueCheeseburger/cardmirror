/** The cloud pill's bottom runway (style.css): both layouts pad the editor
 *  the pill sits over while the pill is showing, like the left tray. jsdom
 *  does no layout, so this pins the stylesheet. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../../src/editor/style.css', import.meta.url)), 'utf8');

describe('cloud pill runway', () => {
  it('pads single-doc #editor and the tagged rightmost pane, only while the pill is active, at the left tray value', () => {
    const single = css.match(/html\.pmd-disk-pill-active body:not\(\.pmd-multi-doc\) #editor \.ProseMirror \{\n\s*padding-bottom: ([^;]+);/u);
    const pane = css.match(/html\.pmd-disk-pill-active \.pmd-pane-cloud-pill-anchored \.pmd-pane-editor \.ProseMirror \{\n\s*padding-bottom: ([^;]+);/u);
    const left = css.match(/html\.pmd-pill-tray-active body:not\(\.pmd-multi-doc\) #editor \.ProseMirror \{\n\s*padding-bottom: ([^;]+);/u);
    expect(single?.[1]).toBeDefined();
    expect(pane?.[1]).toBeDefined();
    expect(single?.[1]).toBe(left?.[1]);
    expect(pane?.[1]).toBe(left?.[1]);
  });
});
