// @vitest-environment jsdom
/**
 * URLs → links (autolink.ts): the detection rule, the as-you-type plugin
 * (off by default), the Link URLs command's classic scope, and the
 * Mod+click decision.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { findUrls, autolinkPlugin, linkUrls, linkUrlsInRange, isLinkOpenClick } from '../../src/editor/autolink.js';
import { settings } from '../../src/editor/settings.js';

afterEach(() => settings.set('autoLinkUrls', false));

describe('findUrls — the detection rule', () => {
  const hrefs = (t: string) => findUrls(t).map((u) => u.href);
  const texts = (t: string) => findUrls(t).map((u) => t.slice(u.start, u.end));

  it('links http, https and www addresses', () => {
    expect(hrefs('see https://example.org/a and http://foo.bar/x?y=1 and www.nytimes.com/2026/a.html')).toEqual([
      'https://example.org/a',
      'http://foo.bar/x?y=1',
      'https://www.nytimes.com/2026/a.html',
    ]);
    expect(texts('www.nytimes.com/2026/a.html')).toEqual(['www.nytimes.com/2026/a.html']);
  });

  it('leaves trailing punctuation and an unmatched closing bracket outside', () => {
    expect(texts('Read https://example.org/a. Then https://example.org/b, ok?')).toEqual(['https://example.org/a', 'https://example.org/b']);
    expect(texts('(see https://x.org/a)')).toEqual(['https://x.org/a']);
    expect(texts('[https://x.org/a]')).toEqual(['https://x.org/a']);
    expect(texts('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
    expect(texts('https://x.org/a?q=1;')).toEqual(['https://x.org/a?q=1']);
  });

  it('stops at whitespace, angle brackets and quotes, straight or curly', () => {
    expect(texts('"https://x.org/a" and “https://x.org/b” and <https://x.org/c>')).toEqual(['https://x.org/a', 'https://x.org/b', 'https://x.org/c']);
    expect(texts("'https://x.org/d'")).toEqual(['https://x.org/d']);
  });

  it('wants a plausible host and ignores other schemes', () => {
    expect(texts('http://x is not enough, http://localhost:3000/p is, https://a.b is')).toEqual(['http://localhost:3000/p', 'https://a.b']);
    expect(texts('mailto:a@b.org ftp://x.org/f')).toEqual([]);
    expect(texts('https:// nothing')).toEqual([]);
  });
});

// ---- document helpers ----
const tag = (t: string) => schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(t));
const body = (...inl: PMNode[]) => schema.nodes['card_body']!.create(null, inl);
const card = (...k: PMNode[]) => schema.nodes['card']!.createChecked(null, k);
const doc = (...k: PMNode[]) => schema.nodes['doc']!.createChecked(null, k);
const link = (href: string) => schema.marks['link']!.create({ href });
function bodyRange(d: PMNode, nth = 0): { from: number; to: number } {
  let seen = 0;
  let out = { from: -1, to: -1 };
  d.descendants((n, pos) => {
    if (out.from >= 0) return false;
    if (n.type.name === 'card_body') {
      if (seen === nth) out = { from: pos + 1, to: pos + 1 + n.content.size };
      seen++;
    }
    return out.from < 0;
  });
  return out;
}
/** [text, href|null] runs of a doc's card bodies, in order. */
function runs(d: PMNode): [string, string | null][] {
  const out: [string, string | null][] = [];
  d.descendants((n) => {
    if (n.type.name !== 'card_body') return true;
    n.forEach((child) => {
      if (child.isText) out.push([child.text!, child.marks.find((m) => m.type.name === 'link')?.attrs['href'] ?? null]);
    });
    return false;
  });
  return out;
}

