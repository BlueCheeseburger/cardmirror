/**
 * The full-screen deeper analysis for one Card Credibility score: the card on
 * the left (rendered read-only, full formatting), the conversation on the
 * right. Opening it asks the model why it scored the card that way (see
 * card-deep-dive.ts); the user can then keep asking. The conversation is
 * saved per document and card, so reopening picks it up again.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { aiFailureNotice } from './llm.js';
import { setIcon } from '../icons.js';
import { pushOverlay, popOverlay } from '../overlay-stack.js';
import { installModalKeys, captureFocusForDialog, armDialogFocus } from '../text-prompt.js';
import { collectCardInfo } from './card-analysis.js';
import { verdictFor, type CredScore, type ScoreBatch } from './credibility.js';
import { continueDeepDive, openingQuestion, scoringExchange } from './card-deep-dive.js';
import { loadChat, saveChat, type ChatTurn } from './ai-panel-store.js';
import { emphasisEl, renderMarkdown } from './markdown-dom.js';

export interface DeepDiveOpts {
  view: EditorView;
  docKey: string;
  score: CredScore;
  batches: ScoreBatch[] | undefined;
  /** Scroll the document to the card (the overlay closes first). */
  onJump: () => void;
}

/** What the opening question looks like in the conversation (the real one
 *  also carries the card text, which is already on screen). */
const OPENING_SHOWN = 'Why did you score this card that way? Give me a deeper analysis.';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** The card node whose tag text is `tag`, or null if it's gone. */
function findCard(doc: PMNode, tag: string): PMNode | null {
  const info = collectCardInfo(doc).find((c) => c.tag === tag);
  if (!info) return null;
  const node = doc.nodeAt(info.pos - 1);
  return node && node.type.name === 'card' ? node : null;
}

