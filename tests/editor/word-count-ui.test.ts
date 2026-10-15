// @vitest-environment jsdom
/** Word Count Selection dialog: flow times always, lay times too once any
 *  reader has a lay speed (a reader without one shows "—", never flow). */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../../src/schema/index.js';
import { settings } from '../../src/editor/settings.js';
import { openWordCount } from '../../src/editor/word-count-ui.js';

const n = schema.nodes;

function mountDoc(): EditorView {
  const doc = n['doc']!.create(null, [
    n['card']!.create(null, [n['tag']!.create({ id: 'T' }, schema.text('ONE TWO THREE FOUR'))]),
  ]);
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, { state: EditorState.create({ doc }) });
}

function rows(): string[][] {
  return [...document.querySelectorAll('.pmd-wc-table tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''),
  );
}
function heads(): string[] {
  return [...document.querySelectorAll('.pmd-wc-table th')].map((th) => th.textContent ?? '');
}

// The dialog is a module singleton whose overlay lives in <body>; leave it be
// and only drop the editor hosts.
afterEach(() => {
  for (const h of document.querySelectorAll('body > div:not(.pmd-settings-overlay)')) h.remove();
});

describe('Word Count Selection', () => {
  it('shows only flow columns when no reader has a lay speed', () => {
    settings.set('readers', [{ name: 'Ann', wpm: 240 }]);
    openWordCount(mountDoc());
    expect(heads()).toEqual(['Reader', 'WPM', 'Time']);
    expect(rows()[0]).toHaveLength(3);
  });

  it('adds lay columns once a reader has a lay speed; others read "—"', () => {
    settings.set('readers', [
      { name: 'Ann', wpm: 240, layWpm: 160 },
      { name: 'Bo', wpm: 300 },
      { name: 'Cy', wpm: 300, tagWpm: 320, layWpm: 150, layTagWpm: 170 },
    ]);
    openWordCount(mountDoc());
    expect(heads()).toEqual(['Reader', 'Flow WPM', 'Flow time', 'Lay WPM', 'Lay time']);
    const r = rows();
    expect(r[0]![3]).toBe('160');
    expect(r[0]![4]).not.toBe('—');
    expect(r[1]![3]).toBe('—');
    expect(r[1]![4]).toBe('—');
    expect(r[2]![1]).toBe('300 / 320');
    expect(r[2]![3]).toBe('150 / 170');
  });
});
