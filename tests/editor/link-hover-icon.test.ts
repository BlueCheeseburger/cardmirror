// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../../src/schema/index.js';
import { linkHoverIconPlugin } from '../../src/editor/link-hover-icon.js';

const HREF = 'https://example.com/page';

function mount(): { view: EditorView; anchor: HTMLAnchorElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const link = schema.marks['link']!.create({ href: HREF });
  const doc = schema.nodes['doc']!.create(null, [
    schema.nodes['paragraph']!.create(null, [
      schema.text('see '),
      schema.text('the example page', [link]),
      schema.text(' now'),
    ]),
  ]);
  const view = new EditorView(host, {
    state: EditorState.create({ doc, schema, plugins: [linkHoverIconPlugin] }),
  });
  // jsdom has no layout: stand in for the two coordinate lookups.
  (view as unknown as { posAtCoords: unknown }).posAtCoords = () => ({ pos: 8, inside: 8 });
  (view as unknown as { coordsAtPos: unknown }).coordsAtPos = () => ({ left: 200, right: 200, top: 100, bottom: 118 });
  return { view, anchor: host.querySelector('a[href]') as HTMLAnchorElement };
}

const btn = (): HTMLButtonElement | null => document.querySelector('.pmd-link-open-btn');

describe('link hover icon', () => {
  let view: EditorView;
  let anchor: HTMLAnchorElement;
  beforeEach(() => {
    vi.useFakeTimers();
    ({ view, anchor } = mount());
  });
  afterEach(() => {
    view.destroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const hover = (): void => {
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
  };

  it('shows the icon above the top-right corner of the link\'s last word', () => {
    hover();
    const b = btn()!;
    expect(b.hidden).toBe(false);
    // Centered on the word's right edge (200), bottom edge 2px above its top (100).
    expect(b.style.left).toBe('190px');
    expect(b.style.top).toBe('78px');
  });

  it('does nothing over plain text', () => {
    document.body.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(btn()?.hidden ?? true).toBe(true);
  });

  it('hides after the pointer leaves, unless it moves onto the icon', () => {
    hover();
    anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    vi.advanceTimersByTime(400);
    expect(btn()!.hidden).toBe(true);

    hover();
    anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: btn() }));
    btn()!.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(400);
    expect(btn()!.hidden).toBe(false);
  });

  it('opens the link when the icon is clicked, then hides', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    hover();
    btn()!.click();
    expect(open).toHaveBeenCalledWith(HREF, '_blank', 'noopener,noreferrer');
    expect(btn()!.hidden).toBe(true);
  });

  it('hides on a key press and on an edit', () => {
    hover();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(btn()!.hidden).toBe(true);
    hover();
    view.dispatch(view.state.tr.insertText('x', 1));
    expect(btn()!.hidden).toBe(true);
  });
});
