// @vitest-environment jsdom
/**
 * Section picker favorites (user request 2026-09-09): a star on every
 * row pins the section under a Favorites block above the filter, so a
 * section you mirror often is one click, no search. Favorites persist
 * per document path (localStorage) and stay in memory for a pathless doc.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { openSelfRefPicker } from '../../src/editor/self-ref-picker.js';
import { setViewDocPath } from '../../src/editor/transclusion-doc-path.js';
import { persistentSectionFavorites } from '../../src/editor/self-ref-favorites.js';

const n = schema.nodes;
const block = (id: string, text: string): PMNode => n['block']!.create({ id }, schema.text(text));
function card(id: string, tagText: string): PMNode {
  return n['card']!.create(null, [n['tag']!.create({ id }, schema.text(tagText)), n['card_body']!.create(null, schema.text('body words'))]);
}
function fixtureDoc(): PMNode {
  return n['doc']!.create(null, [block('C', 'BLOCK C'), card('X', 'TAG X'), card('Y', 'TAG Y'), block('E', 'BLOCK E'), card('W', 'TAG W')]);
}
function mkView(doc: PMNode, path: string | null = null): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, { state: EditorState.create({ doc, schema }) });
  setViewDocPath(view, path);
  return view;
}
const outlineRows = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.pmd-selfref-picker-list .pmd-selfref-picker-row')];
const favRows = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.pmd-selfref-picker-favorites .pmd-selfref-picker-row')];
const favLabels = (): string[] => favRows().map((r) => r.querySelector('.pmd-selfref-picker-label')!.textContent!);
const rowByLabel = (label: string): HTMLButtonElement => outlineRows().find((r) => r.querySelector('.pmd-selfref-picker-label')!.textContent === label)!;
const star = (row: HTMLButtonElement): HTMLSpanElement => row.querySelector('.pmd-selfref-picker-star')!;
const favBlock = (): HTMLElement => document.querySelector('.pmd-selfref-picker-favorites')!;
function open(view: EditorView, guardPos = 1): string[] {
  const picked: string[] = [];
  openSelfRefPicker(view, { title: 'Test picker', guardPos }, (id) => picked.push(id));
  return picked;
}
function key(k: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}
function closeAll(): void {
  for (let i = 0; i < 20 && document.querySelector('.pmd-route-overlay'); i++) key('Escape');
  document.querySelectorAll('.pmd-route-overlay').forEach((o) => o.remove());
  document.body.querySelectorAll(':scope > div').forEach((d) => d.remove());
}
beforeEach(() => localStorage.clear());
afterEach(closeAll);

describe('section picker favorites', () => {
  it('every id-bearing row has a star; the Favorites block sits above the filter and starts hidden', () => {
    open(mkView(fixtureDoc()));
    for (const r of outlineRows()) expect(star(r).getAttribute('aria-pressed')).toBe('false');
    const dialog = document.querySelector('.pmd-selfref-picker')!;
    const kids = [...dialog.children];
    expect(kids.indexOf(favBlock())).toBeLessThan(kids.indexOf(dialog.querySelector('.pmd-selfref-picker-filter')!));
    expect(favBlock().hidden).toBe(true);
  });

  it('starring pins the section under Favorites; un-starring (from either place) removes it', () => {
    open(mkView(fixtureDoc()));
    star(rowByLabel('TAG Y')).click();
    expect(favBlock().hidden).toBe(false);
    expect(favLabels()).toEqual(['TAG Y']);
    expect(star(rowByLabel('TAG Y')).getAttribute('aria-pressed')).toBe('true');
    star(rowByLabel('BLOCK E')).click();
    expect(favLabels()).toEqual(['TAG Y', 'BLOCK E']); // starring order
    star(favRows()[0]!).click(); // un-star from the Favorites block
    expect(favLabels()).toEqual(['BLOCK E']);
    expect(star(rowByLabel('TAG Y')).getAttribute('aria-pressed')).toBe('false');
    star(rowByLabel('BLOCK E')).click(); // un-star from the outline
    expect(favBlock().hidden).toBe(true);
  });

  it('clicking a favorite picks it; the star click never picks', () => {
    const picked = open(mkView(fixtureDoc()));
    star(rowByLabel('TAG W')).click();
    expect(picked).toEqual([]);
    expect(document.querySelector('.pmd-selfref-picker')).not.toBeNull();
    favRows()[0]!.click();
    expect(picked).toEqual(['W']);
    expect(document.querySelector('.pmd-selfref-picker')).toBeNull();
  });

  it('favorites persist per document path and survive reopening', () => {
    const view = mkView(fixtureDoc(), '/backfiles/Accords.cmir');
    open(view);
    star(rowByLabel('TAG X')).click();
    closeAll();
    expect(persistentSectionFavorites('/backfiles/Accords.cmir').list()).toEqual(['X']);
    open(mkView(fixtureDoc(), '/backfiles/Accords.cmir'));
    expect(favLabels()).toEqual(['TAG X']);
    closeAll();
    open(mkView(fixtureDoc(), '/backfiles/Other.cmir'));
    expect(favBlock().hidden).toBe(true); // another document, its own favorites
  });

  it('a pathless document keeps favorites for its view (reopen on the same view shows them)', () => {
    const view = mkView(fixtureDoc());
    open(view);
    star(rowByLabel('TAG X')).click();
    closeAll();
    open(view);
    expect(favLabels()).toEqual(['TAG X']);
    expect(localStorage.getItem('pmd-selfref-favorites')).toBeNull();
  });

  it('a favorite whose heading is gone is not listed; one in the cursor’s own section shows disabled and cannot be picked', () => {
    persistentSectionFavorites('/p.cmir').set('GONE', true);
    persistentSectionFavorites('/p.cmir').set('C', true);
    const view = mkView(fixtureDoc(), '/p.cmir');
    // Guard inside BLOCK C's section (the block heading itself).
    const picked = open(view, 1);
    expect(favLabels()).toEqual(['BLOCK C']);
    expect(favRows()[0]!.classList.contains('pmd-selfref-picker-row-disabled')).toBe(true);
    favRows()[0]!.click();
    expect(picked).toEqual([]);
  });

  it('arrow keys visit favorites first, then the outline; Enter picks the active favorite', () => {
    const view = mkView(fixtureDoc(), '/k.cmir');
    persistentSectionFavorites('/k.cmir').set('E', true);
    const picked2 = open(view, 1);
    key('ArrowDown');
    expect(favRows()[0]!.classList.contains('pmd-selfref-picker-row-active')).toBe(true);
    key('ArrowDown');
    expect(favRows()[0]!.classList.contains('pmd-selfref-picker-row-active')).toBe(false);
    expect(outlineRows()[0]!.classList.contains('pmd-selfref-picker-row-active')).toBe(true);
    key('ArrowUp');
    expect(favRows()[0]!.classList.contains('pmd-selfref-picker-row-active')).toBe(true);
    key('Enter');
    expect(picked2).toEqual(['E']);
  });
});
