/**
 * Author search: names out of cites, the author's own cards, and the headings
 * in the user's files that name the author, ranked by the attack words they hold.
 */
import { describe, expect, it } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import type { Node as PMNode } from 'prosemirror-model';
import {
  authorsFromCite,
  parseAuthorQuery,
  attackWordsIn,
  searchAuthors,
  parseAttackWords,
  DEFAULT_ATTACK_WORDS,
} from '../../src/editor/author-search.js';
import { extractTaglines, findHeadingEntry, type TaglineFile } from '../../src/editor/tagline-search.js';

describe('authorsFromCite', () => {
  it.each([
    ['Stein 21', ['stein']],
    ['Stein and Lee 23', ['stein', 'lee']],
    ['Stein, Lee 2021', ['stein', 'lee']],
    ['Stein & Lee 23', ['stein', 'lee']],
    ['Stein et al. 23', ['stein']],
    ["O'Brien '19", ["o'brien"]],
    ['O’Brien ’19', ["o'brien"]],
    ['de la Cruz 21', ['de la cruz']],
    ['Smith-Jones 22', ['smith-jones']],
    ['Müller 20', ['muller']],
    ['Bloomberg News 21', ['bloomberg news']],
    ['Stein', ['stein']],
    ['', []],
  ])('%s', (cite, want) => {
    expect(authorsFromCite(cite)).toEqual(want);
  });
});

describe('parseAuthorQuery', () => {
  it('splits a name from a year', () => {
    expect(parseAuthorQuery('stein')).toEqual({ name: 'stein', words: ['stein'], year: null });
    expect(parseAuthorQuery('Stein 21')).toEqual({ name: 'stein', words: ['stein'], year: '21' });
    expect(parseAuthorQuery("de la cruz '19")).toEqual({ name: 'de la cruz', words: ['de', 'la', 'cruz'], year: '19' });
    expect(parseAuthorQuery('stein 2021')?.year).toBe('21');
  });
  it('is null with no name', () => {
    expect(parseAuthorQuery('  ')).toBeNull();
    expect(parseAuthorQuery('21')).toBeNull();
  });
});

describe('attackWordsIn', () => {
  const words = DEFAULT_ATTACK_WORDS;
  it('finds whole words, case-insensitively', () => {
    expect(attackWordsIn('Stein is a HACK, funded by industry', words)).toEqual(['hack', 'funded']);
    expect(attackWordsIn('Reject Stein: no qualifications', words)).toEqual(['no qualifications', 'reject']);
  });
  it('does not match inside another word', () => {
    expect(attackWordsIn('Hackathon results', words)).toEqual([]);
    expect(attackWordsIn('Rejection of tariffs', words)).toEqual([]);
  });
  it('matches a short all-caps entry (AT, A2) only as written', () => {
    expect(attackWordsIn('AT: Stein', words)).toEqual(['AT']);
    expect(attackWordsIn('A2: Stein', words)).toEqual(['A2']);
    expect(attackWordsIn('look at Stein', words)).toEqual([]);
  });
  it('reads the setting as a comma list', () => {
    expect(parseAttackWords('AT, A2 ,hack,, no qualifications')).toEqual(['AT', 'A2', 'hack', 'no qualifications']);
  });
});

// ── A file's index record, built from a real doc ───────────────────
const card = (tag: string, cite: string): PMNode =>
  schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['cite_paragraph']!.create(
      null,
      schema.text(cite, [schema.marks['cite_mark']!.create()]),
    ),
    schema.nodes['card_body']!.create(null, schema.text('body')),
  ]);
const block = (text: string): PMNode => schema.nodes['block']!.create({ id: newHeadingId() }, schema.text(text));
const docOf = (...c: PMNode[]): PMNode => schema.nodes['doc']!.createChecked(null, c);

function file(name: string, mtimeMs: number, doc: PMNode): TaglineFile {
  return { path: `/f/${name}.docx`, relPath: `${name}.docx`, name, mtimeMs, record: extractTaglines(doc) };
}

const econ = docOf(
  block('Tariffs'),
  card('Tariffs raise prices', 'Stein 21'),
  card('Debt ceiling default hurts markets', 'Stein 19'),
  card('Growth is fine', 'Lee 22'),
);
const shell = docOf(
  block('AT: Stein'),
  card('Stein is a hack: funded by industry', 'Park 20'),
  card('Stein says tariffs fail', 'Stein 21'), // their own card: not a response to them
  block('Reject Stein: no qualifications'),
  block('Stein relies on old data'),
  block('Steiner is unrelated: biased'),
  card('Lee is biased', 'Wu 20'),
);

describe('extractTaglines (author data)', () => {
  it('records the authors of each card and every heading with the card it heads', () => {
    const rec = extractTaglines(econ);
    expect(rec.authors).toEqual([['stein'], ['stein'], ['lee']]);
    expect(rec.heads!.t).toEqual(['Tariffs', 'Tariffs raise prices', 'Debt ceiling default hurts markets', 'Growth is fine']);
    expect(rec.heads!.c).toEqual([-1, 0, 1, 2]);
    expect(rec.heads!.l).toEqual([3, 4, 4, 4]);
  });
});