export function openDeepDive(opts: DeepDiveOpts): void {
  const { score, docKey } = opts;
  const doc = opts.view.state.doc;
  const cardNode = findCard(doc, score.tag);
  const info = collectCardInfo(doc).find((c) => c.tag === score.tag);
  const { exchange, index } = scoringExchange(score, opts.batches, info);
  let turns: ChatTurn[] = loadChat(docKey, score.tag);
  let busy = false;
  let failed = false;
  /** The reply as it streams in. */
  let streamed = '';
  let streamFrame = 0;
  let closed = false;

  const overlay = el('div', 'pmd-cdd-overlay');
  const dialog = el('div', 'pmd-cdd');
  overlay.appendChild(dialog);
  const token = pushOverlay();
  const restoreFocus = captureFocusForDialog();
  armDialogFocus(dialog, 'dialog', 'Deeper card analysis');
  let cardView: EditorView | null = null;

  const close = (): void => {
    if (closed) return;
    closed = true;
    removeKeys();
    popOverlay(token);
    cardView?.destroy();
    overlay.remove();
    restoreFocus();
  };
  const removeKeys = installModalKeys(dialog, token, (e) => {
    if (e.key === 'Escape') {
      close();
      return true;
    }
    return false;
  });

  // --- top bar ---------------------------------------------------------------
  const bar = el('div', 'pmd-cdd-bar');
  const back = btn('Back to scores', 'pmd-cdd-btn', close);
  const backIcon = el('span', 'pmd-cdd-btn-icon');
  setIcon(backIcon, 'chevron-left');
  back.prepend(backIcon);
  const titleWrap = el('div', 'pmd-cdd-title-wrap');
  const verdict = verdictFor(score.overall);
  const chip = el('span', `pmd-cdd-score pmd-aip-score-${verdict.toLowerCase()}`, String(score.overall));
  const titleText = el('div', 'pmd-cdd-title-text');
  titleText.append(el('span', 'pmd-cdd-kicker', `Deeper analysis · ${verdict}`), el('span', 'pmd-cdd-title', score.tag));
  titleWrap.append(chip, titleText);
  const actions = el('div', 'pmd-cdd-actions');
  const jump = btn('Jump to card', 'pmd-cdd-btn', () => {
    close();
    opts.onJump();
  });
  const restart = btn('New conversation', 'pmd-cdd-btn', () => {
    if (busy) return;
    turns = [];
    saveChat(docKey, score.tag, null);
    void ask(null);
  });
  restart.title = 'Clear this conversation and ask again from the start';
  const x = el('button', 'pmd-cdd-icon-btn');
  x.type = 'button';
  x.title = 'Close';
  x.setAttribute('aria-label', 'Close');
  setIcon(x, 'close');
  x.addEventListener('click', close);
  actions.append(jump, restart, x);
  bar.append(back, titleWrap, actions);

  // --- card pane -----------------------------------------------------------------
  const main = el('div', 'pmd-cdd-main');
  const cardPane = el('section', 'pmd-cdd-card');
  cardPane.setAttribute('aria-label', 'Card');
  const subs = el('div', 'pmd-cdd-subscores');
  for (const [label, v] of [
    ['Author', score.author],
    ['Recency', score.recency],
    ['Source', score.source],
    ['Tag fit', score.tagFit],
  ] as const) {
    const s = el('div', 'pmd-cdd-sub');
    s.append(
      el('span', 'pmd-cdd-sub-label', label),
      el('span', `pmd-cdd-sub-num pmd-aip-score-${verdictFor(v).toLowerCase()}`, String(v)),
    );
    subs.appendChild(s);
  }
  cardPane.appendChild(subs);
  if (score.reason) cardPane.appendChild(emphasisEl('p', 'pmd-cdd-reason', score.reason));
  const cardScroll = el('div', 'pmd-cdd-card-scroll');
  if (cardNode) {
    const mount = el('div', 'pmd-pane-editor pmd-recover-preview-editor pmd-cdd-card-editor');
    cardScroll.appendChild(mount);
    const cardDoc = doc.type.schema.topNodeType.create(null, [cardNode]);
    const v: EditorView = new EditorView(mount, {
      state: EditorState.create({ doc: cardDoc }),
      editable: () => false,
      dispatchTransaction(tr) {
        if (tr.docChanged) return;
        v.updateState(v.state.apply(tr));
      },
    });
    cardView = v;
  } else {
    cardScroll.appendChild(
      el('p', 'pmd-cdd-missing', 'This card is no longer in the document. The analysis still works from its tag and cite.'),
    );
  }
  cardPane.appendChild(cardScroll);

  // --- chat pane -----------------------------------------------------------------
  const chat = el('section', 'pmd-cdd-chat');
  chat.setAttribute('aria-label', 'Analysis');
  const log = el('div', 'pmd-cdd-log');
  log.setAttribute('aria-live', 'polite');
  const composer = el('form', 'pmd-cdd-composer');
  const input = el('textarea', 'pmd-cdd-input');
  input.rows = 1;
  input.placeholder = 'Ask a follow-up about this card…';
  input.setAttribute('aria-label', 'Your message');
  const send = el('button', 'pmd-cdd-send', 'Send');
  send.type = 'submit';
  composer.append(input, send);
  chat.append(log, composer);
  main.append(cardPane, chat);
  dialog.append(bar, main);
  document.body.appendChild(overlay);

  const autosize = (): void => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    autosize();
    void ask(text);
  });

  function renderLog(): void {
    log.replaceChildren();
    for (const t of turns) {
      if (t.role === 'user') {
        log.appendChild(el('div', 'pmd-cdd-msg pmd-cdd-msg-user', t.display ?? t.content));
      } else {
        const m = el('div', 'pmd-cdd-msg pmd-cdd-msg-ai');
        m.appendChild(renderMarkdown(t.content));
        log.appendChild(m);
      }
    }
    if (busy && streamed) {
      const m = el('div', 'pmd-cdd-msg pmd-cdd-msg-ai pmd-cdd-streaming');
      m.appendChild(renderMarkdown(streamed));
      log.appendChild(m);
    } else if (busy) {
      const typing = el('div', 'pmd-cdd-msg pmd-cdd-msg-ai pmd-cdd-typing');
      typing.setAttribute('aria-label', 'Thinking');
      for (let k = 0; k < 3; k++) typing.appendChild(el('span', 'pmd-cdd-dot'));
      log.appendChild(typing);
    } else if (failed) {
      const err = el('div', 'pmd-cdd-error');
      err.append(el('span', undefined, 'The analysis didn’t come through. '));
      err.appendChild(btn('Try again', 'pmd-cdd-btn pmd-cdd-btn-small', () => void ask(null, true)));
      log.appendChild(err);
    }
    send.disabled = busy;
    input.disabled = busy;
    if (stick) log.scrollTop = log.scrollHeight;
  }

  /** Follow the reply down only while the user is at the bottom. */
  let stick = true;
  log.addEventListener('scroll', () => {
    stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  });

  /** Send `text` as the user's next message (null = the opening question),
   *  or with `retry` re-ask for the last unanswered user turn. */
  async function ask(text: string | null, retry = false): Promise<void> {
    if (busy) return;
    if (!retry) {
      turns.push(
        text === null
          ? { role: 'user', content: openingQuestion(index, score.tag, cardNode), display: OPENING_SHOWN }
          : { role: 'user', content: text },
      );
      saveChat(docKey, score.tag, turns);
    }
    busy = true;
    failed = false;
    streamed = '';
    stick = true;
    renderLog();
    try {
      const reply = await continueDeepDive(exchange, turns, (soFar) => {
        streamed = soFar;
        if (closed || streamFrame) return;
        streamFrame = window.setTimeout(() => {
          streamFrame = 0;
          if (busy && !closed) renderLog();
        }, 50);
      });
      turns.push({ role: 'assistant', content: reply });
      saveChat(docKey, score.tag, turns);
    } catch (err) {
      failed = true;
      aiFailureNotice('Deeper analysis', err);
    } finally {
      busy = false;
      streamed = '';
      if (!closed) {
        renderLog();
        if (!failed) input.focus();
      }
    }
  }

  renderLog();
  const last = turns[turns.length - 1];
  if (turns.length === 0) void ask(null);
  else if (last && last.role === 'user') {
    // Closed while a reply was on its way: offer to ask again.
    failed = true;
    renderLog();
  } else input.focus();
}
