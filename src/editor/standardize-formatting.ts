/**
 * Standardize Formatting: one command that cleans up a pasted or imported
 * file without a model. Over the selection (or the whole document when
 * nothing is selected), in order:
 *
 *   1. weird text: odd spaces and invisible characters
 *   2. stray fonts: per-run font overrides on body text
 *   3. stray sizes: per-run size overrides on body text
 *   4. highlight color: every visible highlight to the default color
 *      (an erased, white highlight stays erased)
 *   5. shrink: un-read text back to the shrunk size (the normal Shrink
 *      command, so its protection rules apply)
 *
 * Steps 2 and 3 clear sizes and fonts first so step 5 can re-shrink from a
 * clean base; a size someone set on purpose is lost, which is why the
 * command shows a count and asks first. Everything lands as one undo step.
 */

import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../schema/index.js';
import { isBlankHighlightColor } from '../schema/marks.js';
import { collectExoticWhitespaceFixes } from './exotic-whitespace.js';
import { showConfirm } from './confirm-dialog.js';
import { showToast } from './toast.js';

export type StandardizeStepId = 'text' | 'fonts' | 'sizes' | 'highlight' | 'shrink';

export interface StandardizeStep {
  id: StandardizeStepId;
  label: string;
  /** How many edits the step makes. */
  count: number;
}

export interface StandardizePlan {
  steps: StandardizeStep[];
  total: number;
  /** One transaction holding every step, ready to dispatch. */
  tr: Transaction;
}

export interface StandardizeDeps {
  /** The default highlight color (a Word color name), or null for none. */
  highlightColor: () => string | null;
  /** The ordinary Shrink command. */
  shrink: Command;
}

const LABELS: Record<StandardizeStepId, string> = {
  text: 'Odd spaces and invisible characters',
  fonts: 'Stray fonts',
  sizes: 'Stray text sizes',
  highlight: 'Highlight color',
  shrink: 'Un-read text shrunk',
};

/** Body text only: card body paragraphs and loose paragraphs. Tags, cites,
 *  headings and analytics keep their own fonts and sizes. */
function isBodyBlock(node: PMNode, parent: PMNode | null): boolean {
  const t = node.type.name;
  return t === 'card_body' || (t === 'paragraph' && parent?.type.name === 'doc');
}

/** Each body textblock intersecting [from, to) as a clamped range. */
function bodyRanges(doc: PMNode, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  doc.nodesBetween(from, to, (node, pos, parent) => {
    const t = node.type.name;
    if (t === 'self_ref' || t === 'transclusion_ref') return false;
    if (node.isTextblock) {
      if (isBodyBlock(node, parent)) {
        const a = Math.max(from, pos + 1);
        const b = Math.min(to, pos + node.nodeSize - 1);
        if (a < b) out.push({ from: a, to: b });
      }
      return false;
    }
    return true;
  });
  return out;
}

/** The scope: the selection, or the whole document when nothing is selected. */
function scopeOf(state: EditorState): { from: number; to: number } {
  const { from, to, empty } = state.selection;
  if (!empty) return { from, to };
  return { from: 0, to: state.doc.content.size };
}

function stateWithScope(doc: PMNode, from: number, to: number): EditorState {
  const a = Math.max(1, from);
  const b = Math.max(a, Math.min(doc.content.size - 1, to));
  return EditorState.create({
    doc,
    selection: TextSelection.between(doc.resolve(a), doc.resolve(b)),
  });
}

/** Work out what Standardize Formatting would do, without touching the
 *  document. Null when there is nothing to change. */
