// @vitest-environment jsdom
/**
 * Web multi-tab: a send to a speech doc open in another tab, and the Undo that
 * takes it back. A second BroadcastChannel stands in for the other tab. Only the
 * tab that inserted a send answers an Undo for it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';

vi.mock('../../src/editor/confirm-dialog.js', () => ({ alertDialog: vi.fn(async () => {}) }));

import {
  installIncomingSpeechSliceHandler,
  sendToSpeech,
  takeSendSlice,
} from '../../src/editor/speech-doc-send.js';
import { getSpeechDocResolver } from '../../src/editor/speech-doc-registry.js';

const CHANNEL = 'pmd-speech-slice';
type Msg = { kind: string; nonce?: string; result?: string };

function card(tag: string): PMNode {
  return schema.nodes['card']!.create(null, [
    schema.nodes['tag']!.create(null, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text('body words here')),
  ]);
}
const docOf = (...kids: PMNode[]): PMNode => schema.nodes['doc']!.create(null, kids);
const para = (): PMNode => schema.nodes['paragraph']!.create();

function mkView(doc: PMNode, withHistory: boolean): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, {
    state: EditorState.create({ doc, schema, ...(withHistory ? { plugins: [history()] } : {}) }),
  });
}
function sourceWithCard(tag: string): EditorView {
  const v = mkView(docOf(card(tag), para()), false);
  let pos = -1;
  v.state.doc.descendants((n, p) => {
    if (n.type.name === 'card_body' && pos < 0) pos = p + 2;
    return true;
  });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
  return v;
}
const cards = (doc: PMNode): number => {
  let n = 0;
  doc.forEach((c) => {
    if (c.type.name === 'card') n++;
  });
  return n;
};
async function until(cond: () => boolean, ms = 1500): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

let other: BroadcastChannel;
let heard: Msg[];
beforeAll(() => {
  installIncomingSpeechSliceHandler();
});
afterEach(() => {
  other?.close();
  document.body.innerHTML = '';
  getSpeechDocResolver().setSpeechByUid(null);
  vi.restoreAllMocks();
});
afterAll(() => {
  document.body.innerHTML = '';
});
function otherTab(onMessage?: (m: Msg) => void): void {
  heard = [];
  other = new BroadcastChannel(CHANNEL);
  other.onmessage = (e: MessageEvent<Msg>) => {
    heard.push(e.data);
    onMessage?.(e.data);
  };
}

describe('receiving a send from another tab, and its Undo', () => {
  it('inserts the card, acks, and takes it back out when asked', async () => {
    otherTab();
    const speech = mkView(docOf(para()), true);
    const before = speech.state.doc;
    getSpeechDocResolver().registerView('speech-uid', speech);
    const slice = takeSendSlice(sourceWithCard('Cross tab card'))!;

    other.postMessage({ kind: 'slice', nonce: 'send-1', uid: 'speech-uid', sliceJson: slice.toJSON(), atEnd: true });
    await until(() => heard.some((m) => m.kind === 'ack' && m.nonce === 'send-1'));
    expect(cards(speech.state.doc)).toBe(1);

    other.postMessage({ kind: 'undo', nonce: 'send-1' });
    await until(() => heard.some((m) => m.kind === 'undo-ack'));
    expect(heard.find((m) => m.kind === 'undo-ack')).toMatchObject({ nonce: 'send-1', result: 'undone' });
    expect(speech.state.doc.eq(before)).toBe(true);
  });

  it('refuses once the speech doc was edited since', async () => {
    otherTab();
    const speech = mkView(docOf(para()), true);
    getSpeechDocResolver().registerView('speech-uid', speech);
    const slice = takeSendSlice(sourceWithCard('Cross tab card'))!;
    other.postMessage({ kind: 'slice', nonce: 'send-2', uid: 'speech-uid', sliceJson: slice.toJSON(), atEnd: true });
    await until(() => heard.some((m) => m.kind === 'ack'));
    await until(() => cards(speech.state.doc) === 1); // the ack goes out as the insert is scheduled
    speech.dispatch(speech.state.tr.insertText('typed', speech.state.selection.from));

    other.postMessage({ kind: 'undo', nonce: 'send-2' });
    await until(() => heard.some((m) => m.kind === 'undo-ack'));
    expect(heard.find((m) => m.kind === 'undo-ack')?.result).toBe('refused');
    expect(cards(speech.state.doc)).toBe(1);
  });

  it('answers "refused" for a doc that keeps no undo history, not silence', async () => {
    otherTab();
    const speech = mkView(docOf(para()), false);
    getSpeechDocResolver().registerView('speech-uid', speech);
    const slice = takeSendSlice(sourceWithCard('Cross tab card'))!;
    other.postMessage({ kind: 'slice', nonce: 'send-3', uid: 'speech-uid', sliceJson: slice.toJSON(), atEnd: true });
    await until(() => heard.some((m) => m.kind === 'ack'));
    await until(() => cards(speech.state.doc) === 1);
    other.postMessage({ kind: 'undo', nonce: 'send-3' });
    await until(() => heard.some((m) => m.kind === 'undo-ack'));
    expect(heard.find((m) => m.kind === 'undo-ack')?.result).toBe('refused');
    expect(cards(speech.state.doc)).toBe(1);
  });

  it('stays silent about a send it never inserted, and answers a send only once', async () => {
    otherTab();
    const speech = mkView(docOf(para()), true);
    getSpeechDocResolver().registerView('speech-uid', speech);
    other.postMessage({ kind: 'undo', nonce: 'never-seen' });
    await settle();
    expect(heard.some((m) => m.kind === 'undo-ack')).toBe(false);

    const slice = takeSendSlice(sourceWithCard('Cross tab card'))!;
    other.postMessage({ kind: 'slice', nonce: 'send-4', uid: 'speech-uid', sliceJson: slice.toJSON(), atEnd: true });
    await until(() => heard.some((m) => m.kind === 'ack'));
    await until(() => cards(speech.state.doc) === 1);
    other.postMessage({ kind: 'undo', nonce: 'send-4' });
    await until(() => heard.some((m) => m.kind === 'undo-ack'));
    heard.length = 0;
    other.postMessage({ kind: 'undo', nonce: 'send-4' });
    await settle();
    expect(heard.some((m) => m.kind === 'undo-ack')).toBe(false);
  });
});

describe('sending to a speech doc in another tab, and pressing Undo', () => {
  function viaOtherTab(): void {
    const reg = getSpeechDocResolver();
    vi.spyOn(reg, 'getSpeechUid').mockReturnValue('elsewhere');
    vi.spyOn(reg, 'viewForUid').mockReturnValue(null);
  }
  const undoButton = (): HTMLButtonElement | null => document.querySelector('.pmd-toast-action-btn');
  const notices = (): string[] => [...document.querySelectorAll('.pmd-toast')].map((t) => t.textContent ?? '');

  it('asks the other tab, by the send id, and reports what it did', async () => {
    const asked: Msg[] = [];
    otherTab((m) => {
      if (m.kind === 'slice') other.postMessage({ kind: 'ack', nonce: m.nonce });
      if (m.kind === 'undo') {
        asked.push(m);
        other.postMessage({ kind: 'undo-ack', nonce: m.nonce, result: 'undone' });
      }
    });
    viaOtherTab();
    sendToSpeech(sourceWithCard('Cross tab card'), false);
    await until(() => undoButton() !== null);
    const sliceNonce = heard.find((m) => m.kind === 'slice')!.nonce;
    undoButton()!.click();
    await until(() => notices().some((t) => t.startsWith('Removed')));
    expect(asked).toEqual([{ kind: 'undo', nonce: sliceNonce }]);
    expect(notices()).toContain('Removed “Cross tab card” from the speech doc.');
  });

  it('relays a refusal', async () => {
    otherTab((m) => {
      if (m.kind === 'slice') other.postMessage({ kind: 'ack', nonce: m.nonce });
      if (m.kind === 'undo') other.postMessage({ kind: 'undo-ack', nonce: m.nonce, result: 'refused' });
    });
    viaOtherTab();
    sendToSpeech(sourceWithCard('Cross tab card'), false);
    await until(() => undoButton() !== null);
    undoButton()!.click();
    await until(() => notices().some((t) => t.startsWith("Can't undo")));
  });

  it('says the speech doc is gone when no tab answers', async () => {
    otherTab((m) => {
      if (m.kind === 'slice') other.postMessage({ kind: 'ack', nonce: m.nonce });
    });
    viaOtherTab();
    sendToSpeech(sourceWithCard('Cross tab card'), false);
    await until(() => undoButton() !== null);
    undoButton()!.click();
    await until(() => notices().includes("The speech doc isn't open any more."), 2000);
  });
});
