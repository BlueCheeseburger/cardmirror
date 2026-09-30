// @vitest-environment jsdom

/**
 * Nav-pane context menu "Cut heading and contents" (field request
 * 2026-07-26): copy the subtree to the clipboard, then delete it — with
 * the delete gated on (a) the clipboard write succeeding, so a busy
 * clipboard never destroys content, and (b) the doc being unchanged
 * across the async write, so a collab edit landing mid-cut can't shift
 * the deleted span onto the wrong content.
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';

const writeClipboardHtml = vi.fn(async (_html: string, _text: string) => true);
vi.mock('../../src/editor/clipboard-write.js', () => ({
  writeClipboardHtml: (html: string, text: string) => writeClipboardHtml(html, text),
  CLIPBOARD_BUSY_MESSAGE: 'busy',
}));

import { NavigationPanel } from '../../src/editor/nav-panel.js';
import { buildSimilarSelectionPlugin } from '../../src/editor/similar-selection-plugin.js';

function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}

function setup(...children: PMNode[]) {
  const doc = schema.nodes['doc']!.create(null, children);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView(container, {
    state: EditorState.create({ doc, plugins: [buildSimilarSelectionPlugin()] }),
  });
  const nav = new NavigationPanel(document.createElement('div'));
  nav.attach(view);
  nav.update(view.state.doc);
  return { view, nav };
}

/** The nav's heading entry whose label matches `label`. */
function entryFor(nav: NavigationPanel, label: string): unknown {
  const entries = [
    ...((nav as unknown as Record<string, unknown>)['liEntries'] as Map<HTMLElement, unknown>).values(),
  ];
  const hit = entries.find(
    (e) => ((e as { text?: string }).text ?? '').includes(label),
  );
  if (!hit) throw new Error(`no nav entry labeled "${label}"`);
  return hit;
}

async function cut(nav: NavigationPanel, entry: unknown): Promise<void> {
  await (
    nav as unknown as { cutHeadingAndContents: (e: unknown) => Promise<void> }
  ).cutHeadingAndContents(entry);
}

/** Put the nav into a multi-select of the entries labeled `labels`. */
function multiSelect(nav: NavigationPanel, ...labels: string[]): void {
  const ids = labels.map((l) => (entryFor(nav, l) as { id: string }).id);
  (nav as unknown as { selectedIds: Set<string> }).selectedIds = new Set(ids);
}

function del(nav: NavigationPanel, entry: unknown): void {
  (nav as unknown as { deleteHeadingAndContents: (e: unknown) => void }).deleteHeadingAndContents(
    entry,
  );
}

async function copy(nav: NavigationPanel, entry: unknown): Promise<void> {
  await (
    nav as unknown as { copyHeadingAndContents: (e: unknown) => Promise<void> }
  ).copyHeadingAndContents(entry);
}

afterEach(() => {
  writeClipboardHtml.mockClear();
  writeClipboardHtml.mockImplementation(async () => true);
  document.body.innerHTML = '';
});

describe('nav-pane cut heading', () => {
  it('copies the subtree to the clipboard and deletes it from the doc', async () => {
    const { view, nav } = setup(card('Alpha tag', 'alpha body'), card('Beta tag', 'beta body'));
    await cut(nav, entryFor(nav, 'Alpha tag'));

    expect(writeClipboardHtml).toHaveBeenCalledTimes(1);
    const [html, text] = writeClipboardHtml.mock.calls[0]!;
    expect(html).toContain('Alpha tag');
    expect(text).toContain('alpha body');

    const docText = view.state.doc.textContent;
    expect(docText).not.toContain('Alpha tag');
    expect(docText).toContain('Beta tag'); // neighbors untouched
  });

  it('deletes nothing when the clipboard write fails', async () => {
    writeClipboardHtml.mockImplementation(async () => false);
    const { view, nav } = setup(card('Alpha tag', 'alpha body'));
    await cut(nav, entryFor(nav, 'Alpha tag'));
    expect(view.state.doc.textContent).toContain('Alpha tag');
  });

  it('aborts the delete when the doc changes during the async write', async () => {
    const { view, nav } = setup(card('Alpha tag', 'alpha body'), card('Beta tag', 'beta body'));
    // Simulate a collab edit landing while the clipboard write is in
    // flight: insert text at the doc start before the write resolves.
    writeClipboardHtml.mockImplementation(async () => {
      view.dispatch(view.state.tr.insertText('X', 2));
      return true;
    });
    await cut(nav, entryFor(nav, 'Alpha tag'));
    // Copy half happened, delete half aborted — both cards survive.
    expect(view.state.doc.textContent).toContain('Alpha tag');
    expect(view.state.doc.textContent).toContain('Beta tag');
  });
});

