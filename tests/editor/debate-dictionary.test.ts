/**
 * The debate / policy supplement to the spellcheck dictionary
 * (`src/editor/dict/debate.dic`): words that real debate evidence uses must
 * pass, and ordinary typos must still be caught.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import nspell from 'nspell';

const read = (f: string): string => readFileSync(new URL(`../../src/editor/dict/${f}`, import.meta.url), 'utf8');
const speller = nspell(read('en.aff'), read('en.dic') + '\n' + read('debate.dic'));

describe('debate dictionary supplement', () => {
  it('accepts debate and policy vocabulary the base list lacked', () => {
    const words = [
      'empirics', 'neoliberal', 'neoliberalism', 'unipolarity', 'multilateralism',
      'kritik', 'kritiks', 'policymaking', 'securitization', 'decarbonization',
      'Zelensky', 'Rawlsian', 'Foucauldian',
    ];
    expect(words.filter((w) => !speller.correct(w))).toEqual([]);
  });

  it('applies the affix flags (plurals, possessives, adverbs)', () => {
    expect(speller.correct('kritiks')).toBe(true);
    expect(speller.correct("kritik's")).toBe(true);
    expect(speller.correct('neoliberally')).toBe(true);
  });

  it('still flags ordinary misspellings', () => {
    const typos = ['teh', 'recieve', 'goverment', 'hegmony', 'empircs', 'seperate', 'neoliberlism'];
    expect(typos.filter((w) => speller.correct(w))).toEqual([]);
  });
});
