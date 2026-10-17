/**
 * The right-hand AI drawer: Cross-Ex Practice and Card Credibility. One
 * drawer, two modes, so opening one closes the other. Plain DOM; all model
 * work lives in crossex.ts / credibility.ts, persistence in ai-panel-store.ts.
 */

import type { EditorView } from 'prosemirror-view';
import { aiFailureNotice, aiGateToast } from './llm.js';
import { showConfirm } from '../confirm-dialog.js';
import { showToast } from '../toast.js';
import { scrollToHeadingId } from '../precise-scroll.js';
import { setIcon } from '../icons.js';
import {
  collectCardInfo,
  collectOutlineHeadings,
  cardFingerprint,
  type CardInfo,
} from './card-analysis.js';
import {
  buildCrossExInput,
  generateQuestions,
  generateMoreLikeThis,
  generateTraps,
  gradeTrap,
  hasSideSplit,
  shortDocNotice,
  HIGHLIGHT_CAP,
  type CrossExQuestion,
  type TrapQuestion,
  type TrapVerdict,
} from './crossex.js';
import {
  averageScore,
  scorableCards,
  scoreCards,
  verdictFor,
  type CredScore,
  type ScoreBatch,
} from './credibility.js';
import { openDeepDive } from './card-deep-dive-ui.js';
import { emphasisEl } from './markdown-dom.js';
import {
  loadCred,
  loadCrossEx,
  saveCred,
  saveCrossEx,
  type CrossExState,
} from './ai-panel-store.js';

export interface AiPanelHost {
  getView(): EditorView | null;
  /** Stable key for the active document (its docId). */
  getDocKey(): string;
}

type Mode = 'crossex' | 'cred';

let host: AiPanelHost | null = null;
let drawer: HTMLElement | null = null;
let body: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let actionsEl: HTMLElement | null = null;
let mode: Mode | null = null;
let busy = false;

export function initAiPanels(h: AiPanelHost): void {
  host = h;
}

export function closeAiPanel(): void {
  drawer?.remove();
  drawer = body = titleEl = actionsEl = null;
  mode = null;
}

export function isAiPanelOpen(): boolean {
  return drawer !== null;
}

export function openCrossEx(): void {
  if (!aiGateToast()) return;
  openDrawer('crossex');
}

export function openCredibility(): void {
  if (!aiGateToast()) return;
  openDrawer('cred');
}

function openDrawer(next: Mode): void {
  if (!host) return;
  if (mode === next && drawer) {
    closeAiPanel();
    return;
  }
  if (!drawer) buildDrawer();
  mode = next;
  render();
}

function buildDrawer(): void {
  const d = document.createElement('aside');
  d.className = 'pmd-aip';
  d.setAttribute('aria-label', 'AI practice panel');
  const top = document.getElementById('editor')?.getBoundingClientRect().top ?? 140;
  d.style.setProperty('--pmd-aip-top', `${Math.max(60, Math.round(top))}px`);

  const head = document.createElement('div');
  head.className = 'pmd-aip-head';
  titleEl = document.createElement('div');
  titleEl.className = 'pmd-aip-title';
  actionsEl = document.createElement('div');
  actionsEl.className = 'pmd-aip-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pmd-aip-icon-btn';
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close panel');
  setIcon(close, 'close');
  close.addEventListener('click', closeAiPanel);
  head.append(titleEl, actionsEl, close);

  body = document.createElement('div');
  body.className = 'pmd-aip-body';
  d.append(head, body);
  document.body.appendChild(d);
  drawer = d;
}

/** Re-render shortly — streamed updates arrive faster than the panel needs
 *  repainting. A timer, not requestAnimationFrame, which stalls while the
 *  window is hidden. */
let renderQueued = false;
function renderSoon(): void {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    if (busy) render();
  }, 50);
}

function render(): void {
  if (!drawer || !body || !titleEl || !actionsEl || !host) return;
  body.replaceChildren();
  actionsEl.replaceChildren();
  if (mode === 'crossex') renderCrossEx();
  else renderCred();
}

