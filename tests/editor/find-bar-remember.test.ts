// @vitest-environment jsdom
//
// The find bar must re-seed its input on each *fresh* open: the
// remembered query when "Find: remember the last search query" is on,
// empty when it's off. Regression guard — the DOM input otherwise keeps
// its value across open/close and surfaces a stale query regardless of
// the setting.
import { describe, it, expect, beforeEach } from 'vitest';
import { FindReplaceBar } from '../../src/editor/find-replace-ui.js';
import { settings } from '../../src/editor/settings.js';

function makeBar(): { input: () => HTMLInputElement; bar: FindReplaceBar } {
  const bar = new FindReplaceBar(() => null);
  // The bar appends its root to document.body in the constructor; grab
  // the find input it built. (One bar per test — body is cleared in
  // beforeEach.)
  const input = () => document.querySelector<HTMLInputElement>('.pmd-find-input')!;
  return { input, bar };
}

const OPEN = { mode: 'find', sortMode: 'categorized' } as const;

beforeEach(() => {
  document.body.innerHTML = '';
  settings.set('findRememberLastQuery', false);
  settings.set('findLastQuery', '');
});

describe('find bar: remember-last-query gating', () => {
  it('pre-fills the remembered query when the setting is ON', () => {
    settings.set('findRememberLastQuery', true);
    settings.set('findLastQuery', 'photons');
    const { input, bar } = makeBar();
    bar.open(OPEN);
    expect(input().value).toBe('photons');
  });

  it('opens EMPTY when the setting is OFF, even with a stored query', () => {
    // A query can be stored from an earlier ON session; with the
    // setting off the bar must not surface it.
    settings.set('findRememberLastQuery', false);
    settings.set('findLastQuery', 'photons');
    const { input, bar } = makeBar();
    bar.open(OPEN);
    expect(input().value).toBe('');
  });

  it('clears a lingering query on the next open after the setting is turned OFF', () => {
    // The original bug: the DOM input kept its value across open/close,
    // so the query persisted visually no matter the setting.
    settings.set('findRememberLastQuery', true);
    settings.set('findLastQuery', 'photons');
    const { input, bar } = makeBar();
    bar.open(OPEN);
    expect(input().value).toBe('photons');
    bar.close();
    settings.set('findRememberLastQuery', false);
    bar.open(OPEN);
    expect(input().value).toBe('');
  });

  it('preserves the typed query when re-opened while already open (mode switch)', () => {
    settings.set('findRememberLastQuery', false);
    const { input, bar } = makeBar();
    bar.open(OPEN);
    input().value = 'mid-search';
    // Re-trigger (e.g. Ctrl-F → Ctrl-H) without closing first.
    bar.open({ mode: 'replace', sortMode: 'categorized' });
    expect(input().value).toBe('mid-search');
  });
});

describe('find bar: trimmed in find mode', () => {
  const toggle = (cls: string) => document.querySelector<HTMLElement>(`.${cls}`)!;
  const root = () => document.querySelector<HTMLElement>('.pmd-find-bar')!;

  it('marks the bar by mode so CSS can hide Whole word and Close in find mode', () => {
    const { bar } = makeBar();
    bar.open(OPEN);
    expect(root().dataset['mode']).toBe('find');
    expect(toggle('pmd-find-word')).toBeTruthy();
    expect(toggle('pmd-find-close')).toBeTruthy();
    bar.open({ mode: 'replace', sortMode: 'categorized' });
    expect(root().dataset['mode']).toBe('replace');
  });

  it('clears Whole word when opening in find mode so a hidden toggle cannot filter', () => {
    const { bar } = makeBar();
    bar.open({ mode: 'replace', sortMode: 'categorized' });
    const cb = document.querySelector<HTMLInputElement>('.pmd-find-word input')!;
    cb.checked = true;
    bar.open(OPEN);
    expect(cb.checked).toBe(false);
  });
});
