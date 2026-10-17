/**
 * Per-card facts for the AI panels: tag, cite, body word counts and the
 * highlighted text. Pure ProseMirror walks, no model calls. Per-card results
 * are cached on the (immutable) card node, so an edit only re-reads the cards
 * it touched.
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
  /** Highlighted body text: what is read aloud. Separate highlighted runs
   *  are joined with " … ". */
  highlightText: string;
}

interface CardFacts extends Omit<CardInfo, 'id' | 'pos'> {}

const factsCache = new WeakMap<PMNode, CardFacts>();

const wordCount = (s: string): number => (s.trim() === '' ? 0 : s.trim().split(/\s+/u).length);

function readCard(card: PMNode): CardFacts {
  let tag = '';
  const citeParts: string[] = [];
  let bodyWords = 0;
  let highlightedWords = 0;
  const hlParts: string[] = [];
  card.forEach((child) => {
    const t = child.type.name;
    if (t === 'tag') {
      tag = child.textContent.trim();
    } else if (t === 'cite_paragraph') {
      citeParts.push(child.textContent.trim());
    } else if (t === 'card_body') {
      // Consecutive highlighted runs join into one stretch, so a word split
      // across marks counts once; an unhighlighted gap ends the stretch.
      let hl = '';
      const flush = (): void => {
        if (hl.trim()) {
          highlightedWords += wordCount(hl);
          hlParts.push(hl.trim());
        }
        hl = '';
      };
      child.forEach((run) => {
        if (!run.isText) return;
        const highlighted = run.marks.some(
          (m) => m.type.name === 'highlight' && !isBlankHighlightColor(m.attrs['color']),
        );
        if (highlighted) hl += run.text ?? '';
        else flush();
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
  return { tag, cite, bodyWords, highlightedWords, highlightText: hlParts.join(' … ') };
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

// --- outline headings -------------------------------------------------------

const OUTLINE_TYPES = new Set(['pocket', 'hat', 'block']);

export interface OutlineHeading {
  pos: number;
  type: 'pocket' | 'hat' | 'block';
  text: string;
}

/** The pocket / hat / block headings, in order (cards and analytics excluded),
 *  so a prompt can show which argument each card sits under. */
export function collectOutlineHeadings(doc: PMNode): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  doc.descendants((node, pos) => {
    const t = node.type.name;
    if (t === 'self_ref' || t === 'card' || t === 'analytic_unit') return false;
    if (OUTLINE_TYPES.has(t)) {
      const text = node.textContent.trim();
      if (text) out.push({ pos, type: t as OutlineHeading['type'], text });
      return false;
    }
    return true;
  });
  return out;
}