describe('nav-pane context ops on a multi-selection', () => {
  it('cut concatenates a DISCONTINUOUS selection in doc order and deletes only it', async () => {
    const { view, nav } = setup(
      card('Alpha tag', 'alpha body'),
      card('Beta tag', 'beta body'),
      card('Gamma tag', 'gamma body'),
    );
    multiSelect(nav, 'Alpha tag', 'Gamma tag'); // ⌘-click set, Beta skipped
    await cut(nav, entryFor(nav, 'Gamma tag')); // right-click on a member

    const [html, text] = writeClipboardHtml.mock.calls[0]! as [string, string];
    // Doc order (Alpha before Gamma) regardless of click order; Beta absent.
    expect(html.indexOf('Alpha tag')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('Alpha tag')).toBeLessThan(html.indexOf('Gamma tag'));
    expect(html).not.toContain('Beta tag');
    expect(text.indexOf('alpha body')).toBeLessThan(text.indexOf('gamma body'));

    const docText = view.state.doc.textContent;
    expect(docText).not.toContain('Alpha tag');
    expect(docText).not.toContain('Gamma tag');
    expect(docText).toContain('Beta tag'); // the unselected middle survives
  });

  it('delete removes every selected subtree in ONE undo step', async () => {
    const { view, nav } = setup(
      card('Alpha tag', 'alpha body'),
      card('Beta tag', 'beta body'),
      card('Gamma tag', 'gamma body'),
    );
    multiSelect(nav, 'Alpha tag', 'Gamma tag');
    del(nav, entryFor(nav, 'Alpha tag'));

    const docText = view.state.doc.textContent;
    expect(docText).not.toContain('Alpha tag');
    expect(docText).not.toContain('Gamma tag');
    expect(docText).toContain('Beta tag');
  });

  it('right-clicking a row OUTSIDE the selection acts on that row alone', async () => {
    const { view, nav } = setup(
      card('Alpha tag', 'alpha body'),
      card('Beta tag', 'beta body'),
      card('Gamma tag', 'gamma body'),
    );
    multiSelect(nav, 'Alpha tag', 'Gamma tag');
    await cut(nav, entryFor(nav, 'Beta tag')); // not a member

    const [html] = writeClipboardHtml.mock.calls[0]! as [string, string];
    expect(html).toContain('Beta tag');
    expect(html).not.toContain('Alpha tag');
    const docText = view.state.doc.textContent;
    expect(docText).toContain('Alpha tag');
    expect(docText).toContain('Gamma tag');
    expect(docText).not.toContain('Beta tag');
  });

  it('copy of a multi-selection leaves the doc untouched', async () => {
    const { view, nav } = setup(card('Alpha tag', 'alpha body'), card('Beta tag', 'beta body'));
    multiSelect(nav, 'Alpha tag', 'Beta tag');
    await copy(nav, entryFor(nav, 'Alpha tag'));

    const [html] = writeClipboardHtml.mock.calls[0]! as [string, string];
    expect(html).toContain('Alpha tag');
    expect(html).toContain('Beta tag');
    expect(view.state.doc.textContent).toContain('Alpha tag');
    expect(view.state.doc.textContent).toContain('Beta tag');
  });
});

describe('nav-pane create live view / linked copy of heading', () => {
  const callCreate = (nav: NavigationPanel, method: string, entry: unknown): void => {
    (nav as unknown as Record<string, (e: unknown) => void>)[method]!(entry);
  };
  const countNodes = (view: EditorView, name: string): number => {
    let n = 0;
    view.state.doc.descendants((node) => {
      if (node.type.name === name) n++;
      return true;
    });
    return n;
  };

  it('creates a live view of the clicked heading at the editor cursor', () => {
    const { view, nav } = setup(card('Alpha tag', 'alpha body'), card('Beta tag', 'beta body'));
    // Cursor inside Beta — OUTSIDE the mirrored Alpha section.
    const betaPos = view.state.doc.content.size - 4;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, betaPos)));

    callCreate(nav, 'createLiveViewFrom', entryFor(nav, 'Alpha tag'));

    expect(countNodes(view, 'self_ref')).toBe(1);
    let attrs: Record<string, unknown> | null = null;
    view.state.doc.descendants((node) => {
      if (node.type.name === 'self_ref') attrs = node.attrs;
      return true;
    });
    expect(String((attrs as unknown as { source_heading_id: string }).source_heading_id)).toBe(
      (entryFor(nav, 'Alpha tag') as { id: string }).id,
    );
  });

  it('refuses to create a live view INSIDE the section it mirrors', () => {
    const { view, nav } = setup(card('Alpha tag', 'alpha body'), card('Beta tag', 'beta body'));
    // Cursor inside Alpha — the section being mirrored.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    callCreate(nav, 'createLiveViewFrom', entryFor(nav, 'Alpha tag'));
    expect(countNodes(view, 'self_ref')).toBe(0);
  });

  it('creates an in-doc linked copy of the clicked heading', () => {
    const { view, nav } = setup(card('Alpha tag', 'alpha body'), card('Beta tag', 'beta body'));
    const betaPos = view.state.doc.content.size - 4;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, betaPos)));

    callCreate(nav, 'createLinkedCopyFrom', entryFor(nav, 'Alpha tag'));

    expect(countNodes(view, 'transclusion_ref')).toBe(1);
    // The copy carries Alpha's content, editable, inside the zone.
    let zoneText = '';
    view.state.doc.descendants((node) => {
      if (node.type.name === 'transclusion_ref') zoneText = node.textContent;
      return true;
    });
    expect(zoneText).toContain('alpha body');
  });
});