// --- shared bits ------------------------------------------------------------

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

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function notice(text: string): HTMLElement {
  return el('div', 'pmd-aip-notice', text);
}

/** Scroll the document to a card and flash it. */
function goToCard(tag: string): void {
  const view = host?.getView();
  if (!view) return;
  const card = collectCardInfo(view.state.doc).find((c) => c.tag === tag);
  if (!card) {
    showToast('That card is no longer in the document.');
    return;
  }
  if (card.id && scrollToHeadingId(view, card.id, 'center')) {
    const node = view.dom.querySelector<HTMLElement>(`[data-id="${CSS.escape(card.id)}"]`);
    if (node) {
      node.classList.add('pmd-aip-flash');
      setTimeout(() => node.classList.remove('pmd-aip-flash'), 1800);
    }
    return;
  }
  const dom = view.nodeDOM(card.pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center' });
}

async function run<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
  if (busy) return undefined;
  busy = true;
  render();
  try {
    return await work();
  } catch (err) {
    aiFailureNotice(label, err);
    return undefined;
  } finally {
    busy = false;
    render();
  }
}

// --- Cross-Ex ---------------------------------------------------------------

interface DrillState {
  index: number;
  answer: string;
  grade: { verdict: TrapVerdict; feedback: string } | null;
  revealed: boolean;
}

let revealed = new Set<string>();
let drill: DrillState | null = null;
let cxState: CrossExState | null = null;
let cxKey = '';
let busyNote = '';
/** Questions streaming in: replacing the list (`after` null) or going in
 *  under the seed question with that id. */
let pendingQs: { after: string | null; qs: CrossExQuestion[] } | null = null;

function currentCx(): CrossExState | null {
  const key = host?.getDocKey() ?? '';
  if (key !== cxKey) {
    cxKey = key;
    cxState = loadCrossEx(key);
    revealed = new Set();
    drill = null;
  }
  return cxState;
}

function persistCx(): void {
  if (cxState) saveCrossEx(cxKey, cxState);
}

function renderCrossEx(): void {
  if (!body || !titleEl || !actionsEl || !host) return;
  titleEl.textContent = 'Cross-Ex Practice';
  const view = host.getView();
  const state = currentCx();

  if (!view) {
    body.appendChild(notice('Open a document to practice cross-ex on its cards.'));
    return;
  }

  const input = crossExInputFor(view);

  if (drill && state?.traps) {
    renderDrill(state);
    return;
  }

  const note = shortDocNotice(input);
  if (note) body.appendChild(notice(note));

  const bar = el('div', 'pmd-aip-bar');
  const gen = button(
    busy ? busyNote || 'Working…' : state?.questions.length ? 'Regenerate' : 'Generate questions',
    'pmd-aip-btn pmd-aip-btn-primary',
    () => void generate(),
  );
  gen.disabled = busy;
  bar.appendChild(gen);
  if (state?.questions.length) {
    const t = button(
      state.traps ? 'Trap drill' : 'Build trap drill',
      'pmd-aip-btn',
      () => void startDrill(),
    );
    t.disabled = busy;
    bar.appendChild(t);
  }
  body.appendChild(bar);

  if (input.cards.length === 0) {
    body.appendChild(
      notice('No highlighted text found. Questions target only what is read aloud.'),
    );
  }

  if (busy && pendingQs && pendingQs.after === null) {
    for (const q of pendingQs.qs) body.appendChild(pendingCard(q));
    return;
  }

  if (!state?.questions.length) {
    if (!busy) {
      body.appendChild(
        el(
          'p',
          'pmd-aip-empty',
          'Generates 3 to 6 questions an opponent would ask about the tags and highlighted text in this document, with the answer they would likely give and how to press next.',
        ),
      );
    }
    return;
  }

  const split = hasSideSplit(state.questions);
  if (split) {
    for (const side of ['aff', 'neg'] as const) {
      const group = state.questions.filter((q) => q.side === side);
      if (group.length === 0) continue;
      body.appendChild(el('div', `pmd-aip-side pmd-aip-side-${side}`, side === 'aff' ? 'Aff' : 'Neg'));
      for (const q of group) appendWithPending(q, state);
    }
  } else {
    for (const q of state.questions) appendWithPending(q, state);
  }
}

