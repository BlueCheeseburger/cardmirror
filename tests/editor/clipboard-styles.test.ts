// @vitest-environment jsdom
/**
 * Frozen appearance on copied HTML (clipboard-styles.ts). The invariant
 * that matters: the styled HTML parses back through the schema to exactly
 * the document the unstyled HTML did — in this version and, since the
 * schema files are unchanged since 1.6.0, in every earlier one.
 */
import { describe, it, expect } from 'vitest';
import { DOMParser as PMDOMParser, DOMSerializer, Fragment, type Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { freezeStylesInto, withFrozenStyles, frozenAppearanceFromSettings, type FrozenAppearance } from '../../src/editor/clipboard-styles.js';
import { detectPasteDialect } from '../../src/editor/paste-dialect.js';
import { DEFAULT_DISPLAY_COLORS, DEFAULT_DISPLAY_SIZES } from '../../src/editor/settings.js';

const mark = (name: string, attrs?: Record<string, unknown>) => schema.marks[name]!.create(attrs);
const txt = (s: string, ...marks: ReturnType<typeof mark>[]) => schema.text(s, marks);
const heading = (type: string, text: string, attrs: Record<string, unknown> = {}) =>
  schema.nodes[type]!.create({ id: newHeadingId(), ...attrs }, schema.text(text));

/** A fragment touching every structural node and every mark the clipboard carries. */
function richFragment(): Fragment {
  const card = schema.nodes['card']!.createChecked({ numRole: 'number' }, [
    heading('tag', 'Tag text', { indent: 30 }),
    schema.nodes['cite_paragraph']!.create(null, [
      txt('Smith ', mark('cite_mark')),
      txt('24', mark('cite_mark'), mark('font_size', { halfPoints: 20 })),
      txt(' — Journal, ', mark('font_size', { halfPoints: 20 })),
      txt('link', mark('link', { href: 'https://example.org' })),
    ]),
    schema.nodes['card_body']!.create(null, [
      txt('plain '),
      txt('under ', mark('underline_mark')),
      txt('emph ', mark('emphasis_mark')),
      txt('yellow ', mark('underline_mark'), mark('highlight', { color: 'yellow' })),
      txt('blue ', mark('highlight', { color: 'blue' })),
      txt('bold ', mark('bold')),
      txt('italic ', mark('italic')),
      txt('struck ', mark('strikethrough')),
      txt('sup', mark('superscript')),
      txt(' red ', mark('font_color', { color: 'FF0000' })),
      txt('shaded ', mark('shading', { color: 'D9D9D9' })),
      txt('direct', mark('underline_direct')),
      txt('¶', mark('pilcrow_marker')),
    ]),
    schema.nodes['undertag']!.create(null, schema.text('undertag')),
  ]);
  const unit = schema.nodes['analytic_unit']!.createChecked(null, [
    heading('analytic', 'Analytic'),
    schema.nodes['card_body']!.create(null, [txt('a '), txt('note', mark('analytic_mark'))]),
  ]);
  return Fragment.from([
    heading('pocket', 'Pocket'),
    heading('hat', 'Hat'),
    heading('block', 'Block'),
    card,
    unit,
    schema.nodes['paragraph']!.create({ align: 'center' }, txt('loose')),
  ]);
}

function html(serializer: DOMSerializer, frag: Fragment): string {
  const div = document.createElement('div');
  div.appendChild(serializer.serializeFragment(frag));
  return div.innerHTML;
}
function parse(h: string): Fragment {
  const div = document.createElement('div');
  div.innerHTML = h;
  return PMDOMParser.fromSchema(schema).parseSlice(div).content;
}
const plain = DOMSerializer.fromSchema(schema);
const styled = withFrozenStyles(DOMSerializer.fromSchema(schema));

describe('frozen clipboard styles', () => {
  it('parse back to exactly the document the unstyled HTML does', () => {
    const frag = richFragment();
    const before = parse(html(plain, frag));
    const after = parse(html(styled, frag));
    expect(after.eq(before), 'styled and unstyled HTML parse identically').toBe(true);
    // And that parse is the original (modulo attrs the DOM never carried).
    expect(after.textBetween(0, after.size, '\n')).toBe(frag.textBetween(0, frag.size, '\n'));
    let marksAfter = '';
    let marksBefore = '';
    after.descendants((n) => { if (n.isText) marksAfter += n.marks.map((m) => m.type.name).join(',') + ';'; });
    frag.descendants((n) => { if (n.isText) marksBefore += n.marks.map((m) => m.type.name).join(',') + ';'; });
    expect(marksAfter).toBe(marksBefore);
  });

  it('never writes a property the schema parser turns into a mark or an attr', () => {
    const h = html(styled, richFragment());
    const div = document.createElement('div');
    div.innerHTML = h;
    for (const el of Array.from(div.querySelectorAll<HTMLElement>('[style]'))) {
      const s = el.getAttribute('style')!;
      expect(s, el.outerHTML.slice(0, 80)).not.toMatch(/font-weight|font-style|line-through|vertical-align/);
      expect(el.tagName === 'P' ? s : '', 'text-align only on headings').not.toMatch(/text-align/);
    }
    // The tag's own indent survives untouched (never overwritten, never added elsewhere).
    expect(div.querySelector('h4.pmd-tag')!.getAttribute('style')).toMatch(/^padding-left: 2px;/);
    expect(h.match(/padding-left/g)!.length).toBe(1);
  });

  it('is still recognized as CardMirror HTML by the paste dialect router', () => {
    expect(detectPasteDialect(html(styled, richFragment()))).toBeNull();
    const bare = Fragment.from([schema.nodes['paragraph']!.create(null, [txt('just '), txt('bold', mark('bold'))])]);
    expect(detectPasteDialect(html(styled, bare))).toBeNull();
  });

  it('carries the display settings as inline styles', () => {
    const div = document.createElement('div');
    div.innerHTML = html(styled, richFragment());
    const style = (sel: string) => div.querySelector<HTMLElement>(sel)!.style;
    expect(style('h1.pmd-pocket').fontSize).toBe(`${DEFAULT_DISPLAY_SIZES.pocket}pt`);
    expect(style('h1.pmd-pocket').border).toContain('solid');
    expect(style('h2.pmd-hat').textDecoration).toBe('underline double');
    expect(style('h4.pmd-tag').fontSize).toBe(`${DEFAULT_DISPLAY_SIZES.tag}pt`);
    expect(style('h4.pmd-tag').fontFamily).toBe('"Times New Roman"');
    expect(style('p.pmd-analytic').color).toBe('rgb(31, 56, 100)'); // #1F3864
    expect(style('p.pmd-undertag').color).toBe('rgb(56, 86, 35)'); // #385623
    expect(style('.pmd-underline').textDecoration).toBe('underline');
    expect(style('.pmd-emphasis').border).toContain('solid');
    expect(style('.pmd-highlight[data-highlight="yellow"]').backgroundColor).toBe('rgb(255, 255, 0)');
    expect(style('.pmd-highlight[data-highlight="blue"]').color, 'dark band → white text').toBe('rgb(255, 255, 255)');
    expect(style('p.pmd-card-body').fontSize).toBe(`${DEFAULT_DISPLAY_SIZES.normal}pt`);
    // A cite inside a run with its own size takes the run size, as the CSS does.
    const cites = Array.from(div.querySelectorAll<HTMLElement>('.pmd-cite'));
    expect(cites.map((c) => c.style.fontSize)).toEqual([`${DEFAULT_DISPLAY_SIZES.cite}pt`, '10pt']);
    expect(frozenAppearanceFromSettings().colors.analytic.toLowerCase()).toBe(DEFAULT_DISPLAY_COLORS.analytic.toLowerCase());
  });

  it('follows the typography flags', () => {
    const app: FrozenAppearance = {
      ...frozenAppearanceFromSettings(),
      typography: { ...frozenAppearanceFromSettings().typography, emphasisBox: false, pocketBox: false, hatUnderlineDouble: false, citeUnderlined: true, underlineSize: 1.5 },
      bodyFont: 'Calibri',
    };
    const div = document.createElement('div');
    div.appendChild(plain.serializeFragment(richFragment()));
    freezeStylesInto(div, app);
    const style = (sel: string) => div.querySelector<HTMLElement>(sel)!.style;
    expect(style('.pmd-emphasis').border).toBe('');
    expect(style('h1.pmd-pocket').border).toBe('');
    expect(style('h2.pmd-hat').textDecoration).toBe('underline');
    expect(style('.pmd-cite').textDecoration).toBe('underline');
    expect(style('.pmd-underline').textDecorationThickness).toBe('1.5pt');
    expect(style('h4.pmd-tag').fontFamily).toBe('Calibri');
  });
});