describe('autolinkPlugin — as you type', () => {
  function viewFor(d: PMNode, caret: number) {
    let state = EditorState.create({ doc: d, selection: TextSelection.create(d, caret), plugins: [autolinkPlugin()] });
    const view = {
      get state() { return state; },
      dispatch(tr: unknown) { state = state.apply(tr as never); },
    } as never;
    return { view, current: () => state };
  }

  it('does nothing while the setting is off', () => {
    const d = doc(card(tag('T'), body(schema.text('see https://x.org/a'))));
    const h = viewFor(d, bodyRange(d).to); const view = h.view;
    const plugin = autolinkPlugin();
    const handled = plugin.props.handleTextInput!.call(plugin, view, bodyRange(d).to, bodyRange(d).to, ' ', () => h.current().tr);
    expect(handled).toBe(false);
    expect(runs(h.current().doc)).toEqual([['see https://x.org/a', null]]);
  });

  it('links the address before the caret on the space, in one step with the space', () => {
    settings.set('autoLinkUrls', true);
    const d = doc(card(tag('T'), body(schema.text('see https://x.org/a.'))));
    const end = bodyRange(d).to;
    const h = viewFor(d, end); const view = h.view;
    const plugin = autolinkPlugin();
    expect(plugin.props.handleTextInput!.call(plugin, view, end, end, ' ', () => h.current().tr)).toBe(true);
    expect(runs(h.current().doc)).toEqual([['see ', null], ['https://x.org/a', 'https://x.org/a'], ['. ', null]]);
    // A second space after plain text: nothing to link.
    const end2 = bodyRange(h.current().doc).to;
    expect(plugin.props.handleTextInput!.call(plugin, view, end2, end2, ' ', () => h.current().tr)).toBe(false);
  });

  it('links on Enter and lets Enter proceed; never re-links a link', () => {
    settings.set('autoLinkUrls', true);
    const d = doc(card(tag('T'), body(schema.text('www.foo.org/x'))));
    const end = bodyRange(d).to;
    const h = viewFor(d, end); const view = h.view;
    const plugin = autolinkPlugin();
    const enter = new KeyboardEvent('keydown', { key: 'Enter' });
    expect(plugin.props.handleKeyDown!.call(plugin, view, enter), 'Enter proceeds').toBe(false);
    expect(runs(h.current().doc)).toEqual([['www.foo.org/x', 'https://www.foo.org/x']]);
    const before = h.current().doc;
    expect(plugin.props.handleKeyDown!.call(plugin, view, enter)).toBe(false);
    expect(h.current().doc).toBe(before); // already linked: no transaction
    expect(plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))).toBe(false);
  });
});

describe('linkUrls — the command', () => {
  it('links the whole document when nothing is selected, skipping existing links', () => {
    const d = doc(
      card(tag('T'), body(schema.text('a https://x.org/1 b'))),
      card(tag('U'), body(schema.text('already '), schema.text('https://x.org/2', [link('https://x.org/2')]), schema.text(' and www.y.org'))),
    );
    let state = EditorState.create({ doc: d, selection: TextSelection.create(d, 2) });
    let ran = false;
    expect(linkUrls()(state, (tr) => { state = state.apply(tr); ran = true; })).toBe(true);
    expect(ran).toBe(true);
    expect(runs(state.doc)).toEqual([
      ['a ', null], ['https://x.org/1', 'https://x.org/1'], [' b', null],
      ['already ', null], ['https://x.org/2', 'https://x.org/2'], [' and ', null], ['www.y.org', 'https://www.y.org'],
    ]);
    // Nothing left: false, no dispatch.
    expect(linkUrls()(state, () => { throw new Error('must not dispatch'); })).toBe(false);
  });

  it('links only the selection when there is one; a partly selected address is linked whole', () => {
    const d = doc(card(tag('T'), body(schema.text('one https://x.org/1 two https://x.org/2 three'))));
    const r = bodyRange(d);
    // Select from mid-way through the first address to just after it.
    const sel = TextSelection.create(d, r.from + 8, r.from + 22);
    let state = EditorState.create({ doc: d, selection: sel });
    expect(linkUrls()(state, (tr) => { state = state.apply(tr); })).toBe(true);
    expect(runs(state.doc)).toEqual([['one ', null], ['https://x.org/1', 'https://x.org/1'], [' two https://x.org/2 three', null]]);
    const tr = state.tr;
    expect(linkUrlsInRange(tr, 0, state.doc.content.size)).toBe(1);
  });
});

describe('isLinkOpenClick', () => {
  it('is Cmd-click on a Mac and Ctrl-click elsewhere, plain click never', () => {
    const mac = /mac/i.test(navigator.platform ?? '');
    const mod = mac ? { metaKey: true } : { ctrlKey: true };
    expect(isLinkOpenClick(new MouseEvent('click', { button: 0, ...mod }))).toBe(true);
    expect(isLinkOpenClick(new MouseEvent('click', { button: 0 }))).toBe(false);
    expect(isLinkOpenClick(new MouseEvent('click', { button: 0, ...mod, shiftKey: true }))).toBe(false);
    expect(isLinkOpenClick(new MouseEvent('click', { button: 2, ...mod }))).toBe(false);
  });
});
