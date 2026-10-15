// @vitest-environment jsdom
/**
 * The outline pane's right-click menu: no "Select heading and contents",
 * a Shrink row for everything under the heading, and one Unhighlight /
 * Rehighlight row that flips after the unhighlight (card-highlight-toggle.ts).
 */
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { NavigationPanel, setNavCommandRunner } from '../../src/editor/nav-panel.js';
import { cardHighlightPlugin } from '../../src/editor/card-highlight-toggle.js';
import { shrinkText, compileShrinkProtections } from '../../src/editor/ribbon-commands.js';

const NORMAL_PT = 11;
const mark = (name: string, attrs?: Record<string, unknown>) => schema.marks[name]!.create(attrs);

function card(tag: string, ...inlines: PMNode[]): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, inlines),
  ]);
}
function block(text: string): PMNode {
  return schema.nodes['block']!.create({ id: newHeadingId() }, schema.text(text));
}
const highlighted = (t: string): PMNode => schema.text(t, [mark('highlight', { color: 'yellow' })]);

function setup(...children: PMNode[]): { view: EditorView; nav: NavigationPanel } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView(container, {
    state: EditorState.create({
      doc: schema.nodes['doc']!.createChecked(null, children),
      plugins: [history(), cardHighlightPlugin()],
    }),
  });
  const nav = new NavigationPanel(document.createElement('div'));
  nav.attach(view);
  nav.update(view.state.doc);
  return { view, nav };
}

function entryFor(nav: NavigationPanel, label: string): unknown {
  const entries = [
    ...((nav as unknown as Record<string, unknown>)['liEntries'] as Map<HTMLElement, unknown>).values(),
  ];
  const hit = entries.find((e) => ((e as { text?: string }).text ?? '').includes(label));
  if (!hit) throw new Error(`no nav entry labeled "${label}"`);
  return hit;
}

/** Open the context menu for `label` and return its rows' text. */
function openMenu(nav: NavigationPanel, label: string): string[] {
  (nav as unknown as { openContextMenu: (x: number, y: number, e: unknown) => void }).openContextMenu(
    10,
    10,
    entryFor(nav, label),
  );
  return menuRows();
}

/** The menu's own rows (the Card submenu's rows are listed by `submenuRows`). */
const menuRows = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('.pmd-nav-context-item')]
    .filter((el) => !el.closest('.pmd-nav-context-submenu'))
    .map((el) => el.firstChild?.textContent ?? '');
const submenuRows = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('.pmd-nav-context-submenu .pmd-nav-context-item')].map((el) => el.textContent ?? '');

function clickRow(prefix: string): void {
  const row = [...document.querySelectorAll<HTMLElement>('.pmd-nav-context-item')].find((el) =>
    (el.textContent ?? '').startsWith(prefix),
  );
  if (!row) throw new Error(`no menu row starting "${prefix}"`);
  row.click();
}

function effectivePt(node: PMNode | null): number {
  const m = node?.marks.find((mk) => mk.type.name === 'font_size');
  return m ? Number(m.attrs['halfPoints']) / 2 : NORMAL_PT;
}

/** The point size of the text node containing `needle`. */
function ptOf(doc: PMNode, needle: string): number {
  let pt = NORMAL_PT;
  doc.descendants((node) => {
    if (node.isText && node.text!.includes(needle)) {
      pt = effectivePt(node);
      return false;
    }
    return true;
  });
  return pt;
}

