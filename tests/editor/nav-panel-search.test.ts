// @vitest-environment jsdom
/**
 * The nav pane's search bar: the query filters/highlights the outline IN
 * PLACE. Options (persisted settings): which heading level to search
 * (Pocket/Hat/Block/Tag/All), "Hide non-matches" (outline narrows to
 * matches plus their ancestors) and "Search content" (a heading also
 * matches when text under it contains the query).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { NavigationPanel } from '../../src/editor/nav-panel.js';
import { settings } from '../../src/editor/settings.js';

const h = (type: string, text: string): PMNode =>
  schema.nodes[type]!.create({ id: newHeadingId() }, schema.text(text));
const card = (tag: string, body: string): PMNode =>
  schema.nodes['card']!.createChecked(null, [
    h('tag', tag),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);

function makeView(children: PMNode[]): EditorView {
  const doc = schema.nodes['doc']!.create(null, children);
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new EditorView(container, { state: EditorState.create({ doc }) });
}

const DOC = (): PMNode[] => [
  h('pocket', '1AC'),
  h('hat', 'Inherency'),
  h('block', 'Warming Advantage'),
  card('Warming causes extinction', 'Sea levels rise'),
  h('block', 'Economy Advantage'),
  card('Decline causes war', 'Trade collapses'),
  h('hat', 'Solvency'),
  h('block', 'Warming — Extensions'),
  card('They don’t solve', 'No carbon tax'),
];

function rootOf(panel: NavigationPanel): HTMLElement {
  return (panel as unknown as { root: HTMLElement }).root;
}

function search(panel: NavigationPanel, q: string): HTMLInputElement {
  const input = rootOf(panel).querySelector<HTMLInputElement>('.pmd-nav-search-input')!;
  input.value = q;
  input.dispatchEvent(new Event('input'));
  // Typing re-renders after a short pause; apply it now.
  const p = panel as unknown as { flushSearchRender(): void; renderForSearch(): void };
  p.flushSearchRender();
  p.renderForSearch();
  return input;
}

/** Rendered outline rows as "level:text". */
function rows(panel: NavigationPanel): string[] {
  return [...rootOf(panel).querySelectorAll('.pmd-nav-list .pmd-nav-item')].map((li) => {
    const level = /pmd-nav-level-(\d)/.exec(li.className)![1];
    return `${level}:${li.querySelector('.pmd-nav-label')!.textContent}`;
  });
}

function hits(panel: NavigationPanel): string[] {
  return [...rootOf(panel).querySelectorAll('.pmd-nav-search-hit .pmd-nav-label')].map(
    (el) => el.textContent ?? '',
  );
}

let view: EditorView;
let panel: NavigationPanel;

function open(): void {
  view = makeView(DOC());
  panel = new NavigationPanel(document.createElement('div'));
  panel.attach(view);
  panel.setSearchMode(true);
}

beforeEach(() => {
  settings.set('navMaxLevel', 3);
  settings.set('navSearchLevel', 0);
  settings.set('navSearchHideNonMatches', true);
  settings.set('navSearchContent', false);
});
afterEach(() => {
  panel.destroy();
  view.destroy();
});

