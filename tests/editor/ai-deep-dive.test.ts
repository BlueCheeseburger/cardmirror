// @vitest-environment jsdom
/**
 * Card Credibility's deeper analysis (card-deep-dive.ts), the Markdown
 * renderer its replies use (markdown-dom.ts), and the truncation retry the
 * AI panels share (tiers.ts `callTierParsed`). The model is mocked: nothing
 * here makes a network call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const callLlm = vi.fn();
vi.mock('../../src/editor/ai/llm.js', async (orig) => ({
  ...(await orig<typeof import('../../src/editor/ai/llm.js')>()),
  callLlm: (...a: unknown[]) => callLlm(...a),
  activeApiKey: () => 'test-key',
}));

import { schema, newHeadingId } from '../../src/schema/index.js';
import { callTierParsed } from '../../src/editor/ai/tiers.js';
import {
  POLICY_DEBATE_SKILL,
  cardText,
  continueDeepDive,
  deepDiveMessages,
  deepDiveSystemPrompt,
  openingQuestion,
  scoringExchange,
} from '../../src/editor/ai/card-deep-dive.js';
import { emphasisEl, renderMarkdown } from '../../src/editor/ai/markdown-dom.js';
import { credibilitySystemPrompt } from '../../src/editor/ai/credibility.js';
import { CROSSEX_SYSTEM_PROMPT } from '../../src/editor/ai/crossex.js';
import type { CredScore } from '../../src/editor/ai/credibility.js';

const n = schema.nodes;
const hl = (t: string) => schema.text(t, [schema.marks['highlight']!.create({ color: 'cyan' })]);
const cardNode = n['card']!.createChecked(null, [
  n['tag']!.create({ id: newHeadingId() }, schema.text('Inequality is decreasing')),
  n['cite_paragraph']!.create(null, schema.text('Manning 25, staff writer')),
  n['card_body']!.create(null, [schema.text('Census data '), hl('misses transfers'), schema.text(' entirely.')]),
]);

const score: CredScore = {
  tag: 'Inequality is decreasing',
  overall: 5,
  verdict: 'Shaky',
  author: 3,
  recency: 9,
  source: 4,
  tagFit: 5,
  reason: 'Staff writer, not an economist.',
  press: 'Is a staff writer qualified on census methodology?',
  batch: 0,
  index: 3,
};

beforeEach(() => callLlm.mockReset());

describe('deeper analysis prompt', () => {
  it('feeds the policy debate skill, without its front matter, and lifts the JSON rule', () => {
    const sys = deepDiveSystemPrompt(new Date('2026-10-17'));
    expect(POLICY_DEBATE_SKILL.startsWith('---')).toBe(false);
    expect(POLICY_DEBATE_SKILL).toContain('## Evidence (Cards)');
    expect(sys).toContain(POLICY_DEBATE_SKILL);
    expect(sys).toMatch(/ignore the\s+JSON-only and plain-text rules/);
    expect(sys).toContain('Markdown');
  });

  it('continues the exact scoring exchange, then asks why', () => {
    const exchange = { prompt: 'BATCH PROMPT', reply: '{"cards":[]}' };
    const { exchange: ex, index } = scoringExchange(score, [exchange], undefined);
    expect(ex).toBe(exchange);
    expect(index).toBe(3);
    const q = openingQuestion(index, score.tag, cardNode);
    expect(q).toMatch(/^Why did you score card \[3\] \("Inequality is decreasing"\) that way\? Provide a deeper analysis, and be organized in your response to the user\./);
    expect(q).toContain('Census data [[misses transfers]] entirely.');
    const msgs = deepDiveMessages(ex, [{ role: 'user', content: q, display: 'shown' }]);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[0]!.content).toBe('BATCH PROMPT');
    expect(msgs[1]!.content).toBe('{"cards":[]}');
    expect(msgs[2]).toEqual({ role: 'user', content: q });
  });

  it('stands in a one-card exchange for scores saved before exchanges were kept', () => {
    const { exchange, index } = scoringExchange({ ...score, batch: undefined, index: undefined }, undefined, undefined);
    expect(index).toBe(0);
    expect(exchange.prompt).toContain('TAG: Inequality is decreasing');
    expect(JSON.parse(exchange.reply).cards[0]).toMatchObject({ i: 0, overall: 5, tagFit: 5 });
  });

  it('marks highlighted runs in the card text', () => {
    expect(cardText(cardNode)).toBe(
      'TAG: Inequality is decreasing\nCITE: Manning 25, staff writer\nCensus data [[misses transfers]] entirely.',
    );
  });

  it('sends the conversation and notes a reply cut off by the limit', async () => {
    callLlm.mockResolvedValueOnce({ text: '### Author\n**Weak**', stopReason: 'max_tokens' });
    const out = await continueDeepDive({ prompt: 'P', reply: 'R' }, [{ role: 'user', content: 'why?' }]);
    expect(out).toContain('### Author');
    expect(out).toMatch(/cut off/);
    const req = callLlm.mock.calls[0]![0] as { system: string; messages: unknown[] };
    expect(req.messages).toHaveLength(3);
    expect(req.system).toContain('## Evidence (Cards)');
  });
});

describe('callTierParsed', () => {
  it('retries once with a bigger budget when the reply was cut off', async () => {
    callLlm
      .mockResolvedValueOnce({ text: '{"traps":[', stopReason: 'max_tokens' })
      .mockResolvedValueOnce({ text: '{"traps":[1]}', stopReason: 'STOP' });
    const v = await callTierParsed('balanced', { maxTokens: 1000, messages: [] }, (t) =>
      t.includes('1') ? 'ok' : null,
    );
    expect(v).toBe('ok');
    expect(callLlm.mock.calls.map((c) => (c[0] as { maxTokens: number }).maxTokens)).toEqual([1000, 2000]);
  });

  it('says the reply was cut off when it still is', async () => {
    callLlm.mockResolvedValue({ text: '{', stopReason: 'max_tokens' });
    await expect(callTierParsed('balanced', { messages: [] }, () => null)).rejects.toThrow(/cut off/);
    expect(callLlm).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unreadable reply that was not cut off', async () => {
    callLlm.mockResolvedValue({ text: 'nope', stopReason: 'STOP' });
    await expect(callTierParsed('balanced', { messages: [] }, () => null)).rejects.toThrow(/Couldn't read/);
    expect(callLlm).toHaveBeenCalledTimes(1);
  });
});

describe('renderMarkdown', () => {
  it('renders headings, emphasis, lists, quotes and code without injecting HTML', () => {
    const root = renderMarkdown(
      [
        '## Author',
        'A **staff writer** is *not* an economist; see `CBO`.',
        '',
        '- first',
        '- second',
        '  - nested',
        '',
        '1. one',
        '2. two',
        '',
        '> quoted',
        '',
        '---',
        '<img src=x onerror=alert(1)> stays text, and snake_case_words too',
      ].join('\n'),
    );
    expect(root.querySelector('h4')?.textContent).toBe('Author');
    expect(root.querySelector('strong')?.textContent).toBe('staff writer');
    expect(root.querySelector('em')?.textContent).toBe('not');
    expect(root.querySelector('code')?.textContent).toBe('CBO');
    expect(root.querySelectorAll(':scope > ul > li')).toHaveLength(2);
    expect(root.querySelector('ul li ul li')?.textContent).toBe('nested');
    expect(root.querySelectorAll('ol > li')).toHaveLength(2);
    expect(root.querySelector('blockquote')?.textContent).toBe('quoted');
    expect(root.querySelector('hr')).not.toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('snake_case_words');
  });
});

describe('emphasis in the panels', () => {
  it('renders only bold and italic; everything else stays literal', () => {
    const e = emphasisEl('p', undefined, '**Weak** author, *old* data, `code`, # not a heading, - not a list');
    expect(e.querySelector('strong')?.textContent).toBe('Weak');
    expect(e.querySelector('em')?.textContent).toBe('old');
    expect(e.querySelector('code')).toBeNull();
    expect(e.textContent).toBe('Weak author, old data, `code`, # not a heading, - not a list');
  });
  it('the cross-ex and credibility prompts allow bold and italic only', () => {
    for (const p of [CROSSEX_SYSTEM_PROMPT, credibilitySystemPrompt(new Date('2026-10-17'))]) {
      expect(p).toContain('**bold** and *italic*');
      expect(p).not.toMatch(/Plain text only|no bold, no italics/);
    }
  });
});
