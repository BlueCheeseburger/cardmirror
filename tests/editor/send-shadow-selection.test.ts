// @vitest-environment jsdom
/**
 * Sending a DISCONTINUOUS (shadow) selection — a scattered nav-pane ⌘-click
 * set's "Select headings and contents", the manual Ctrl/Cmd selection, Select
 * Similar. The shadow set parks the caret in the doc-level gap before its first
 * range, where the cursor fallback finds no enclosing structure, so the send
 * used to do nothing at all. It now sends every selected piece, in doc order.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { type Node as PMNode, type Slice } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { Fragment, Slice as PMSlice } from 'prosemirror-model';
import {
  takeSendSlice,
  takeSendPieces,
  splitSendSlice,
} from '../../src/editor/speech-doc-send.js';
import { deriveDropzoneLabel } from '../../src/editor/dropzone-store.js';
import { sendViewTo } from '../../src/editor/pairing/send-to-starred.js';
import { relayClient, type SendItem } from '../../src/editor/pairing/relay-client.js';
import { settings } from '../../src/editor/settings.js';
import {
  buildSimilarSelectionPlugin,
  setManualShadowSelection,
  getSimilarSelectionState,
} from '../../src/editor/similar-selection-plugin.js';

const block = (text: string): PMNode =>
  schema.nodes['block']!.create({ id: newHeadingId() }, schema.text(text));
function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
function makeView(children: PMNode[]): EditorView {
  const doc = schema.nodes['doc']!.create(null, children);
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, {
    state: EditorState.create({ doc, plugins: [buildSimilarSelectionPlugin()] }),
  });
}
/** [start, end) of top-level child i. */
function child(view: EditorView, i: number): { from: number; to: number } {
  let out = { from: -1, to: -1 };
  view.state.doc.forEach((n, off, idx) => {
    if (idx === i) out = { from: off, to: off + n.nodeSize };
  });
  return out;
}
const topText = (slice: Slice): string[] => {
  const out: string[] = [];
  slice.content.forEach((n) => out.push(n.textContent));
  return out;
};

describe('takeSendSlice — discontinuous selection', () => {
  const docChildren = () => [
    block('B1'),
    card('t1', 'b1'),
    block('B2'),
    card('t2', 'b2'),
    block('B3'),
    card('t3', 'b3'),
  ];

  it('scattered headings + their sections all travel, nothing in between', () => {
    const view = makeView(docChildren());
    // B1's section (children 0–1) and B3's section (children 4–5).
    setManualShadowSelection(view, [
      { from: child(view, 0).from, to: child(view, 1).to },
      { from: child(view, 4).from, to: child(view, 5).to },
    ]);
    expect(view.state.selection.empty).toBe(true);
    const slice = takeSendSlice(view);
    expect(slice).not.toBeNull();
    expect(slice!.openStart).toBe(0);
    expect(slice!.openEnd).toBe(0);
    expect(topText(slice!)).toEqual(['B1', 't1b1', 'B3', 't3b3']);
    // The shadow selection stays on screen.
    expect(getSimilarSelectionState(view.state).matches.length).toBe(2);
  });

  it('a non-empty real selection still wins over a shadow set', () => {
    const view = makeView(docChildren());
    setManualShadowSelection(view, [
      { from: child(view, 0).from, to: child(view, 1).to },
      { from: child(view, 4).from, to: child(view, 5).to },
    ]);
    const b = child(view, 3);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, b.from + 3, b.to - 3)),
    );
    expect(view.state.selection.empty).toBe(false);
    const slice = takeSendSlice(view)!;
    expect(topText(slice)).toEqual(['t2b2']);
  });
});

/**
 * A multi-piece send keeps its pieces apart for destinations that LIST what
 * they hold. The dropzone shelves one row per piece (as a nav-pane multi-drag
 * does); a recipient gets one bundle labelled "First + N more" (as a multi-drag
 * onto the Send pill does). Before, both showed the first piece's label alone.
 */