describe('nav pane search', () => {
  it('keeps the level buttons and outline — an empty query changes nothing', () => {
    open();
    const header = rootOf(panel).querySelector('header')!;
    expect(header.querySelector('.pmd-nav-level-group')).not.toBeNull();
    expect(header.querySelector('.pmd-nav-search-input')).not.toBeNull();
    expect(rows(panel)).toEqual([
      '1:1AC',
      '2:Inherency',
      '3:Warming Advantage',
      '3:Economy Advantage',
      '2:Solvency',
      '3:Warming — Extensions',
    ]);
  });

  it('hide non-matches: the outline narrows to matches plus their ancestors', () => {
    open();
    search(panel, 'warming');
    expect(rows(panel)).toEqual([
      '1:1AC',
      '2:Inherency',
      '3:Warming Advantage',
      '4:Warming causes extinction', // a tag match shows past the level filter
      '2:Solvency',
      '3:Warming — Extensions',
    ]);
    expect(hits(panel)).toEqual([
      'Warming Advantage',
      'Warming causes extinction',
      'Warming — Extensions',
    ]);
    expect(rootOf(panel).querySelector('.pmd-nav-search-hit mark')!.textContent).toBe('Warming');
    expect(rootOf(panel).querySelector('.pmd-nav-search-status')!.textContent).toBe('3 matches');
  });

  it('with hide non-matches off, the whole outline stays and matches are highlighted', () => {
    settings.set('navSearchHideNonMatches', false);
    open();
    search(panel, 'economy');
    expect(rows(panel)).toEqual([
      '1:1AC',
      '2:Inherency',
      '3:Warming Advantage',
      '3:Economy Advantage',
      '2:Solvency',
      '3:Warming — Extensions',
    ]);
    expect(hits(panel)).toEqual(['Economy Advantage']);
  });

  it('the level dropdown limits the search to one level', () => {
    settings.set('navSearchLevel', 3);
    open();
    search(panel, 'warming');
    expect(hits(panel)).toEqual(['Warming Advantage', 'Warming — Extensions']);
    settings.set('navSearchLevel', 4);
    expect(hits(panel)).toEqual(['Warming causes extinction']);
    const select = rootOf(panel).querySelector<HTMLSelectElement>('.pmd-nav-search-level')!;
    expect(select.value).toBe('4');
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    expect(settings.get('navSearchLevel')).toBe(2);
    expect(hits(panel)).toEqual([]);
  });

  it('search content credits the nearest heading at the searched level', () => {
    settings.set('navSearchLevel', 3);
    settings.set('navSearchContent', true);
    open();
    search(panel, 'carbon');
    // "No carbon tax" sits in a card under the "Warming — Extensions" block.
    expect(hits(panel)).toEqual(['Warming — Extensions']);
    expect(rootOf(panel).querySelector('.pmd-nav-search-content-hit')).not.toBeNull();
    // Off: body text is not searched.
    settings.set('navSearchContent', false);
    expect(hits(panel)).toEqual([]);
  });

  it('with search content, text in a tag counts as content of the block when tags are not searched', () => {
    settings.set('navSearchLevel', 3);
    settings.set('navSearchContent', true);
    open();
    search(panel, 'extinction');
    expect(hits(panel)).toEqual(['Warming Advantage']);
  });

  it('matches straight quotes against curly ones', () => {
    open();
    search(panel, "don't");
    expect(hits(panel)).toEqual(['They don’t solve']);
  });

  it('skeleton rows are real outline rows — clicking one jumps to it', () => {
    open();
    search(panel, 'extensions');
    const solvency = [...rootOf(panel).querySelectorAll<HTMLElement>('.pmd-nav-item')].find(
      (li) => li.textContent === 'Solvency',
    )!;
    solvency.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
    expect(view.state.selection.$from.parent.textContent).toBe('Solvency');
  });

  it('Enter jumps to the highlighted match; ArrowDown moves the highlight', () => {
    open();
    const input = search(panel, 'advantage');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(view.state.selection.$from.parent.textContent).toBe('Economy Advantage');
  });

  it('re-runs the query when the document changes', () => {
    open();
    search(panel, 'solvency');
    expect(hits(panel)).toEqual(['Solvency']);
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, h('block', 'Solvency Deficit')));
    panel.update(view.state.doc);
    expect(hits(panel)).toEqual(['Solvency', 'Solvency Deficit']);
  });

  it('closing the bar restores the plain outline; the query only applies while open', () => {
    open();
    search(panel, 'economy');
    panel.setSearchMode(false);
    expect(hits(panel)).toEqual([]);
    expect(rows(panel)).toHaveLength(6);
  });

  it('Escape closes the search in one press and brings the full outline back', () => {
    open();
    const input = search(panel, 'warming');
    expect(rows(panel)).not.toContain('3:Economy Advantage');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(rootOf(panel).classList.contains('pmd-nav-searching')).toBe(false);
    expect(hits(panel)).toEqual([]);
    expect(rows(panel)).toContain('3:Economy Advantage');
    // The query is kept for the next open.
    expect(input.value).toBe('warming');
  });

  it('Escape also closes the search from outside the box, when the last click was in the pane', () => {
    open();
    search(panel, 'warming');
    const root = rootOf(panel);
    document.body.appendChild(root);
    const searching = () => root.classList.contains('pmd-nav-searching');
    const esc = () => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.dispatchEvent(e);
      return e;
    };
    const clickOn = (el: Element) => el.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    // The user clicks in the document: Escape there is the editor's.
    clickOn(view.dom);
    expect(esc().defaultPrevented).toBe(false);
    expect(searching()).toBe(true);

    // The user clicks a result (typing focus goes to the editor): Escape
    // closes the search.
    clickOn(root.querySelector('.pmd-nav-item')!);
    view.focus();
    expect(esc().defaultPrevented).toBe(true);
    expect(searching()).toBe(false);

    // Closed: the pane no longer claims Escape.
    clickOn(root.querySelector('.pmd-nav-item')!);
    expect(esc().defaultPrevented).toBe(false);
    root.remove();
  });

  it('pane-wide Escape yields to another text field', () => {
    open();
    search(panel, 'warming');
    const root = rootOf(panel);
    document.body.appendChild(root);
    root.querySelector('.pmd-nav-item')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(root.classList.contains('pmd-nav-searching')).toBe(true);
    other.remove();
    root.remove();
  });

  it('closing keeps the selected result where it was on screen', () => {
    open();
    search(panel, 'extensions');
    const p = panel as unknown as {
      listEl: HTMLElement;
      liEntries: Map<HTMLLIElement, { id: string | null; text: string }>;
      selectSingle(e: unknown): void;
    };
    const entryOf = (text: string) => [...p.liEntries.values()].find((e) => e.text === text)!;
    p.selectSingle(entryOf('Warming — Extensions'));
    // jsdom has no layout: give every row a 20px slot by its index in the
    // list, offset by the list's scrollTop, as a browser would report it.
    const list = p.listEl;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => list.children.length * 20 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 60 });
    list.getBoundingClientRect = () => ({ top: 0, bottom: 60, left: 0, right: 100, width: 100, height: 60, x: 0, y: 0, toJSON: () => ({}) });
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLLIElement.prototype.getBoundingClientRect = function (this: HTMLLIElement) {
      const i = [...list.children].indexOf(this);
      const top = i * 20 - list.scrollTop;
      return { top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: top, toJSON: () => ({}) };
    };
    try {
      const rowTop = (text: string): number => {
        const li = [...p.liEntries.entries()].find(([, e]) => e.text === text)![0];
        return li.getBoundingClientRect().top;
      };
      // Results: 1AC > Solvency > Warming — Extensions. The result is the
      // third row, 40px down.
      expect(rowTop('Warming — Extensions')).toBe(40);
      rootOf(panel).querySelector<HTMLInputElement>('.pmd-nav-search-input')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      // Full outline: the same row is now the 6th (index 5, 100px into the
      // list). It is still 40px down the pane, not scrolled out of view.
      expect(rows(panel).indexOf('3:Warming — Extensions')).toBe(5);
      expect(rowTop('Warming — Extensions')).toBe(40);
      expect(list.scrollTop).toBe(60);
    } finally {
      HTMLLIElement.prototype.getBoundingClientRect = realRect;
    }
  });

  it('the header × closes the search, not the pane, while searching', () => {
    view = makeView(DOC());
    let paneClosed = false;
    panel = new NavigationPanel(document.createElement('div'), {
      onClose: () => (paneClosed = true),
    });
    panel.attach(view);
    panel.setSearchMode(true);
    const close = rootOf(panel).querySelector<HTMLButtonElement>(
      '.pmd-nav-close:not(.pmd-nav-search-btn)',
    )!;
    expect(close.title).toBe('Close search');
    close.click();
    expect(rootOf(panel).classList.contains('pmd-nav-searching')).toBe(false);
    expect(paneClosed).toBe(false);
    close.click();
    expect(paneClosed).toBe(true);
  });

  it('search content credits only a heading that CONTAINS the text', () => {
    // Level Block, query "solvency": the Hat "Solvency" sits AFTER the
    // "Economy Advantage" block's section. It is not content of that block.
    settings.set('navSearchLevel', 3);
    settings.set('navSearchContent', true);
    open();
    search(panel, 'solvency');
    expect(hits(panel)).toEqual([]);
  });
});

