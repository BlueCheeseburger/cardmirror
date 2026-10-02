// @vitest-environment jsdom
/**
 * Reloading a file builds a new view and outline at the default depth; the
 * outline's expanded / folded headings (and depth filter) are carried over.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { NavigationPanel } from '../../src/editor/nav-panel.js';
import { collectHeadings } from '../../src/editor/headings.js';

const h = (type: 'pocket' | 'hat' | 'block', text: string, id = newHeadingId()): PMNode =>
  schema.nodes[type]!.create({ id }, schema.text(text));

/** Pocket P → Hat H → Block B1 + Block B2, then a second Pocket Q → Hat G. */
function build(ids: Record<string, string> = {}): PMNode {
  const id = (k: string): string => ids[k] ?? newHeadingId();
  return schema.nodes['doc']!.createChecked(null, [
    h('pocket', 'P', id('P')),
    h('hat', 'H', id('H')),
    h('block', 'B1', id('B1')),
    h('block', 'B2', id('B2')),
    h('pocket', 'Q', id('Q')),
    h('hat', 'G', id('G')),
  ]);
}

function panel(doc: PMNode): NavigationPanel {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView(container, { state: EditorState.create({ doc }) });
  const nav = new NavigationPanel(document.createElement('div'));
  nav.attach(view);
  nav.update(view.state.doc);
  return nav;
}

const foldedTexts = (nav: NavigationPanel): string[] => {
  const folded = (nav as unknown as { collapsed: Set<string> }).collapsed;
  const doc = (nav as unknown as { currentDoc: PMNode }).currentDoc;
  return collectHeadings(doc)
    .filter((e) => e.id != null && folded.has(e.id))
    .map((e) => e.text)
    .sort();
};
const setFolded = (nav: NavigationPanel, ids: string[]): void => {
  (nav as unknown as { collapsed: Set<string> }).collapsed = new Set(ids);
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('outline view state across a reload', () => {
  const ids = { P: 'p', H: 'h', B1: 'b1', B2: 'b2', Q: 'q', G: 'g' };

  it('keeps which headings were open when the file comes back with the same ids', () => {
    const before = panel(build(ids));
    setFolded(before, ['q']); // P and its whole subtree open, Q folded
    const state = before.captureViewState();
    const after = panel(build(ids)); // a fresh outline at the default depth
    after.restoreViewState(state);
    expect(foldedTexts(after)).toEqual(['Q']);
  });

  it('opens a pocket that the default depth folded', () => {
    const before = panel(build(ids));
    setFolded(before, []); // everything open
    const state = before.captureViewState();
    const after = panel(build(ids));
    // The default depth folds at least something in a doc this deep.
    after.restoreViewState(state);
    expect(foldedTexts(after)).toEqual([]);
  });

  it('matches by level + text when the reloaded file has fresh ids', () => {
    const before = panel(build(ids));
    setFolded(before, ['q']);
    const state = before.captureViewState();
    const after = panel(build()); // same outline, brand-new ids
    after.restoreViewState(state);
    expect(foldedTexts(after)).toEqual(['Q']);
  });

  it('a heading the old outline never had follows the default depth', () => {
    const before = panel(
      schema.nodes['doc']!.createChecked(null, [h('pocket', 'P', 'p'), h('hat', 'H', 'h')]),
    );
    setFolded(before, []);
    const state = before.captureViewState();
    const after = panel(build(ids));
    const defaulted = foldedTexts(after);
    after.restoreViewState(state);
    // P and H were open before; the headings it didn't know keep the default.
    expect(foldedTexts(after).filter((t) => t === 'P' || t === 'H')).toEqual([]);
    expect(foldedTexts(after).includes('Q')).toBe(defaulted.includes('Q'));
  });

  it('keeps the depth filter', () => {
    const before = panel(build(ids));
    (before as unknown as { localMaxLevel: number }).localMaxLevel = 2;
    const state = before.captureViewState();
    expect(state.maxLevel).toBe(2);
    const after = panel(build(ids));
    after.restoreViewState(state);
    expect((after as unknown as { localMaxLevel: number }).localMaxLevel).toBe(2);
  });
});