/** A question card, followed by any questions streaming in under it. */
function appendWithPending(q: CrossExQuestion, state: CrossExState): void {
  body?.appendChild(questionCard(q, state));
  if (busy && pendingQs?.after === q.id) {
    for (const p of pendingQs.qs) body?.appendChild(pendingCard(p));
  }
}

/** A question still being written: its text only, no actions yet. */
function pendingCard(q: CrossExQuestion): HTMLElement {
  const card = el('div', 'pmd-aip-q pmd-aip-q-pending');
  card.appendChild(emphasisEl('p', 'pmd-aip-q-text', q.question));
  if (q.cardLabel) card.appendChild(el('span', 'pmd-aip-chip', q.cardLabel));
  return card;
}

function questionCard(q: CrossExQuestion, state: CrossExState): HTMLElement {
  const card = el('div', 'pmd-aip-q');
  card.appendChild(emphasisEl('p', 'pmd-aip-q-text', q.question));
  if (q.cardTag) {
    const chip = button(q.cardLabel || q.cardTag, 'pmd-aip-chip', () => goToCard(q.cardTag!));
    chip.title = 'Go to this card';
    card.appendChild(chip);
  }
  const shown = revealed.has(q.id);
  const row = el('div', 'pmd-aip-q-row');
  row.appendChild(
    button(shown ? 'Hide answer' : 'Show answer', 'pmd-aip-btn pmd-aip-btn-small', () => {
      if (revealed.has(q.id)) revealed.delete(q.id);
      else revealed.add(q.id);
      render();
    }),
  );
  const more = button('3 more like this', 'pmd-aip-btn pmd-aip-btn-small', () => void moreLike(q, state));
  more.disabled = busy;
  row.appendChild(more);
  card.appendChild(row);
  if (shown) {
    card.appendChild(emphasisEl('div', 'pmd-aip-answer', q.answer || 'No answer was returned.'));
    if (q.press) {
      const press = el('div', 'pmd-aip-press');
      press.appendChild(el('span', 'pmd-aip-press-label', 'Press next'));
      press.appendChild(emphasisEl('span', undefined, q.press));
      card.appendChild(press);
    }
  }
  return card;
}

/** The cross-ex prompt input for the doc in `view`: headings, tags, cites
 *  and highlighted text only. */
function crossExInputFor(view: EditorView): ReturnType<typeof buildCrossExInput> {
  const doc = view.state.doc;
  return buildCrossExInput(collectCardInfo(doc), true, collectOutlineHeadings(doc));
}

async function confirmTrim(input: ReturnType<typeof buildCrossExInput>): Promise<boolean> {
  if (!input.overCap) return true;
  return showConfirm({
    title: 'This document is large',
    message:
      `Cross-ex sends the headings, tags, cites and highlighted text, and the highlighted text is ` +
      `capped at ${HIGHLIGHT_CAP.toLocaleString()} characters. This document has ` +
      `${input.highlightedChars.toLocaleString()}. Questions will use the first part only.`,
    confirmLabel: 'Trim and continue',
  });
}

async function generate(): Promise<void> {
  const view = host?.getView();
  if (!view || !aiGateToast()) return;
  const input = crossExInputFor(view);
  if (input.cards.length === 0) {
    showToast('Highlight or underline some card text first.');
    return;
  }
  if (!(await confirmTrim(input))) return;
  busyNote = 'Writing questions…';
  pendingQs = null;
  const qs = await run('Cross-Ex questions', () =>
    generateQuestions(input, (partial) => {
      pendingQs = { after: null, qs: partial };
      renderSoon();
    }),
  );
  pendingQs = null;
  if (!qs) return;
  cxState = { questions: qs, traps: null, at: Date.now() };
  revealed = new Set();
  persistCx();
  render();
}