describe('searchAuthors', () => {
  const files = [file('Econ', 2000, econ), file('Shell', 1000, shell)];
  const opts = { attackWords: DEFAULT_ATTACK_WORDS, limit: 50 };

  it("lists the author's cards, newest file first", () => {
    const r = searchAuthors(files, 'stein', opts);
    expect(r.by.map((x) => x.text)).toEqual([
      'Tariffs raise prices',
      'Debt ceiling default hurts markets',
      'Stein says tariffs fail',
    ]);
    expect(r.totalBy).toBe(3);
  });

  it('narrows by year', () => {
    const r = searchAuthors(files, 'stein 19', opts);
    expect(r.by.map((x) => x.text)).toEqual(['Debt ceiling default hurts markets']);
  });

  it('lists headings that name the author as responses, the most attack words first', () => {
    const r = searchAuthors(files, 'stein', opts);
    expect(r.responses.map((x) => [x.text, x.matched])).toEqual([
      ['Stein is a hack: funded by industry', ['hack', 'funded']],
      ['Reject Stein: no qualifications', ['no qualifications', 'reject']],
      ['AT: Stein', ['AT']],
    ]);
  });

  it('keeps a heading that only names the author apart, as a mention', () => {
    const r = searchAuthors(files, 'stein', opts);
    expect(r.mentions.map((x) => x.text)).toEqual(['Stein relies on old data']);
  });

  it("never lists the author's own cards as responses to them", () => {
    const r = searchAuthors(files, 'stein', opts);
    expect([...r.responses, ...r.mentions].some((x) => x.text === 'Stein says tariffs fail')).toBe(false);
  });

  it('matches whole words only (Steiner is not Stein)', () => {
    const r = searchAuthors(files, 'stein', opts);
    expect([...r.responses, ...r.mentions].some((x) => x.text.startsWith('Steiner'))).toBe(false);
  });

  it('matches a possessive', () => {
    const f = file('P', 1, docOf(block("Stein's study is biased")));
    const r = searchAuthors([f], 'stein', opts);
    expect(r.responses.map((x) => x.text)).toEqual(["Stein's study is biased"]);
  });

  it('collapses the same heading in several files, newest first, with a count', () => {
    const a = file('A', 1000, docOf(block('AT: Stein')));
    const b = file('B', 2000, docOf(block('AT: Stein')));
    const r = searchAuthors([a, b], 'stein', opts);
    expect(r.responses).toHaveLength(1);
    expect(r.responses[0]!.name).toBe('B');
    expect(r.responses[0]!.alsoIn).toBe(1);
  });

  it('with a year, drops a heading naming a different year of the same surname', () => {
    const f = file('Y', 1, docOf(block("AT: Stein '19"), block('AT: Stein 21'), block('AT: Stein')));
    const r = searchAuthors([f], 'stein 21', opts);
    expect(r.responses.map((x) => x.text).sort()).toEqual(['AT: Stein', 'AT: Stein 21']);
  });

  it('uses the attack words it is given', () => {
    const f = file('W', 1, docOf(block('Stein is a hack'), block('Stein is dubious')));
    const r = searchAuthors([f], 'stein', { attackWords: ['dubious'], limit: 10 });
    expect(r.responses.map((x) => x.text)).toEqual(['Stein is dubious']);
    expect(r.mentions.map((x) => x.text)).toEqual(['Stein is a hack']);
  });

  it('skips a file indexed before author data existed', () => {
    const old: TaglineFile = { path: '/o', relPath: 'o', name: 'o', mtimeMs: 1, record: { tags: ['T'], cites: ['Stein 21'] } };
    expect(searchAuthors([old], 'stein', opts).totalBy).toBe(0);
  });

  it('is empty with no name', () => {
    expect(searchAuthors(files, '  ', opts).by).toEqual([]);
  });

  it('caps each list', () => {
    const r = searchAuthors(files, 'stein', { attackWords: DEFAULT_ATTACK_WORDS, limit: 1 });
    expect(r.by).toHaveLength(1);
    expect(r.totalBy).toBe(3);
  });
});

describe('findHeadingEntry', () => {
  it('finds a heading by its index, then by its text when the file changed', () => {
    const rec = extractTaglines(shell);
    const idx = rec.heads!.t.indexOf('AT: Stein');
    expect(findHeadingEntry(shell, idx, 'AT: Stein')?.text).toBe('AT: Stein');
    expect(findHeadingEntry(shell, 0, 'Reject Stein: no qualifications')?.text).toBe('Reject Stein: no qualifications');
    expect(findHeadingEntry(shell, 0, 'gone')).toBeNull();
  });
});