/**
 * While results are showing, the outline is for finding and collecting, not
 * for editing: click to jump, Cmd/Shift-click to select among the rows
 * shown, fold with the arrows, drag to the dropzone or Send. Rearranging,
 * Cut and Delete wait until the search is cleared.
 */
describe('nav pane search: results are not an editing surface', () => {
  const priv = () =>
    panel as unknown as {
      selectedIds: Set<string>;
      liEntries: Map<HTMLLIElement, { id: string | null; text: string; level: number }>;
      selectSingle(e: unknown): void;
      handleShiftClick(e: unknown): void;
      searchResultsShown(): boolean;
      openContextMenu(x: number, y: number, e: unknown): void;
      renderDropIndicators(level: number): void;
      dragSurfaceImpl: { hitTest(x: number, y: number): unknown };
    };
  const entry = (text: string) => [...priv().liEntries.values()].find((e) => e.text === text)!;
  const selectedTexts = () =>
    [...priv().liEntries.values()].filter((e) => e.id && priv().selectedIds.has(e.id)).map((e) => e.text);

  it('Shift-click spans the rows shown, never a heading the search hid', () => {
    open();
    search(panel, 'warming');
    // Shown: 1AC > Inherency > Warming Advantage … Solvency > Warming — Extensions.
    // "Economy Advantage" (a block between the two hits) is hidden.
    expect(rows(panel)).not.toContain('3:Economy Advantage');
    priv().selectSingle(entry('Warming Advantage'));
    priv().handleShiftClick(entry('Warming — Extensions'));
    expect(selectedTexts()).toEqual(['Warming Advantage', 'Warming — Extensions']);
    // Without a search the same gesture takes every block in between.
    search(panel, '');
    priv().selectSingle(entry('Warming Advantage'));
    priv().handleShiftClick(entry('Warming — Extensions'));
    expect(selectedTexts()).toEqual(['Warming Advantage', 'Economy Advantage', 'Warming — Extensions']);
  });

  it('a selection made before narrowing the search drops rows that are no longer shown', () => {
    settings.set('navSearchLevel', 3);
    open();
    search(panel, 'e'); // all three blocks
    priv().selectSingle(entry('Warming Advantage'));
    priv().handleShiftClick(entry('Warming — Extensions'));
    expect(selectedTexts()).toEqual(['Warming Advantage', 'Economy Advantage', 'Warming — Extensions']);
    search(panel, 'warming');
    expect(selectedTexts(), 'the hidden block is no longer selected').toEqual([
      'Warming Advantage',
      'Warming — Extensions',
    ]);
  });

  it('the right-click menu offers only Select and Copy', () => {
    open();
    search(panel, 'warming');
    priv().openContextMenu(5, 5, entry('Warming Advantage'));
    const labels = [...document.querySelectorAll('.pmd-nav-context-item')].map((b) => b.textContent);
    expect(labels).toEqual(['Select heading and contents', 'Copy heading and contents']);
    document.querySelector('.pmd-nav-context-menu')?.remove();
    // With the search cleared the full menu is back.
    search(panel, '');
    priv().openContextMenu(5, 5, entry('Warming Advantage'));
    const full = [...document.querySelectorAll('.pmd-nav-context-item')].map((b) => b.textContent);
    expect(full).toContain('Delete heading and contents');
    expect(full).toContain('Cut heading and contents');
    document.querySelector('.pmd-nav-context-menu')?.remove();
  });

  it('offers no drop slots while results are showing', () => {
    open();
    search(panel, 'warming');
    priv().renderDropIndicators(3);
    expect(rootOf(panel).querySelectorAll('.pmd-nav-drop-indicator')).toHaveLength(0);
    expect(priv().dragSurfaceImpl.hitTest(10, 10)).toBeNull();
    search(panel, '');
    priv().renderDropIndicators(3);
    expect(rootOf(panel).querySelectorAll('.pmd-nav-drop-indicator').length).toBeGreaterThan(0);
  });

  it('the caret highlight lands only on a row that contains the caret', () => {
    open();
    search(panel, 'warming');
    // Caret inside the HIDDEN "Economy Advantage" block: the nearest shown
    // row above it is "Warming Advantage"'s card or block, which does not
    // contain it. Nothing lights.
    let pos = 0;
    view.state.doc.descendants((n, p) => {
      if (n.isTextblock && n.textContent === 'Trade collapses') pos = p + 2;
      return true;
    });
    panel.setCaretHeading(pos);
    expect(priv().selectedIds.size).toBe(0);
    // Caret inside a shown card: the deepest shown row containing it lights
    // (the card's tag matched "warming", so it is shown too).
    view.state.doc.descendants((n, p) => {
      if (n.isTextblock && n.textContent === 'Sea levels rise') pos = p + 2;
      return true;
    });
    panel.setCaretHeading(pos);
    expect(selectedTexts()).toEqual(['Warming causes extinction']);
  });
});