async function moreLike(seed: CrossExQuestion, state: CrossExState): Promise<void> {
  const view = host?.getView();
  if (!view || !aiGateToast()) return;
  const input = crossExInputFor(view);
  busyNote = 'Writing more…';
  pendingQs = null;
  const qs = await run('More questions', () =>
    generateMoreLikeThis(seed, input, (partial) => {
      pendingQs = { after: seed.id, qs: partial };
      renderSoon();
    }),
  );
  pendingQs = null;
  if (!qs) return;
  const at = state.questions.findIndex((q) => q.id === seed.id);
  state.questions.splice(at + 1, 0, ...qs);
  persistCx();
  render();
}

async function startDrill(): Promise<void> {
  const view = host?.getView();
  const state = currentCx();
  if (!view || !state) return;
  if (!state.traps) {
    if (!aiGateToast()) return;
    const input = crossExInputFor(view);
    busyNote = 'Building the drill…';
    const traps = await run('Trap drill', () =>
      generateTraps(input, state.questions, (partial) => {
        busyNote = `Building the drill… (${Math.min(partial.length, 3)} of 3)`;
        renderSoon();
      }),
    );
    if (!traps) return;
    state.traps = traps;
    persistCx();
  }
  drill = { index: 0, answer: '', grade: null, revealed: false };
  render();
}

function renderDrill(state: CrossExState): void {
  if (!body || !drill || !state.traps) return;
  const traps: TrapQuestion[] = state.traps;
  const d = drill;
  const back = button('← Back to questions', 'pmd-aip-btn pmd-aip-btn-small', () => {
    drill = null;
    render();
  });
  body.appendChild(back);

  if (d.index >= traps.length) {
    const done = el('div', 'pmd-aip-q');
    done.appendChild(el('p', 'pmd-aip-q-text', 'Drill complete'));
    done.appendChild(
      el('p', 'pmd-aip-empty', 'Press Regenerate on the main panel for a fresh set of traps.'),
    );
    body.appendChild(done);
    return;
  }
  const trap = traps[d.index]!;
  const card = el('div', 'pmd-aip-q');
  card.appendChild(el('div', 'pmd-aip-trap-count', `Trap ${d.index + 1} of ${traps.length}`));
  card.appendChild(emphasisEl('p', 'pmd-aip-q-text', trap.setup));

  if (!d.grade && !d.revealed) {
    const ta = el('textarea', 'pmd-aip-textarea') as HTMLTextAreaElement;
    ta.rows = 4;
    ta.placeholder = 'How would you answer in cross-ex?';
    ta.value = d.answer;
    ta.disabled = busy;
    ta.addEventListener('input', () => {
      d.answer = ta.value;
    });
    card.appendChild(ta);
    const row = el('div', 'pmd-aip-q-row');
    const check = button(
      busy ? 'Checking…' : 'Check my answer',
      'pmd-aip-btn pmd-aip-btn-primary',
      () => {
        if (!d.answer.trim()) {
          showToast('Type an answer first.');
          return;
        }
        busyNote = 'Checking…';
        void run('Trap grading', () => gradeTrap(trap, d.answer)).then((g) => {
          if (g) {
            d.grade = g;
            d.revealed = true;
            render();
          }
        });
      },
    );
    check.disabled = busy;
    row.append(
      check,
      button('Skip this trap', 'pmd-aip-btn', () => {
        d.index++;
        d.answer = '';
        render();
      }),
    );
    card.appendChild(row);
  } else {
    if (d.grade) {
      const label =
        d.grade.verdict === 'avoided' ? 'Avoided' : d.grade.verdict === 'fell' ? 'Fell' : 'Partially safe';
      const g = el('div', `pmd-aip-grade pmd-aip-grade-${d.grade.verdict}`);
      g.appendChild(el('strong', undefined, label));
      g.appendChild(emphasisEl('span', undefined, ` ${d.grade.feedback}`));
      card.appendChild(g);
    }
    const ideal = el('div', 'pmd-aip-answer');
    ideal.appendChild(el('span', 'pmd-aip-press-label', 'Ideal answer'));
    ideal.appendChild(emphasisEl('span', undefined, trap.ideal));
    card.appendChild(ideal);
    if (trap.lesson) card.appendChild(emphasisEl('p', 'pmd-aip-empty', trap.lesson));
    card.appendChild(
      button(
        d.index + 1 >= traps.length ? 'Finish' : 'Next trap',
        'pmd-aip-btn pmd-aip-btn-primary',
        () => {
          d.index++;
          d.answer = '';
          d.grade = null;
          d.revealed = false;
          render();
        },
      ),
    );
  }
  body.appendChild(card);
}