beforeEach(() => {
  setNavCommandRunner((_id, state) => {
    let out: import('prosemirror-state').Transaction | null = null;
    shrinkText(
      (node) => effectivePt(node),
      () => NORMAL_PT,
      () => false,
      () => compileShrinkProtections([], '', ''),
    )(state, (tr) => {
      out = tr;
    });
    return out;
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('outline right-click menu', () => {
  it('no longer offers Select heading and contents', () => {
    const { nav } = setup(card('Alpha tag', highlighted('lit'), schema.text(' body')));
    const rows = openMenu(nav, 'Alpha tag');
    expect(rows.some((r) => r.startsWith('Select'))).toBe(false);
    expect(rows.some((r) => r.startsWith('Cut'))).toBe(true);
  });

  it('has a Card submenu holding what the toolbar Card menu has, and no longer lists those rows itself', () => {
    const rows = openMenu(setup(card('Alpha tag', highlighted('lit'))).nav, 'Alpha tag');
    expect(rows).toContain('Card');
    expect(rows.some((r) => /^(Shrink|Unhighlight|Rehighlight|Mark|Unmark|Show heading level)/.test(r))).toBe(false);
    expect(submenuRows()).toEqual([
      'Condense',
      'Condense without paragraph integrity',
      'Condense with pilcrows',
      'Condense with warning',
      'Uncondense',
      'Create Reference',
      'Extract Undertag',
      'Lock Highlighting',
      'Unhighlight Card',
      'Highlight to Background',
      'Background to Highlight',
      'Mark Card',
      'Shrink',
    ]);
  });

  it('marks the card from the submenu, and the row then reads Unmark Card', () => {
    const { view, nav } = setup(card('Alpha tag', schema.text('body')));
    openMenu(nav, 'Alpha tag');
    clickRow('Mark Card');
    expect(view.state.doc.textContent).toMatch(/Marked/);
    nav.update(view.state.doc);
    document.body.querySelector('.pmd-nav-context-menu')?.remove();
    openMenu(nav, 'Alpha tag');
    expect(submenuRows()).toContain('Unmark Card');
  });

  it('shrinks the card text under the heading, in one undo step', () => {
    const { view, nav } = setup(card('Alpha tag', schema.text('some unread filler text')));
    openMenu(nav, 'Alpha tag');
    clickRow('Shrink');
    expect(ptOf(view.state.doc, 'filler')).toBe(8);
  });

  it('shrinks every card under a block', () => {
    const { view, nav } = setup(
      block('Blk'),
      card('One', schema.text('first card filler')),
      card('Two', schema.text('second card filler')),
    );
    openMenu(nav, 'Blk');
    clickRow('Shrink');
    expect(ptOf(view.state.doc, 'first')).toBe(8);
    expect(ptOf(view.state.doc, 'second')).toBe(8);
  });

  it('Unhighlight card strips the highlighting, and the row becomes Rehighlight card', () => {
    const { view, nav } = setup(card('Alpha tag', highlighted('lit'), schema.text(' plain')));
    openMenu(nav, 'Alpha tag');
    clickRow('Unhighlight');
    expect(view.dom.querySelector('.pmd-highlight')).toBeNull();
    nav.update(view.state.doc);
    document.body.querySelector('.pmd-nav-context-menu')?.remove();
    openMenu(nav, 'Alpha tag');
    expect(submenuRows()).toContain('Rehighlight Card');
    clickRow('Rehighlight');
    expect(view.dom.querySelector('.pmd-highlight')).not.toBeNull();
    document.body.querySelector('.pmd-nav-context-menu')?.remove();
    openMenu(nav, 'Alpha tag');
    expect(submenuRows()).toContain('Unhighlight Card');
  });

  it('shows the highlight row even when there is nothing to unhighlight, like the toolbar menu', () => {
    const { nav } = setup(card('Plain tag', schema.text('no highlighting here')));
    openMenu(nav, 'Plain tag');
    expect(submenuRows()).toContain('Unhighlight Card');
  });

  it('stars a card from the outline and tints its row', () => {
    const { view, nav } = setup(card('Alpha tag', schema.text('body')));
    nav.update(view.state.doc);
    const root = (nav as unknown as { listEl: HTMLElement }).listEl;
    const tagLi = [...root.querySelectorAll<HTMLElement>('.pmd-nav-item')].find((l) => l.textContent?.includes('Alpha tag'))!;
    tagLi.querySelector<HTMLButtonElement>('.pmd-nav-star')!.click();
    expect(view.state.doc.child(0).firstChild!.attrs['starred']).toBe(true);
    nav.update(view.state.doc);
    const again = [...root.querySelectorAll<HTMLElement>('.pmd-nav-item')].find((l) => l.textContent?.includes('Alpha tag'))!;
    expect(again.classList.contains('pmd-nav-item-starred')).toBe(true);
  });

  it('puts a flag on marked cards and an "N marked" count on the block above them', () => {
    const { view, nav } = setup(block('Blk'), card('One', schema.text('a')), card('Two', schema.text('b')));
    (nav as unknown as { setMaxLevel: (n: number) => void }).setMaxLevel(4);
    nav.update(view.state.doc);
    openMenu(nav, 'One');
    clickRow('Mark Card');
    nav.update(view.state.doc);
    const root = (nav as unknown as { listEl: HTMLElement }).listEl;
    expect(root.querySelectorAll('.pmd-nav-mark-flag').length).toBe(1);
    expect(root.querySelector('.pmd-nav-mark-count')?.textContent).toBe('1 marked');
  });
});
