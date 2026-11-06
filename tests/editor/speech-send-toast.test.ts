// @vitest-environment jsdom
/**
 * The "Sent to speech doc" notice: sending a card to the speech doc used to
 * show nothing at all when it worked, so with the speech doc in another pane
 * or window there was no sign it had landed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';

const hostState = vi.hoisted(() => ({
  delivered: true,
  /** What the other window answers when asked to undo a send. */
  undoResult: 'undone' as 'undone' | 'refused' | 'gone',
  sent: [] as Array<{ sendId?: string }>,
  undoAsked: [] as Array<{ sendId: string; windowId?: number }>,
}));
vi.mock('../../src/editor/host/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/host/index.js')>();
  return {
    ...mod,
    getElectronHost: () => ({
      speechSendSlice: async (payload: { sendId?: string }) => {
        hostState.sent.push({ ...(payload.sendId !== undefined ? { sendId: payload.sendId } : {}) });
        return { delivered: hostState.delivered, reason: 'speech-window-gone', windowId: 7 };
      },
      speechUndoSlice: async (payload: { sendId: string; windowId?: number }) => {
        hostState.undoAsked.push(payload);
        return { result: hostState.undoResult };
      },
    }),
  };
});
vi.mock('../../src/editor/confirm-dialog.js', () => ({ alertDialog: vi.fn(async () => {}) }));

import { describeSentSlice, sendToSpeech, takeSendSlice } from '../../src/editor/speech-doc-send.js';
import { getSpeechDocResolver } from '../../src/editor/speech-doc-registry.js';

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

