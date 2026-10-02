/**
 * Keep emoji upright inside italic text.
 *
 * Emoji fonts (Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji) have no
 * italic face, so a browser asked for italic text FAKES one by skewing the
 * glyphs — in an italic undertag (or any italic run) a 😭 comes out leaning
 * sideways. Wrapping each emoji in a `.pmd-emoji` span with
 * `font-style: normal` asks for the upright face instead, which exists, so
 * nothing is synthesized. A decoration, not a mark: nothing is stored in the
 * document, and it can't be left behind in a saved file.
 *
 * The scan covers the whole document once, then only the textblocks a
 * transaction touched (decorations map through everything else).
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** An emoji: emoji-presentation characters, or a text-default pictograph
 *  made emoji by VS16, plus ZWJ sequences and skin-tone modifiers. Text
 *  symbols such as © ® ™ stay as they are (they have real italics). */
const EMOJI =
  /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)(?:️|\p{Emoji_Modifier}|‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})️?)*/gu;

export const emojiUprightKey = new PluginKey<DecorationSet>('pmd-emoji-upright');

function decorateBlock(block: PMNode, blockPos: number, out: Decoration[]): void {
  block.forEach((child, offset) => {
    if (!child.isText) return;
    const text = child.text!;
    EMOJI.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EMOJI.exec(text)) !== null) {
      const from = blockPos + 1 + offset + m.index;
      out.push(Decoration.inline(from, from + m[0].length, { class: 'pmd-emoji' }));
    }
  });
}

function scan(doc: PMNode, from: number, to: number): Decoration[] {
  const out: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      decorateBlock(node, pos, out);
      return false;
    }
    return true;
  });
  return out;
}

export function emojiUprightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: emojiUprightKey,
    state: {
      init: (_config, state) => DecorationSet.create(state.doc, scan(state.doc, 0, state.doc.content.size)),
      apply(tr, set, _old, newState) {
        if (!tr.docChanged) return set;
        const doc = newState.doc;
        let next = set.map(tr.mapping, doc);
        // The ranges this transaction touched, in the new document.
        const dirty: Array<[number, number]> = [];
        tr.mapping.maps.forEach((map, i) => {
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            const rest = tr.mapping.slice(i + 1);
            const a = Math.max(0, rest.map(newStart, -1) - 1);
            const b = Math.min(doc.content.size, rest.map(newEnd, 1) + 1);
            dirty.push([a, b]);
          });
        });
        dirty.sort((x, y) => x[0] - y[0]);
        const merged: Array<[number, number]> = [];
        for (const r of dirty) {
          const last = merged[merged.length - 1];
          if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
          else merged.push([r[0], r[1]]);
        }
        for (const [a, b] of merged) {
          // Widen to whole textblocks so a decoration straddling the edit
          // is rebuilt, not just clipped.
          let from = a;
          let to = b;
          doc.nodesBetween(a, b, (node, pos) => {
            if (node.isTextblock) {
              from = Math.min(from, pos);
              to = Math.max(to, pos + node.nodeSize);
              return false;
            }
            return true;
          });
          next = next.remove(next.find(from, to));
          next = next.add(doc, scan(doc, from, to));
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        return emojiUprightKey.getState(state);
      },
    },
  });
}