// --- Credibility -------------------------------------------------------------

const expanded = new Set<string>();
let credProgress = '';
/** Scores streaming in during a scoring run. */
let partialScores: CredScore[] | null = null;

function renderCred(): void {
  if (!body || !titleEl || !actionsEl || !host) return;
  titleEl.textContent = 'Card Credibility';
  const view = host.getView();
  if (!view) {
    body.appendChild(notice('Open a document to score its cards.'));
    return;
  }
  const key = host.getDocKey();
  const cards = collectCardInfo(view.state.doc);
  const scorable = scorableCards(cards);
  if (scorable.length === 0) {
    body.appendChild(notice('No cards found. Credibility scoring reads each card’s tag and cite.'));
    return;
  }
  const fp = cardFingerprint(scorable);
  const cached = loadCred(key);
  const fresh = cached && cached.fingerprint === fp ? cached : null;

  const rescore = button('Re-score', 'pmd-aip-btn pmd-aip-btn-small', () => {
    void score(scorable, fp, key);
  });
  rescore.title = 'Re-scoring makes fresh AI calls for every card';
  rescore.disabled = busy;
  if (fresh) actionsEl.appendChild(rescore);

  if (busy && partialScores) {
    const bar = el('div', 'pmd-aip-bar');
    const b = button(credProgress || 'Scoring…', 'pmd-aip-btn pmd-aip-btn-primary', () => {});
    b.disabled = true;
    bar.appendChild(b);
    body.appendChild(bar);
    for (const s of partialScores) body.appendChild(credRow(s, undefined, key));
    return;
  }

  if (!fresh) {
    const bar = el('div', 'pmd-aip-bar');
    const b = button(
      busy ? credProgress || 'Scoring…' : `Score ${scorable.length} card${scorable.length === 1 ? '' : 's'}`,
      'pmd-aip-btn pmd-aip-btn-primary',
      () => void score(scorable, fp, key),
    );
    b.disabled = busy;
    bar.appendChild(b);
    body.appendChild(bar);
    body.appendChild(
      el(
        'p',
        'pmd-aip-empty',
        'Scores each card 0 to 10 from its tag and cite only: author, recency, source and tag fit. The AI never reads the card body.' +
          (cached ? ' The tags changed since the last scoring.' : ''),
      ),
    );
    return;
  }

  const avg = averageScore(fresh.scores);
  const header = el('div', 'pmd-aip-cred-head');
  header.appendChild(
    el(
      'span',
      undefined,
      `${fresh.scores.length} card${fresh.scores.length === 1 ? '' : 's'}` +
        (avg !== null ? ` · average ${avg.toFixed(1)}` : ''),
    ),
  );
  body.appendChild(header);
  if (fresh.scores.length < fresh.total) {
    body.appendChild(
      notice(`${fresh.scores.length} of ${fresh.total} cards scored. Re-score to try again.`),
    );
  }

  for (const s of fresh.scores) body.appendChild(credRow(s, fresh.batches, key));
}

/** Colour band for a 0-10 score: Strong is blue, Solid green, Shaky amber,
 *  Weak red (the same bands as the verdict). */