afterEach(() => {
  document.body.innerHTML = '';
  const r = getSpeechDocResolver();
  r.setSpeechByUid(null);
  vi.restoreAllMocks();
  hostState.sent.length = 0;
  hostState.undoAsked.length = 0;
  hostState.undoResult = 'undone';
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

describe('Undo on the notice', () => {
  /** A speech doc that keeps undo history, as a normal document does. */
  function speechWithHistory(): { speech: EditorView; before: PMNode } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const before = docOf(para());
    const speech = new EditorView(host, { state: EditorState.create({ doc: before, schema, plugins: [history()] }) });
    const reg = getSpeechDocResolver();
    reg.registerView('speech-uid', speech);
    reg.setSpeechByUid('speech-uid');
    return { speech, before };
  }
  const cards = (doc: PMNode): number => {
    let n = 0;
    doc.forEach((c) => {
      if (c.type.name === 'card') n++;
    });
    return n;
  };
  const undoButton = (): HTMLButtonElement | null => document.querySelector('.pmd-toast-action-btn');
  const notices = (): string[] => toasts().map((t) => t.textContent ?? '');

  it('is on the notice for a send into this window, at the bottom', async () => {
    speechWithHistory();
    sendToSpeech(sourceWithCard('Warming causes extinction'), false);
    await settle();
    expect(undoButton()?.textContent).toBe('Undo');
    expect(undoButton()!.closest('.pmd-toast')!.classList.contains('pmd-toast-action')).toBe(true);
  });

  it('takes the card back out of the speech doc, leaving it as it was', async () => {
    const { speech, before } = speechWithHistory();
    sendToSpeech(sourceWithCard('Warming causes extinction'), false);
    await settle();
    expect(cards(speech.state.doc)).toBe(1);
    undoButton()!.click();
    await settle();
    expect(cards(speech.state.doc)).toBe(0);
    expect(speech.state.doc.eq(before)).toBe(true);
    expect(notices().some((t) => t === 'Removed “Warming causes extinction” from the speech doc.')).toBe(true);
  });

  it('works for a send to the end of the speech doc too', async () => {
    const { speech, before } = speechWithHistory();
    sendToSpeech(sourceWithCard('Last card'), true);
    await settle();
    undoButton()!.click();
    await settle();
    expect(speech.state.doc.eq(before)).toBe(true);
  });

  it('refuses, and touches nothing, once something was typed in the speech doc', async () => {
    const { speech } = speechWithHistory();
    sendToSpeech(sourceWithCard('Warming causes extinction'), false);
    await settle();
    // Typing straight after the send must not merge into the send's undo step.
    speech.dispatch(speech.state.tr.insertText('my own words', speech.state.selection.from));
    undoButton()!.click();
    await settle();
    expect(cards(speech.state.doc)).toBe(1);
    expect(speech.state.doc.textContent).toContain('my own words');
    expect(notices()).toContain("Can't undo this send from here. Use Undo in the speech doc.");
  });

  it('refuses when the user already undid the send themselves', async () => {
    const { speech } = speechWithHistory();
    sendToSpeech(sourceWithCard('Warming causes extinction'), false);
    await settle();
    const { undo } = await import('prosemirror-history');
    undo(speech.state, speech.dispatch.bind(speech));
    expect(cards(speech.state.doc)).toBe(0);
    undoButton()!.click();
    await settle();
    expect(cards(speech.state.doc)).toBe(0);
    expect(notices()).toContain("Can't undo this send from here. Use Undo in the speech doc.");
  });

  it('still undoes after the user only moved the caret', async () => {
    const { speech, before } = speechWithHistory();
    sendToSpeech(sourceWithCard('Warming causes extinction'), false);
    await settle();
    speech.dispatch(speech.state.tr.setSelection(TextSelection.atStart(speech.state.doc)));
    undoButton()!.click();
    await settle();
    expect(speech.state.doc.eq(before)).toBe(true);
  });

  it('says the speech doc is gone when it was closed after the send', async () => {
    const { speech } = speechWithHistory();
    sendToSpeech(sourceWithCard('Warming causes extinction'), false);
    await settle();
    speech.destroy();
    undoButton()!.click();
    await settle();
    expect(notices()).toContain("The speech doc isn't open any more.");
  });

  it('is not offered for a speech doc that keeps no undo history (a live co-editing session owns its undo)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const speech = new EditorView(host, { state: EditorState.create({ doc: docOf(para()), schema }) });
    const reg = getSpeechDocResolver();
    reg.registerView('speech-uid', speech);
    reg.setSpeechByUid('speech-uid');
    sendToSpeech(sourceWithCard('Warming causes extinction'), false);
    await settle();
    // The card still lands and the notice still shows, at the bottom, without a button.
    expect(cards(speech.state.doc)).toBe(1);
    const t = toasts().find((x) => x.classList.contains('pmd-toast-rich'))!;
    expect(t.classList.contains('pmd-toast-action')).toBe(true);
    expect(undoButton()).toBeNull();
  });

  it('a second send replaces the first notice, so Undo always means the latest', async () => {
    const { speech } = speechWithHistory();
    sendToSpeech(sourceWithCard('First card'), true);
    await settle();
    sendToSpeech(sourceWithCard('Second card'), true);
    await settle();
    expect(document.querySelectorAll('.pmd-toast-action')).toHaveLength(1);
    expect(document.querySelector('.pmd-toast-detail')?.textContent).toBe('“Second card”');
    undoButton()!.click();
    await settle();
    expect(cards(speech.state.doc)).toBe(1);
    expect(speech.state.doc.textContent).toContain('First card');
    expect(speech.state.doc.textContent).not.toContain('Second card');
  });

  describe('for a speech doc in another window', () => {
    function viaOtherWindow(): void {
      const reg = getSpeechDocResolver();
      vi.spyOn(reg, 'getSpeechUid').mockReturnValue('elsewhere');
      vi.spyOn(reg, 'viewForUid').mockReturnValue(null);
      hostState.delivered = true;
    }

    it('asks the window that took the send, by the send\'s own id', async () => {
      viaOtherWindow();
      sendToSpeech(sourceWithCard('Cross window card'), false);
      await settle();
      expect(undoButton()?.textContent).toBe('Undo');
      undoButton()!.click();
      await settle();
      expect(hostState.sent).toHaveLength(1);
      expect(typeof hostState.sent[0]!.sendId).toBe('string');
      expect(hostState.undoAsked).toEqual([{ sendId: hostState.sent[0]!.sendId, windowId: 7 }]);
      expect(notices()).toContain('Removed “Cross window card” from the speech doc.');
    });

    it('relays that the other window refused', async () => {
      viaOtherWindow();
      hostState.undoResult = 'refused';
      sendToSpeech(sourceWithCard('Cross window card'), false);
      await settle();
      undoButton()!.click();
      await settle();
      expect(notices()).toContain("Can't undo this send from here. Use Undo in the speech doc.");
    });

    it('relays that the other window is gone', async () => {
      viaOtherWindow();
      hostState.undoResult = 'gone';
      sendToSpeech(sourceWithCard('Cross window card'), false);
      await settle();
      undoButton()!.click();
      await settle();
      expect(notices()).toContain("The speech doc isn't open any more.");
    });

    it('gives each send its own id', async () => {
      viaOtherWindow();
      sendToSpeech(sourceWithCard('One'), false);
      sendToSpeech(sourceWithCard('Two'), false);
      await settle();
      expect(hostState.sent[0]!.sendId).not.toBe(hostState.sent[1]!.sendId);
    });
  });
});
