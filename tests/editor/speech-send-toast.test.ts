// @vitest-environment jsdom
/**
 * The "Sent to speech doc" notice: sending a card to the speech doc used to
 * show nothing at all when it worked, so with the speech doc in another pane
 * or window there was no sign it had landed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';

const hostState = vi.hoisted(() => ({ delivered: true }));
vi.mock('../../src/editor/host/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/host/index.js')>();
  return {
    ...mod,
    getElectronHost: () => ({ speechSendSlice: async () => ({ delivered: hostState.delivered, reason: 'speech-window-gone' }) }),
  };
});
vi.mock('../../src/editor/confirm-dialog.js', () => ({ alertDialog: vi.fn(async () => {}) }));

import { describeSentSlice, sendToSpeech, takeSendSlice } from '../../src/editor/speech-doc-send.js';
import { getSpeechDocResolver } from '../../src/editor/speech-doc-registry.js';
import { settings } from '../../src/editor/settings.js';

function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.create(null, [
    schema.nodes['tag']!.create(null, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
const docOf = (...kids: PMNode[]): PMNode => schema.nodes['doc']!.create(null, kids);
const para = (t = ''): PMNode => schema.nodes['paragraph']!.create(null, t ? schema.text(t) : undefined);

function mkView(doc: PMNode): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, { state: EditorState.create({ doc, schema }) });
}
/** A view with the caret inside the first card's body. */
function sourceWithCard(tag: string): EditorView {
  const v = mkView(docOf(card(tag, 'body words here'), para('after')));
  let pos = -1;
  v.state.doc.descendants((n, p) => {
    if (n.type.name === 'card_body' && pos < 0) pos = p + 2;
    return true;
  });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
  return v;
}

const toasts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pmd-toast')];
const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  settings.set('speechSendToast', true);
});
afterEach(() => {
  document.body.innerHTML = '';
  const r = getSpeechDocResolver();
  r.setSpeechByUid(null);
  vi.restoreAllMocks();
});

describe('describeSentSlice', () => {
  it('is the first line of what was sent', () => {
    const v = sourceWithCard('Warming causes extinction');
    expect(describeSentSlice(takeSendSlice(v)!)).toBe('Warming causes extinction');
  });
  it('cuts a long line and keeps it to one line', () => {
    const v = sourceWithCard('A very long tag that keeps going on and on well past any sensible toast width');
    const text = describeSentSlice(takeSendSlice(v)!, 30)!;
    expect(text.length).toBeLessThanOrEqual(30);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('the notice', () => {
  function setUpLocalSpeechDoc(): { src: EditorView; speech: EditorView } {
    const speech = mkView(docOf(para()));
    const reg = getSpeechDocResolver();
    reg.registerView('speech-uid', speech);
    reg.setSpeechByUid('speech-uid');
    return { src: sourceWithCard('Warming causes extinction'), speech };
  }

  it('shows after a send to a speech doc in this window, saying what and where', async () => {
    const { src } = setUpLocalSpeechDoc();
    sendToSpeech(src, false);
    await settle();
    const t = toasts().find((x) => x.classList.contains('pmd-toast-rich'))!;
    expect(t.querySelector('.pmd-icon-mic')).not.toBeNull();
    expect(t.querySelector('.pmd-toast-main')?.textContent).toBe('Sent to speech doc');
    expect(t.querySelector('.pmd-toast-detail')?.textContent).toBe('“Warming causes extinction”');
    expect(t.querySelector('.pmd-toast-pill')?.textContent).toBe('at cursor');
  });

  it('says "at end" for a send to the end', async () => {
    const { src } = setUpLocalSpeechDoc();
    sendToSpeech(src, true);
    await settle();
    expect(document.querySelector('.pmd-toast-pill')?.textContent).toBe('at end');
  });

  it('can be turned off in Settings', async () => {
    settings.set('speechSendToast', false);
    const { src } = setUpLocalSpeechDoc();
    sendToSpeech(src, false);
    await settle();
    expect(document.querySelector('.pmd-toast-rich')).toBeNull();
  });

  it('shows after a send to a speech doc in another window', async () => {
    const reg = getSpeechDocResolver();
    vi.spyOn(reg, 'getSpeechUid').mockReturnValue('elsewhere');
    vi.spyOn(reg, 'viewForUid').mockReturnValue(null);
    hostState.delivered = true;
    sendToSpeech(sourceWithCard('Cross window card'), true);
    await settle();
    expect(document.querySelector('.pmd-toast-detail')?.textContent).toBe('“Cross window card”');
    expect(document.querySelector('.pmd-toast-pill')?.textContent).toBe('at end');
  });

  it('does not claim success when the other window never got it', async () => {
    const reg = getSpeechDocResolver();
    vi.spyOn(reg, 'getSpeechUid').mockReturnValue('elsewhere');
    vi.spyOn(reg, 'viewForUid').mockReturnValue(null);
    hostState.delivered = false;
    sendToSpeech(sourceWithCard('Lost card'), false);
    await settle();
    expect(document.querySelector('.pmd-toast-rich')).toBeNull();
  });

  it('shows nothing for a send from the speech doc to itself', async () => {
    const reg = getSpeechDocResolver();
    const speech = sourceWithCard('Already here');
    reg.registerView('speech-uid', speech);
    reg.setSpeechByUid('speech-uid');
    sendToSpeech(speech, false);
    await settle();
    expect(document.querySelector('.pmd-toast-rich')).toBeNull();
    expect(toasts().some((t) => /already the speech doc/.test(t.textContent ?? ''))).toBe(true);
  });
});
