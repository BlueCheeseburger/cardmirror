// @vitest-environment jsdom

/**
 * Outline right-click menu read times (fork): the menu ends with how long
 * readers 1 and 2 take to read the clicked heading(s) and everything
 * under them — a "Calculating times" placeholder first, then one line per
 * reader, in the doc's flow or lay speeds. The rows can't be clicked.
 */

import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { NavigationPanel } from '../../src/editor/nav-panel.js';
import { settings } from '../../src/editor/settings.js';

const hl = () => schema.marks['highlight']!.create();

/** A card whose tag is `tag` and whose body has `words` highlighted words. */
function card(tag: string, words: number): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, [
      schema.text(Array(words).fill('w').join(' '), [hl()]),
      schema.text(' not read at all'),
    ]),
  ]);
}

function block(title: string): PMNode {
  return schema.nodes['block']!.create({ id: newHeadingId() }, schema.text(title));
}

let lay = false;

function setup(...children: PMNode[]) {
  const doc = schema.nodes['doc']!.create(null, children);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView(container, { state: EditorState.create({ doc }) });
  const nav = new NavigationPanel(document.createElement('div'), { useLay: () => lay });
  nav.attach(view);
  nav.update(view.state.doc);
  return { view, nav };
}

function entryFor(nav: NavigationPanel, label: string): { id: string } {
  const entries = [
    ...((nav as unknown as Record<string, unknown>)['liEntries'] as Map<HTMLElement, unknown>).values(),
  ];
  const hit = entries.find((e) => ((e as { text?: string }).text ?? '') === label);
  if (!hit) throw new Error(`no nav entry labeled "${label}"`);
  return hit as { id: string };
}

function openMenu(nav: NavigationPanel, label: string): HTMLElement {
  (nav as unknown as { openContextMenu: (x: number, y: number, e: unknown) => void }).openContextMenu(
    10,
    10,
    entryFor(nav, label),
  );
  return document.querySelector<HTMLElement>('.pmd-nav-context-menu')!;
}

const infoRows = (menu: HTMLElement): HTMLElement[] => [
  ...menu.querySelectorAll<HTMLElement>('.pmd-nav-context-item-info'),
];
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

beforeEach(() => {
  lay = false;
  // 60 wpm body / 30 wpm tags: 1 word = 1s body, 2s tag.
  settings.set('readers', [
    { name: 'Alice', wpm: 60, tagWpm: 30, layWpm: 30 },
    { name: 'Bob', wpm: 120 },
    { name: 'Cat', wpm: 10 },
  ]);
});

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelectorAll('.pmd-nav-context-menu').forEach((m) => m.remove());
  document.body.innerHTML = '';
});

describe('outline context menu read times', () => {
  it('shows an italic placeholder, then one line per reader for the first two', async () => {
    const { nav } = setup(block('Econ'), card('One', 58));
    const menu = openMenu(nav, 'Econ');
    const rows = infoRows(menu);
    expect(rows.map((r) => r.textContent)).toEqual(['Calculating times']);
    expect(rows[0]!.classList.contains('pmd-nav-context-item-pending')).toBe(true);
    // The rows sit at the very bottom of the menu.
    expect(menu.lastElementChild).toBe(rows[0]);

    await settle();
    // Block headings aren't read; tag "One" is 1 word at tag speed,
    // plus 58 highlighted body words.
    // Alice: 58s + 2s = 1:00. Bob: 29s + 0.5s = 0:29.
    expect(infoRows(menu).map((r) => r.textContent)).toEqual(['Alice: 1:00', 'Bob: 0:29']);
    expect(menu.querySelector('.pmd-nav-context-item-pending')).toBeNull();
  });

  it('covers everything under the block, and stops at the next block', async () => {
    const { nav } = setup(block('Econ'), card('One', 30), card('Two', 30), block('Other'), card('Three', 600));
    const menu = openMenu(nav, 'Econ');
    await settle();
    // 60 body words + 2 tag words → Alice 60s + 4s.
    expect(infoRows(menu)[0]!.textContent).toBe('Alice: 1:04');
  });

  it('adds up every heading in a multi-selection', async () => {
    const { nav } = setup(block('Econ'), card('One', 30), block('Other'), card('Two', 30));
    (nav as unknown as { selectedIds: Set<string> }).selectedIds = new Set([
      entryFor(nav, 'Econ').id,
      entryFor(nav, 'Other').id,
    ]);
    const menu = openMenu(nav, 'Econ');
    await settle();
    expect(infoRows(menu)[0]!.textContent).toBe('Alice: 1:04');
  });

  it('uses lay speeds when the doc is in lay mode, "—" for a reader without one', async () => {
    lay = true;
    const { nav } = setup(block('Econ'), card('One', 29));
    const menu = openMenu(nav, 'Econ');
    await settle();
    // Alice lay 30 wpm over 30 words = 1:00; Bob has no lay rate.
    expect(infoRows(menu).map((r) => r.textContent)).toEqual(['Alice: 1:00', 'Bob: —']);
  });

  it('clicking a time does nothing and leaves the menu open', async () => {
    const { nav } = setup(block('Econ'), card('One', 5));
    const menu = openMenu(nav, 'Econ');
    await settle();
    infoRows(menu)[0]!.click();
    expect(menu.isConnected).toBe(true);
  });

  it('leaves the times out when no readers are set', () => {
    settings.set('readers', []);
    const { nav } = setup(block('Econ'), card('One', 5));
    const menu = openMenu(nav, 'Econ');
    expect(infoRows(menu)).toHaveLength(0);
  });
});