function scoreClass(n: number): string {
  return verdictFor(n).toLowerCase();
}

function credRow(s: CredScore, batches: ScoreBatch[] | undefined, key: string): HTMLElement {
  const open = expanded.has(s.tag);
  const row = el('div', 'pmd-aip-cred');
  const top = el('button', 'pmd-aip-cred-top') as HTMLButtonElement;
  top.type = 'button';
  top.setAttribute('aria-expanded', String(open));
  top.appendChild(el('span', `pmd-aip-score pmd-aip-score-${scoreClass(s.overall)}`, String(s.overall)));
  const text = el('span', 'pmd-aip-cred-text');
  text.appendChild(el('span', 'pmd-aip-verdict', s.verdict));
  text.appendChild(el('span', 'pmd-aip-cred-tag', s.tag));
  top.appendChild(text);
  const chev = el('span', 'pmd-aip-chev');
  setIcon(chev, open ? 'chevron-up' : 'chevron-down');
  top.appendChild(chev);
  top.addEventListener('click', () => {
    if (expanded.has(s.tag)) expanded.delete(s.tag);
    else expanded.add(s.tag);
    render();
  });
  row.appendChild(top);
  if (!open) return row;

  const detail = el('div', 'pmd-aip-cred-detail');
  for (const [label, v] of [
    ['Author', s.author],
    ['Recency', s.recency],
    ['Source', s.source],
    ['Tag fit', s.tagFit],
  ] as const) {
    const r = el('div', 'pmd-aip-bar-row');
    r.appendChild(el('span', 'pmd-aip-bar-label', label));
    const track = el('span', 'pmd-aip-bar-track');
    const fill = el('span', `pmd-aip-bar-fill pmd-aip-score-${scoreClass(v)}`);
    fill.style.width = `${v * 10}%`;
    track.appendChild(fill);
    r.append(track, el('span', 'pmd-aip-bar-num', String(v)));
    detail.appendChild(r);
  }
  if (s.reason) detail.appendChild(emphasisEl('p', 'pmd-aip-reason', s.reason));
  if (s.press) {
    const press = el('div', 'pmd-aip-press pmd-aip-press-red');
    press.appendChild(el('span', 'pmd-aip-press-label', 'Press'));
    press.appendChild(emphasisEl('span', undefined, s.press));
    detail.appendChild(press);
  }
  const actions = el('div', 'pmd-aip-q-row');
  const deeper = button('Deeper analysis', 'pmd-aip-btn pmd-aip-btn-small pmd-aip-btn-primary', () => {
    const view = host?.getView();
    if (!view || !aiGateToast()) return;
    openDeepDive({ view, docKey: key, score: s, batches, onJump: () => goToCard(s.tag) });
  });
  deeper.title = 'Open this card with a fuller AI analysis you can ask follow-up questions about';
  actions.append(deeper, button('Jump to card', 'pmd-aip-btn pmd-aip-btn-small', () => goToCard(s.tag)));
  detail.appendChild(actions);
  row.appendChild(detail);
  return row;
}

async function score(cards: CardInfo[], fp: string, key: string): Promise<void> {
  if (!aiGateToast()) return;
  credProgress = 'Scoring…';
  partialScores = null;
  const result = await run('Card credibility', () =>
    scoreCards(
      cards,
      (done, total) => {
        credProgress = `Scoring ${done} of ${total}…`;
        if (mode === 'cred') render();
      },
      (soFar) => {
        partialScores = soFar;
        credProgress = `Scoring… ${soFar.length} of ${cards.length}`;
        if (mode === 'cred') renderSoon();
      },
    ),
  );
  partialScores = null;
  if (!result) return;
  if (result.scores.length === 0) {
    showToast('The AI returned no scores. Try again.');
    return;
  }
  saveCred(key, {
    fingerprint: fp,
    scores: result.scores,
    total: result.total,
    at: Date.now(),
    batches: result.batches,
  });
  render();
}
