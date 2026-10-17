import { describe, it, expect } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  collectCardInfo,
  cardFingerprint,
  highlightWarnings,
  type CardInfo,
} from '../../src/editor/ai/card-analysis.js';
import {
  buildCrossExInput,
  parseQuestions,
  parseTraps,
  parseGrade,
  hasSideSplit,
  shortDocNotice,
  attachCards,
  HIGHLIGHT_CAP,
} from '../../src/editor/ai/crossex.js';
import {
  parseBatch,
  verdictFor,
  averageScore,
  scorableCards,
  credibilitySystemPrompt,
  BATCH_SIZE,
} from '../../src/editor/ai/credibility.js';
import { parseJsonLoose } from '../../src/editor/ai/tiers.js';

const hl = (text: string) =>
  schema.text(text, [schema.marks['highlight']!.create({ color: 'yellow' })]);
const ul = (text: string) => schema.text(text, [schema.marks['underline_mark']!.create()]);
const plain = (text: string) => schema.text(text);

function card(tagText: string, cite: string, ...body: any[][]) {
  const n = schema.nodes;
  return n['card']!.createChecked(null, [
    n['tag']!.create({ id: newHeadingId() }, schema.text(tagText)),
    ...(cite ? [n['cite_paragraph']!.create(null, schema.text(cite))] : []),
    ...body.map((b) => n['card_body']!.create(null, b)),
  ]);
}
const doc = (...c: any[]) => schema.nodes['doc']!.createChecked(null, c);
const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');

describe('collectCardInfo', () => {
  it('splits highlighted, underlined and small text and counts words', () => {
    const d = doc(card('Tag A', 'Brady 25', [hl('alpha beta '), plain('small text '), ul('under line')]));
    const [c] = collectCardInfo(d);
    expect(c!.tag).toBe('Tag A');
    expect(c!.cite).toBe('Brady 25');
    expect(c!.readText).toContain('alpha beta');
    expect(c!.readText).toContain('under line');
    expect(c!.smallText).toBe('small text');
    expect(c!.bodyWords).toBe(6);
    expect(c!.highlightedWords).toBe(2);
  });

  it('ignores blank (white) highlights', () => {
    const white = schema.text('erased words', [schema.marks['highlight']!.create({ color: 'white' })]);
    const [c] = collectCardInfo(doc(card('T', 'C 20', [white])));
    expect(c!.highlightedWords).toBe(0);
    expect(c!.readText).toBe('');
  });

  it('falls back to the first 80 body words when there is no cite paragraph', () => {
    const [c] = collectCardInfo(doc(card('T', '', [plain(words(120))])));
    expect(c!.cite.split(' ')).toHaveLength(80);
  });

  it('fingerprint changes when tags or count change', () => {
    const a = collectCardInfo(doc(card('A', 'x 1', [plain('b')]), card('B', 'y 2', [plain('b')])));
    const b = collectCardInfo(doc(card('A', 'x 1', [plain('b')]), card('C', 'y 2', [plain('b')])));
    expect(cardFingerprint(a)).not.toBe(cardFingerprint(b));
    expect(cardFingerprint(a.slice(0, 1))).not.toBe(cardFingerprint(a));
  });
});

describe('highlightWarnings', () => {
  const mk = (i: number, hlWords: number): CardInfo => ({
    id: null, pos: i, tag: `T${i}`, cite: 'c', bodyWords: 100,
    highlightedWords: hlWords, readText: '', smallText: '',
  });
  it('flags an outlier on each side', () => {
    const cards = [...Array.from({ length: 10 }, (_, i) => mk(i + 1, 50)), mk(8, 50), mk(90, 95), mk(91, 5)].filter((c, i, a) => a.findIndex((x) => x.pos === c.pos) === i);
    const w = highlightWarnings(cards);
    expect(w.get(90)?.flag).toBe('over');
    expect(w.get(91)?.flag).toBe('under');
    expect(w.size).toBe(2);
  });
  it('needs at least 4 qualifying cards', () => {
    expect(highlightWarnings([mk(1, 10), mk(2, 90), mk(3, 50)]).size).toBe(0);
  });
  it('skips cards under 20 body words and uniform docs', () => {
    const short = { ...mk(1, 1), bodyWords: 10 };
    expect(highlightWarnings([short, mk(2, 50), mk(3, 50), mk(4, 51), mk(5, 49)]).has(1)).toBe(false);
    expect(highlightWarnings([mk(1, 50), mk(2, 51), mk(3, 49), mk(4, 50), mk(5, 50)]).size).toBe(0);
  });
});

