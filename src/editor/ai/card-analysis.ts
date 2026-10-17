/**
 * Per-card facts for the AI panels and the highlight-ratio warnings: tag,
 * cite, body word counts and the highlighted / read / small text. Pure
 * ProseMirror walks, no model calls. Per-card results are cached on the
 * (immutable) card node, so an edit only re-reads the cards it touched.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { isBlankHighlightColor } from '../../schema/marks.js';

export interface CardInfo {
  /** The tag's stable heading id (scroll target), or null. */
  id: string | null;
  /** Document position of the tag node. */
  pos: number;
  tag: string;
  /** Cite text: the cite paragraph, else the first ~80 words of the body. */
  cite: string;
  /** Words in the card body (card_body paragraphs). */
  bodyWords: number;
  /** Body words carrying a visible highlight. */
  highlightedWords: number;
  /** Highlighted + underlined/emphasised text: what is read aloud. */
  readText: string;
  /** Everything else in the body: reference only. */
  smallText: string;
}

interface CardFacts extends Omit<CardInfo, 'id' | 'pos'> {}

const factsCache = new WeakMap<PMNode, CardFacts>();

const wordCount = (s: string): number => (s.trim() === '' ? 0 : s.trim().split(/\s+/u).length);

function readCard(card: PMNode): CardFacts {
  let tag = '';
  const citeParts: string[] = [];
  let bodyWords = 0;
  let highlightedWords = 0;
  const readParts: string[] = [];
  const smallParts: string[] = [];
  card.forEach((child) => {
    const t = child.type.name;
    if (t === 'tag') {
      tag = child.textContent.trim();
    } else if (t === 'cite_paragraph') {
      citeParts.push(child.textContent.trim());
    } else if (t === 'card_body') {
      // Group consecutive runs by flag so a word split across marks counts once.
      let hl = '';
      let read = '';
      let small = '';
      const flush = (): void => {
        if (hl.trim()) highlightedWords += wordCount(hl);
        if (read.trim()) readParts.push(read.trim());
        if (small.trim()) smallParts.push(small.trim());
        hl = read = small = '';
      };
      child.forEach((run) => {
        if (!run.isText) return;
        const text = run.text ?? '';
        const marks = run.marks;
        const highlighted = marks.some(
          (m) => m.type.name === 'highlight' && !isBlankHighlightColor(m.attrs['color']),
        );
        const underlined = marks.some(
          (m) => m.type.name === 'underline_mark' || m.type.name === 'emphasis_mark',
        );
        if (highlighted) hl += text;
        else if (hl) {
          // keep the highlighted run contiguous; a break ends it
          highlightedWords += wordCount(hl);
          hl = '';
        }
        if (highlighted || underlined) read += text;
        else {
          if (read.trim()) readParts.push(read.trim());
          read = '';
        }
        if (!highlighted && !underlined) small += text;
        else {
          if (small.trim()) smallParts.push(small.trim());
          small = '';
        }
      });
      flush();
      bodyWords += wordCount(child.textContent);
    }
  });
  let cite = citeParts.join(' ').trim();
  if (!cite) {
    const firstBody = card.content.content.find((c) => c.type.name === 'card_body');
    if (firstBody) cite = firstBody.textContent.trim().split(/\s+/u).slice(0, 80).join(' ');
  }
  return {
    tag,
    cite,
    bodyWords,
    highlightedWords,
    readText: readParts.join(' … '),
    smallText: smallParts.join(' … '),
  };
}

/** Every card in the doc, in order. Analytics (no cite) are not cards. */
export function collectCardInfo(doc: PMNode): CardInfo[] {
  const out: CardInfo[] = [];
  doc.descendants((node, pos) => {
    const t = node.type.name;
    if (t === 'self_ref') return false;
    if (t !== 'card') return true;
    let facts = factsCache.get(node);
    if (!facts) {
      facts = readCard(node);
      factsCache.set(node, facts);
    }
    const tagNode = node.firstChild;
    const id =
      tagNode && typeof tagNode.attrs['id'] === 'string' && tagNode.attrs['id']
        ? (tagNode.attrs['id'] as string)
        : null;
    out.push({ ...facts, id, pos: pos + 1 });
    return false;
  });
  return out;
}

/** Cheap stable fingerprint of the card tags + count (djb2). */
export function cardFingerprint(cards: readonly CardInfo[]): string {
  let h = 5381;
  for (const c of cards) {
    const s = c.tag + '\u0001';
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return `${cards.length}:${(h >>> 0).toString(36)}`;
}

// --- highlight-ratio warnings -----------------------------------------------

export type HighlightFlag = 'over' | 'under';
export interface HighlightWarning {
  flag: HighlightFlag;
  /** highlighted / body words, 0..1. */
  ratio: number;
}

const MIN_BODY_WORDS = 20;
const MIN_CARDS = 4;
const SD_THRESHOLD = 1.5;
const UNIFORM_SD = 0.05;

/** Cards whose highlight ratio sits > 1.5 SD from the doc mean, keyed by
 *  card tag position. Needs >= 4 cards of >= 20 body words and a doc that is
 *  not uniformly highlighted. */
export function highlightWarnings(cards: readonly CardInfo[]): Map<number, HighlightWarning> {
  const out = new Map<number, HighlightWarning>();
  const q = cards.filter((c) => c.bodyWords >= MIN_BODY_WORDS);
  if (q.length < MIN_CARDS) return out;
  const ratios = q.map((c) => c.highlightedWords / c.bodyWords);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const sd = Math.sqrt(ratios.reduce((a, r) => a + (r - mean) ** 2, 0) / ratios.length);
  if (sd < UNIFORM_SD) return out;
  q.forEach((c, i) => {
    const r = ratios[i]!;
    if (r > mean + SD_THRESHOLD * sd) out.set(c.pos, { flag: 'over', ratio: r });
    else if (r < mean - SD_THRESHOLD * sd) out.set(c.pos, { flag: 'under', ratio: r });
  });
  return out;
}

export const HIGHLIGHT_WARNING_TEXT: Record<HighlightFlag, string> = {
  over: 'More text marked than most cards. Check if you’re reading too broadly.',
  under: 'Less text marked than most cards. You may not have prepped this card.',
};
