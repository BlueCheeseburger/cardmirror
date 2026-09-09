/**
 * "Underlines follow font color" (Appearance → Document typography, off
 * by default): a root predicate class the stylesheet reads to paint the
 * underline of a colored run in the run's own color — for the underline /
 * emphasis / underlined-cite marks and for hat / block headings.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { settings, SETTING_METADATA } from '../../src/editor/settings.js';

const css = readFileSync(resolve(process.cwd(), 'src/editor/style.css'), 'utf8');
const index = readFileSync(resolve(process.cwd(), 'src/editor/index.ts'), 'utf8');
/** The CSS rule blocks whose selector carries the root predicate class. */
const flagRules = (): string[] => {
  const out: string[] = [];
  const re = /(:root\.pmd-underline-follows-color[^{]*)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push(m[1]! + '{' + m[2]! + '}');
  return out;
};

describe('underlines follow font color', () => {
  it('is an Appearance toggle under Document typography, off by default', () => {
    const meta = SETTING_METADATA.find((m) => m.key === 'underlineFollowsFontColor')!;
    expect(meta).toBeTruthy();
    expect(meta.kind).toBe('toggle');
    expect(meta.category).toBe('appearance');
    expect(meta.section).toBe('Document typography');
    expect(settings.get('underlineFollowsFontColor')).toBe(false);
  });

  it('mirrors to the root class from the settings subscriber and the initial apply', () => {
    expect(index).toContain("classList.toggle('pmd-underline-follows-color', on)");
    expect(index.match(/applyUnderlineFollowsFontColor\(/g)!.length).toBeGreaterThanOrEqual(3); // def + 2 calls
    expect(index).toContain('applyUnderlineFollowsFontColor(s.underlineFollowsFontColor)');
    expect(index).toContain("applyUnderlineFollowsFontColor(settings.get('underlineFollowsFontColor'))");
  });

  it('re-declares the underline on colored runs inside every underline bearer, in the run’s own color', () => {
    const rules = flagRules();
    expect(rules.length).toBeGreaterThanOrEqual(4);
    const covering = (sel: string) => rules.filter((r) => r.includes(sel));
    for (const bearer of [':is(.pmd-underline', '.pmd-emphasis', ' u)', '.pmd-cite', '.pmd-block', '.pmd-hat']) {
      const hits = covering(bearer);
      expect(hits.length, bearer).toBeGreaterThan(0);
      for (const r of hits) {
        expect(r, bearer).toContain('[data-color]:not([data-color="000000"])');
        expect(r, bearer).toMatch(/text-decoration: underline/);
      }
    }
    // Hats: double by default, single under the hat flag.
    expect(covering('.pmd-hat').some((r) => r.includes('underline double'))).toBe(true);
    expect(covering('.pmd-hat').some((r) => r.includes('.pmd-hat-underline-single') && !r.includes('double'))).toBe(true);
    // The marks keep the configured thickness.
    for (const r of covering(':is(.pmd-underline')) expect(r).toContain('var(--pmd-underline-size, auto)');
    // Every rule paints in the run's own color.
    for (const r of rules) if (!r.includes('.pmd-hat-underline-single')) expect(r).toContain('currentColor');
  });
});
