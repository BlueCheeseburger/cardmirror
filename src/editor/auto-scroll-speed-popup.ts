/**
 * The speed popup shown while Auto-Scroll runs: a small card with slower and
 * faster buttons around the pace in words per minute, and a Stop button. Drag
 * it by its title to move it; it remembers where you left it.
 *
 * The buttons change the pace for this run only (Settings → Readers keeps
 * its rates), whether or not the speech clock is running. If the run was
 * following the blue bar, the first press lets go of it and paces by the
 * adjusted reading speed (the clock and its bar carry on).
 */

import {
  adjustAutoScrollSpeed,
  autoScrollSpeed,
  onAutoScrollSpeedChange,
  stopAutoScroll,
} from './auto-scroll.js';

/** Words per minute a press changes the pace by; Shift-click changes it by more. */
export const SPEED_STEP_WPM = 10;
export const SPEED_STEP_BIG_WPM = 50;

const POS_KEY = 'cm.autoScrollPopupPos';
const MARGIN = 8;

let root: HTMLElement | null = null;
let valueEl: HTMLElement | null = null;
let noteEl: HTMLElement | null = null;
let unsubscribe: (() => void) | null = null;

function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    return typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null;
  } catch {
    return null;
  }
}

function savePos(x: number, y: number): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
  } catch {
    /* storage blocked: it simply comes back in the corner next time */
  }
}

/** Keep the popup fully inside the window. */
function place(x: number, y: number): void {
  if (!root) return;
  const w = root.offsetWidth || 220;
  const h = root.offsetHeight || 90;
  const cx = Math.min(Math.max(MARGIN, x), Math.max(MARGIN, window.innerWidth - w - MARGIN));
  const cy = Math.min(Math.max(MARGIN, y), Math.max(MARGIN, window.innerHeight - h - MARGIN));
  root.style.left = `${cx}px`;
  root.style.top = `${cy}px`;
  root.style.right = 'auto';
  root.style.bottom = 'auto';
}

function button(label: string, title: string, cls: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  // Keep the editor's focus and selection: clicking here is not editing.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

function build(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pmd-as-popup';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Auto-Scroll speed');

  const head = document.createElement('div');
  head.className = 'pmd-as-head';
  const title = document.createElement('b');
  title.textContent = 'Auto-Scroll';
  noteEl = document.createElement('span');
  noteEl.className = 'pmd-as-note';
  head.append(title, noteEl);

  const row = document.createElement('div');
  row.className = 'pmd-as-row';
  const step = (dir: 1 | -1) => (e: MouseEvent): void =>
    adjustAutoScrollSpeed(dir * (e.shiftKey ? SPEED_STEP_BIG_WPM : SPEED_STEP_WPM));
  const slower = button('◀', 'Slower (Shift: more)', 'pmd-as-arrow', step(-1));
  const faster = button('▶', 'Faster (Shift: more)', 'pmd-as-arrow', step(1));
  const val = document.createElement('div');
  val.className = 'pmd-as-val';
  valueEl = document.createElement('big');
  const unit = document.createElement('small');
  unit.textContent = 'words per minute';
  val.append(valueEl, unit);
  row.append(slower, val, faster);

  const foot = document.createElement('div');
  foot.className = 'pmd-as-foot';
  const hint = document.createElement('span');
  hint.textContent = 'Shift: bigger steps';
  foot.append(hint, button('Stop', 'Stop Auto-Scroll', 'pmd-as-stop', () => stopAutoScroll()));

  el.append(head, row, foot);

  // Drag by the title strip.
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    head.setPointerCapture?.(e.pointerId);
    const move = (m: PointerEvent): void => place(m.clientX - dx, m.clientY - dy);
    const up = (): void => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      const f = el.getBoundingClientRect();
      savePos(f.left, f.top);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  return el;
}

function refresh(): void {
  const info = autoScrollSpeed();
  if (!info) {
    root?.remove();
    root = null;
    valueEl = null;
    noteEl = null;
    return;
  }
  if (!root) {
    root = build();
    document.body.appendChild(root);
    const saved = loadPos();
    if (saved) place(saved.x, saved.y);
  }
  if (valueEl) valueEl.textContent = String(info.wpm);
  if (noteEl) noteEl.textContent = info.following ? 'Following the timer' : 'Your pace';
}

/** Show the popup whenever Auto-Scroll runs. Safe to call twice. */
export function mountAutoScrollSpeedPopup(): void {
  if (unsubscribe) return;
  unsubscribe = onAutoScrollSpeedChange(refresh);
  refresh();
}

/** Test seam. */
export function __resetAutoScrollSpeedPopupForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  root?.remove();
  root = null;
  valueEl = null;
  noteEl = null;
}