describe('cross-ex input and parsing', () => {
  const cards = collectCardInfo(
    doc(card('Tag A', 'Brady 25', [hl('read this part')]), card('No read', 'X 20', [plain('nothing marked')])),
  );
  it('only cards with highlighted text are sent', () => {
    const input = buildCrossExInput(cards, true);
    expect(input.cards).toHaveLength(1);
    expect(input.text).toContain('[Card 0]');
    expect(input.text).toContain('read this part');
    expect(input.overCap).toBe(false);
  });
  it('flags and trims a document over the cap', () => {
    const big: CardInfo[] = [{ ...cards[0]!, readText: 'x'.repeat(HIGHLIGHT_CAP + 5000) }];
    expect(buildCrossExInput(big, true).overCap).toBe(true);
    expect(buildCrossExInput(big, true).text.length).toBeLessThan(HIGHLIGHT_CAP + 500);
  });
  it('shows the short-doc notice', () => {
    expect(shortDocNotice(buildCrossExInput(cards, true))).toMatch(/short/);
  });
  it('parses questions, caps press, validates card index', () => {
    const json = JSON.stringify({
      questions: [
        { side: 'aff', card: 0, question: 'Q1?', answer: 'A1', press: 'p'.repeat(400) },
        { side: 'neg', card: 9, question: 'Q2?', answer: 'A2' },
        { side: 'neg', question: '', answer: 'x' },
      ],
    });
    const qs = attachCards(parseQuestions('```json\n' + json + '\n```', 1), cards);
    expect(qs).toHaveLength(2);
    expect(qs[0]!.press!.length).toBeLessThanOrEqual(300);
    expect(qs[0]!.cardTag).toBe('Tag A');
    expect(qs[1]!.card).toBeNull();
    expect(hasSideSplit(qs)).toBe(true);
  });
  it('forces the seed side on "more like this"', () => {
    const qs = parseQuestions('{"questions":[{"side":"neg","question":"Q","answer":"A"}]}', 0, 'aff');
    expect(qs[0]!.side).toBe('aff');
  });
  it('parses traps (max 3) and grades', () => {
    const t = { setup: 's', wrongAnswer: 'w', gotcha: 'g', ideal: 'i', lesson: 'l' };
    expect(parseTraps(JSON.stringify({ traps: [t, t, t, t] }))).toHaveLength(3);
    expect(parseGrade('{"verdict":"Partially safe","feedback":"ok"}')?.verdict).toBe('partial');
    expect(parseGrade('{"verdict":"nope","feedback":"ok"}')).toBeNull();
  });
});

describe('credibility', () => {
  const cards = collectCardInfo(
    doc(card('Claim one', 'Smith 24, RAND', [plain('b')]), card('Claim two', 'Lee 19', [plain('b')]), card('No cite', '', [])),
  );
  it('scores only cards with a tag and cite text', () => {
    // 'No cite' has no cite paragraph and no body, so its cite is empty.
    expect(scorableCards(cards).map((c) => c.tag)).toEqual(['Claim one', 'Claim two']);
  });
  it('maps verdict bands and averages without counting skipped cards', () => {
    expect([9, 7, 5, 2].map(verdictFor)).toEqual(['Strong', 'Solid', 'Shaky', 'Weak']);
    const s = parseBatch(
      '{"cards":[{"i":0,"overall":8,"author":8,"recency":9,"source":7,"claimFit":8,"reason":"r","press":"p"}]}',
      scorableCards(cards),
    );
    expect(s).toHaveLength(1);
    expect(averageScore(s)).toBe(8);
  });
  it('drops malformed or duplicate entries instead of inventing a 0', () => {
    const batch = scorableCards(cards);
    const good = { i: 0, overall: 6, author: 5, recency: 5, source: 5, claimFit: 5, reason: '', press: '' };
    const s = parseBatch(JSON.stringify([good, good, { i: 1, overall: 5 }, { ...good, i: 7 }]), batch);
    expect(s).toHaveLength(1);
  });
  it('tells the model today’s date and batches by 40', () => {
    expect(credibilitySystemPrompt(new Date('2026-10-17'))).toContain('2026-10-17');
    expect(BATCH_SIZE).toBe(40);
  });
});

describe('parseJsonLoose', () => {
  it('handles fences, prose and garbage', () => {
    expect(parseJsonLoose('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('here: [1,2]')).toEqual([1, 2]);
    expect(parseJsonLoose('nothing')).toBeNull();
  });
});