export function planStandardizeFormatting(
  state: EditorState,
  deps: StandardizeDeps,
): StandardizePlan | null {
  const master = state.tr;
  const steps: StandardizeStep[] = [];
  const scope = scopeOf(state);
  let from = scope.from;
  let to = scope.to;

  /** Run `edit` on the master transaction and track the scope through it. */
  const apply = (id: StandardizeStepId, edit: (tr: Transaction) => void): void => {
    const before = master.steps.length;
    edit(master);
    const count = master.steps.length - before;
    if (count > 0) {
      steps.push({ id, label: LABELS[id], count });
      from = master.mapping.slice(before).map(from, -1);
      to = master.mapping.slice(before).map(to, 1);
    }
  };

  // 1. weird text
  apply('text', (tr) => {
    const fixes = collectExoticWhitespaceFixes(tr.doc, from, to);
    for (let i = fixes.length - 1; i >= 0; i--) {
      const f = fixes[i]!;
      if (f.replace === '') tr.delete(f.from, f.to);
      else tr.replaceWith(f.from, f.to, schema.text(f.replace, tr.doc.nodeAt(f.from)?.marks ?? []));
    }
  });

  // 2. stray fonts
  const fontType = schema.marks['font_family'];
  if (fontType) {
    apply('fonts', (tr) => {
      for (const r of bodyRanges(tr.doc, from, to)) {
        let has = false;
        tr.doc.nodesBetween(r.from, r.to, (n) => {
          if (n.isText && fontType.isInSet(n.marks)) has = true;
          return !has;
        });
        if (has) tr.removeMark(r.from, r.to, fontType);
      }
    });
  }

  // 3. stray sizes
  const sizeType = schema.marks['font_size'];
  if (sizeType) {
    apply('sizes', (tr) => {
      for (const r of bodyRanges(tr.doc, from, to)) {
        let has = false;
        tr.doc.nodesBetween(r.from, r.to, (n) => {
          if (n.isText && sizeType.isInSet(n.marks)) has = true;
          return !has;
        });
        if (has) tr.removeMark(r.from, r.to, sizeType);
      }
    });
  }

  // 4. highlight color
  const hlType = schema.marks['highlight'];
  const color = deps.highlightColor();
  if (hlType && color) {
    apply('highlight', (tr) => {
      const ranges: { from: number; to: number }[] = [];
      tr.doc.nodesBetween(from, to, (n, pos) => {
        if (!n.isText) return true;
        const mark = hlType.isInSet(n.marks);
        if (!mark) return true;
        const current = String(mark.attrs['color'] ?? '');
        if (isBlankHighlightColor(current) || current === color) return true;
        ranges.push({ from: Math.max(from, pos), to: Math.min(to, pos + n.nodeSize) });
        return true;
      });
      for (const r of ranges) {
        if (r.from >= r.to) continue;
        tr.removeMark(r.from, r.to, hlType);
        tr.addMark(r.from, r.to, hlType.create({ color }));
      }
    });
  }

  // 5. shrink what is not read
  {
    const before = master.steps.length;
    const cur = stateWithScope(master.doc, from, to);
    deps.shrink(cur, (shrinkTr) => {
      for (const step of shrinkTr.steps) master.step(step);
    });
    const count = master.steps.length - before;
    if (count > 0) steps.push({ id: 'shrink', label: LABELS.shrink, count });
  }

  const total = steps.reduce((n, s) => n + s.count, 0);
  if (total === 0) return null;
  try {
    master.setSelection(state.selection.map(master.doc, master.mapping));
  } catch {
    /* keep the mapped default */
  }
  return { steps, total, tr: master };
}

/** Standardize Formatting from the UI: show what will change, ask, apply as
 *  one undo step. */
export async function runStandardizeFormatting(
  view: EditorView,
  deps: StandardizeDeps,
): Promise<void> {
  const plan = planStandardizeFormatting(view.state, deps);
  if (!plan) {
    showToast('Nothing to standardize.');
    return;
  }
  const scope = view.state.selection.empty ? 'the whole document' : 'the selection';
  const ok = await showConfirm({
    title: 'Standardize formatting',
    message:
      `This will change ${scope}:\n` +
      plan.steps.map((s) => `• ${s.label}: ${s.count}`).join('\n') +
      '\n\nFonts and sizes are reset to the body style and un-read text is shrunk again. ' +
      'You can undo it in one step.',
    confirmLabel: 'Standardize',
  });
  if (!ok) return;
  // The document may have changed while the dialog was open: plan again.
  const fresh = planStandardizeFormatting(view.state, deps);
  if (!fresh) {
    showToast('Nothing to standardize.');
    return;
  }
  view.dispatch(fresh.tr.scrollIntoView());
  showToast(`Standardized formatting (${fresh.total} edits).`);
}
