/**
 * Document merge — the pure core behind "Merge into new file" in the
 * Compare documents dialog.
 *
 * Two documents, no common ancestor: the merge can't tell a deletion from
 * an insertion, so it takes the UNION. Lines both documents share appear
 * once; lines only one has are kept; a line EDITED differently in the two
 * (a removed line and an added one similar enough to be the same line,
 * the pairing the side-by-side diff uses) is a direct conflict, and the
 * caller picks a side for each (or both).
 *
 * The merged document is rebuilt from the original nodes, so formatting
 * survives (the diff itself is text-only). Cards and analytic units are
 * rebuilt from their children: a line that sits inside a card in its own
 * document joins the card it lands next to, and starts nothing new unless
 * it's the card's tag.
 *
 * DOM-free, like `doc-diff.ts`.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { diffLines, toDiffRows } from './doc-diff.js';

const CONTAINERS = new Set(['card', 'analytic_unit']);

/** One mergeable line: a textblock (or an opaque block like a table). */
export interface MergeUnit {
  text: string;
  node: PMNode;
  /** The card / analytic unit this node is a child of, if any. */
  parent: PMNode | null;
  /** The first child of its parent (the tag / analytic) — starts a unit. */
  first: boolean;
}

export type MergeChoice = 'a' | 'b' | 'both';

export type MergeItem =
  | { kind: 'unit'; unit: MergeUnit; from: 'both' | 'a' | 'b' }
  | { kind: 'conflict'; a: MergeUnit; b: MergeUnit; choice: MergeChoice };

export interface MergePlan {
  items: MergeItem[];
  onlyA: number;
  onlyB: number;
  conflicts: number;
}

/** The mergeable lines of a document, in order. Empty paragraphs are
 *  dropped (except a card's leading tag, which holds the card together). */
export function extractMergeUnits(doc: PMNode): MergeUnit[] {
  const units: MergeUnit[] = [];
  const push = (node: PMNode, parent: PMNode | null, first: boolean): void => {
    const text = node.textContent.trim();
    if (!text && !first && node.isTextblock) return;
    units.push({ text: text || (node.isTextblock ? '' : `[${node.type.name}]`), node, parent, first });
  };
  doc.forEach((child) => {
    if (CONTAINERS.has(child.type.name)) {
      child.forEach((kid, _off, idx) => push(kid, child, idx === 0));
    } else {
      push(child, null, false);
    }
  });
  return units;
}

/** Work out the merge of two documents. Conflicts default to the first
 *  document's version. */
export function planMerge(docA: PMNode, docB: PMNode): MergePlan {
  const ua = extractMergeUnits(docA);
  const ub = extractMergeUnits(docB);
  const lines = diffLines(
    ua.map((u) => u.text),
    ub.map((u) => u.text),
  );

  const items: MergeItem[] = [];
  let onlyA = 0;
  let onlyB = 0;
  let conflicts = 0;
  let i = 0;
  let j = 0;
  let k = 0;
  while (k < lines.length) {
    if (lines[k]!.type === 'equal') {
      items.push({ kind: 'unit', unit: ua[i]!, from: 'both' });
      i++;
      j++;
      k++;
      continue;
    }
    // A changed region: its removes are only in A, its adds only in B.
    let end = k;
    while (end < lines.length && lines[end]!.type !== 'equal') end++;
    const region = lines.slice(k, end);
    for (const row of toDiffRows(region)) {
      const left = row.left.type !== 'blank';
      const right = row.right.type !== 'blank';
      if (left && right) {
        items.push({ kind: 'conflict', a: ua[i++]!, b: ub[j++]!, choice: 'a' });
        conflicts++;
      } else if (left) {
        items.push({ kind: 'unit', unit: ua[i++]!, from: 'a' });
        onlyA++;
      } else if (right) {
        items.push({ kind: 'unit', unit: ub[j++]!, from: 'b' });
        onlyB++;
      }
    }
    k = end;
  }
  return { items, onlyA, onlyB, conflicts };
}

/** Build the merged document from a plan (with its conflicts resolved).
 *  `base` supplies the document node type and attributes. Throws if the
 *  result isn't a valid document. */
export function buildMerged(plan: MergePlan, base: PMNode): PMNode {
  const units: MergeUnit[] = [];
  for (const item of plan.items) {
    if (item.kind === 'unit') units.push(item.unit);
    else if (item.choice === 'a') units.push(item.a);
    else if (item.choice === 'b') units.push(item.b);
    else units.push(item.a, item.b);
  }

  const out: PMNode[] = [];
  let open: { parent: PMNode; kids: PMNode[] } | null = null;
  const flush = (): void => {
    if (!open) return;
    out.push(open.parent.type.create(open.parent.attrs, open.kids));
    open = null;
  };
  for (const u of units) {
    if (!u.parent) {
      flush();
      out.push(u.node);
    } else if (u.first) {
      flush();
      open = { parent: u.parent, kids: [u.node] };
    } else if (open && (open as { parent: PMNode }).parent.type === u.parent.type) {
      (open as { kids: PMNode[] }).kids.push(u.node);
    } else {
      // A card child whose card didn't make it in: keep it as a plain
      // block rather than drop the text.
      flush();
      out.push(u.node);
    }
  }
  flush();

  const doc = base.type.create(base.attrs, out);
  doc.check();
  return doc;
}

/** Plan + build with every conflict resolved the same way — for tests
 *  and the no-conflict case. */
export function mergeDocs(docA: PMNode, docB: PMNode, choice: MergeChoice = 'a'): PMNode {
  const plan = planMerge(docA, docB);
  for (const item of plan.items) if (item.kind === 'conflict') item.choice = choice;
  return buildMerged(plan, docA);
}
