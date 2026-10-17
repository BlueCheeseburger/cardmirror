/**
 * Card Credibility's deeper analysis: a conversation about ONE card's score.
 *
 * It continues the exact scoring exchange: the batch of tags and cites the
 * model scored and its JSON reply, then a question asking why it scored this
 * card that way. The system prompt adds a policy debate reference (the
 * `policy-debate-basics` skill) so the follow-up reasons like a debater, and
 * lifts the scoring prompt's JSON / plain-text rules: this conversation is
 * shown to the user and rendered as Markdown. The user can keep asking.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { isBlankHighlightColor } from '../../schema/marks.js';
import { callTier } from './tiers.js';
import { LlmError, type LlmMessage } from './llm.js';
import {
  buildBatchPrompt,
  credibilitySystemPrompt,
  type CredScore,
  type ScoreBatch,
} from './credibility.js';
import type { CardInfo } from './card-analysis.js';
import type { ChatTurn } from './ai-panel-store.js';
import skillSource from './skills/policy-debate-basics.md?raw';

/** The skill's body, without its YAML front matter. */
export const POLICY_DEBATE_SKILL = skillSource.replace(/^---\n[\s\S]*?\n---\n/, '').trim();

/** Card text sent with the first question is capped at this many characters. */
export const CARD_TEXT_CAP = 12_000;

export function deepDiveSystemPrompt(today: Date): string {
  return (
    credibilitySystemPrompt(today) +
    '\n\n## Follow-up conversation\n' +
    'The scoring above is finished. You are now talking directly with the debater who owns ' +
    'these cards, about how you scored one of them. For the rest of this conversation, ignore the ' +
    'JSON-only and plain-text rules above: reply in Markdown. Organise the answer with short ' +
    '`###` headings and bullet lists, use **bold** for the key judgments and *emphasis* where it ' +
    'helps, and keep paragraphs short. Explain each sub-score (author, recency, source, tag fit) ' +
    'and what would raise or lower it, say how an opponent would attack the card in cross-ex or in ' +
    'a speech, and how the debater should defend or replace it. If the full card text changes your ' +
    'view, say so plainly and give the score you would give now. Never invent credentials, dates ' +
    'or sources.\n\n' +
    'Use this policy debate reference to reason the way a debater, coach or judge would:\n\n' +
    POLICY_DEBATE_SKILL
  );
}

/** The card as plain text, highlighted (read-aloud) runs in [[double brackets]]. */
export function cardText(card: PMNode): string {
  const lines: string[] = [];
  card.forEach((child) => {
    const t = child.type.name;
    if (t === 'tag') lines.push(`TAG: ${child.textContent.trim()}`);
    else if (t === 'cite_paragraph') lines.push(`CITE: ${child.textContent.trim()}`);
    else if (t === 'undertag') lines.push(`UNDERTAG: ${child.textContent.trim()}`);
    else if (t === 'card_body') {
      let out = '';
      let open = false;
      child.forEach((run) => {
        if (!run.isText) return;
        const hl = run.marks.some(
          (m) => m.type.name === 'highlight' && !isBlankHighlightColor(m.attrs['color']),
        );
        if (hl && !open) out += '[[';
        if (!hl && open) out += ']]';
        open = hl;
        out += run.text ?? '';
      });
      if (open) out += ']]';
      if (out.trim()) lines.push(out.trim());
    }
  });
  const text = lines.join('\n');
  return text.length > CARD_TEXT_CAP ? `${text.slice(0, CARD_TEXT_CAP)}\n[card text cut off]` : text;
}

/** The first question, asked on the user's behalf. */
export function openingQuestion(index: number, tag: string, card: PMNode | null): string {
  return (
    `Why did you score card [${index}] ("${tag}") that way? Provide a deeper analysis, and be ` +
    `organized in your response to the user.` +
    (card
      ? `\n\nFor this analysis you can now see the whole card. Text in [[double brackets]] is ` +
        `highlighted, which is what the debater reads aloud; the rest is unread context.\n\n` +
        cardText(card)
      : '')
  );
}

/** The scoring exchange this card came from, or a one-card stand-in for a
 *  score saved before exchanges were recorded. */
export function scoringExchange(
  score: CredScore,
  batches: readonly ScoreBatch[] | undefined,
  info: CardInfo | undefined,
): { exchange: ScoreBatch; index: number } {
  const b = score.batch !== undefined ? batches?.[score.batch] : undefined;
  if (b && score.index !== undefined) return { exchange: b, index: score.index };
  const cite = info?.cite ?? '';
  return {
    exchange: {
      prompt: buildBatchPrompt([{ tag: score.tag, cite } as CardInfo]),
      reply: JSON.stringify({
        cards: [
          {
            i: 0,
            overall: score.overall,
            author: score.author,
            recency: score.recency,
            source: score.source,
            tagFit: score.tagFit,
            reason: score.reason,
            press: score.press,
          },
        ],
      }),
    },
    index: 0,
  };
}

/** Messages for the model: the scoring exchange, then the conversation. */
export function deepDiveMessages(exchange: ScoreBatch, turns: readonly ChatTurn[]): LlmMessage[] {
  return [
    { role: 'user', content: exchange.prompt },
    { role: 'assistant', content: exchange.reply },
    ...turns.map((t) => ({ role: t.role, content: t.content })),
  ];
}

/** Ask for the next assistant turn. `turns` must end with a user turn. */
export async function continueDeepDive(
  exchange: ScoreBatch,
  turns: readonly ChatTurn[],
  onText?: (soFar: string) => void,
): Promise<string> {
  const reply = await callTier('balanced', {
    maxTokens: 8192,
    system: deepDiveSystemPrompt(new Date()),
    messages: deepDiveMessages(exchange, turns),
    ...(onText ? { onText } : {}),
  });
  const text = reply.text.trim();
  if (!text) throw new LlmError('The AI returned an empty reply. Try again.', null, 'parse');
  return reply.stopReason === 'max_tokens'
    ? `${text}\n\n*(The reply hit the output limit and was cut off.)*`
    : text;
}