describe('send pieces', () => {
  const closed = (nodes: PMNode[]): Slice => new PMSlice(Fragment.fromArray(nodes), 0, 0);
  const labels = (pieces: Slice[]): string[] =>
    pieces.map((p) => deriveDropzoneLabel(p, p.content.firstChild!.type.name));

  it('two sibling blocks come apart, each keeping its cards', () => {
    const pieces = splitSendSlice(
      closed([block('B1'), card('t1', 'b1'), card('t1b', 'x'), block('B2'), card('t2', 'b2')]),
    );
    expect(pieces.map(topText)).toEqual([
      ['B1', 't1b1', 't1bx'],
      ['B2', 't2b2'],
    ]);
    expect(labels(pieces)).toEqual(['B1', 'B2']);
  });

  it('a run of loose cards is one piece per card; a later block takes the cards under it', () => {
    const pieces = splitSendSlice(
      closed([card('t1', 'b1'), card('t2', 'b2'), block('B'), card('t3', 'b3')]),
    );
    expect(pieces.map(topText)).toEqual([['t1b1'], ['t2b2'], ['B', 't3b3']]);
  });

  it('a single unit and an open text fragment are returned whole', () => {
    const one = closed([block('B1'), card('t1', 'b1')]);
    expect(splitSendSlice(one)).toEqual([one]);
    const open = new PMSlice(Fragment.from(schema.text('loose')), 1, 1);
    expect(splitSendSlice(open)).toEqual([open]);
  });

  it('a scattered selection yields one piece per selected heading', () => {
    const view = makeView([
      block('B1'),
      card('t1', 'b1'),
      block('B2'),
      card('t2', 'b2'),
      block('B3'),
      card('t3', 'b3'),
    ]);
    setManualShadowSelection(view, [
      { from: child(view, 0).from, to: child(view, 1).to },
      { from: child(view, 4).from, to: child(view, 5).to },
    ]);
    const pieces = takeSendPieces(view)!;
    expect(labels(pieces)).toEqual(['B1', 'B3']);
    expect(pieces.map(topText)).toEqual([
      ['B1', 't1b1'],
      ['B3', 't3b3'],
    ]);
  });

  it('a plain selection across two blocks also splits; a bare cursor stays one piece', () => {
    const view = makeView([block('B1'), card('t1', 'b1'), block('B2'), card('t2', 'b2')]);
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, child(view, 0).from + 1, child(view, 3).to - 3),
      ),
    );
    expect(labels(takeSendPieces(view)!)).toEqual(['B1', 'B2']);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, child(view, 0).from + 1)),
    );
    expect(takeSendPieces(view)!.map(topText)).toEqual([['B1', 't1b1']]);
  });

  describe('keyboard send to a recipient', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      settings.set('pairingEnabled', false);
    });

    it('bundles the pieces into one item labelled "First + N more"', async () => {
      settings.set('pairingEnabled', true);
      const sent: SendItem[] = [];
      vi.spyOn(relayClient, 'send').mockImplementation(async (_codes, item) => {
        sent.push(item);
        return { ok: 1, fail: 0, authFail: 0 };
      });
      const view = makeView([
        block('B1'),
        card('t1', 'b1'),
        block('B2'),
        card('t2', 'b2'),
        block('B3'),
        card('t3', 'b3'),
      ]);
      setManualShadowSelection(view, [
        { from: child(view, 0).from, to: child(view, 1).to },
        { from: child(view, 4).from, to: child(view, 5).to },
      ]);
      await sendViewTo(view, { codes: ['cmk1.x'], label: 'X' });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.label).toBe('B1 + 1 more');
      expect((sent[0]!.sliceJson as { content: unknown[] }).content).toHaveLength(4);
    });

    it('a single unit keeps its plain label', async () => {
      settings.set('pairingEnabled', true);
      const sent: SendItem[] = [];
      vi.spyOn(relayClient, 'send').mockImplementation(async (_codes, item) => {
        sent.push(item);
        return { ok: 1, fail: 0, authFail: 0 };
      });
      const view = makeView([block('B1'), card('t1', 'b1')]);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, child(view, 0).from + 1)),
      );
      await sendViewTo(view, { codes: ['cmk1.x'], label: 'X' });
      expect(sent.map((i) => i.label)).toEqual(['B1']);
    });
  });
});
