/**
 * Tiny ephemeral tooltip near the mouse pointer ("Copied!", "Saved!",
 * etc.). Tracks the cursor position via a passive global mousemove
 * listener so callers don't need to thread an event through.
 */

import { icon, type IconName } from './icons.js';

let lastMouseX = 0;
let lastMouseY = 0;
let tracked = false;

function ensureTracking(): void {
  if (tracked) return;
  tracked = true;
  window.addEventListener(
    'mousemove',
    (e) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    },
    { passive: true },
  );
}

export interface ToastOptions {
  /** Total time the toast stays visible (ms). Default 1000. */
  durationMs?: number;
  /** Fade-out animation length (ms). Default 200. */
  fadeMs?: number;
  /** A small icon before the message. */
  icon?: IconName;
  /** Quieter text after the message (e.g. what was sent). */
  detail?: string;
  /** A small outlined pill at the end (e.g. "at end"). */
  pill?: string;
}

/** Default visibility from reading time, not vibes (toast audit,
 *  2026-08-17: the flat 1000ms default under-timed 60% of the app's
 *  toasts — every error and most instructions). ~200ms/word at a
 *  UI-reading pace on top of a pickup floor, capped so a runaway
 *  message can't park a tooltip for half a minute. Explicit
 *  `durationMs` still wins. */
function defaultDurationMs(message: string): number {
  const words = message.trim().split(/\s+/).length;
  return Math.min(8000, Math.max(1600, 1600 + (words - 1) * 200));
}

/** The icon / message / detail / pill row shared by the pointer toast and the
 *  bottom toast. Marks the toast `pmd-toast-rich`. */
function appendRichParts(
  toast: HTMLElement,
  message: string,
  parts: Pick<ToastOptions, 'icon' | 'detail' | 'pill'>,
): void {
  toast.classList.add('pmd-toast-rich');
  if (parts.icon) toast.appendChild(icon(parts.icon));
  const main = document.createElement('span');
  main.className = 'pmd-toast-main';
  main.textContent = message;
  toast.appendChild(main);
  if (parts.detail) {
    const detail = document.createElement('span');
    detail.className = 'pmd-toast-detail';
    detail.textContent = parts.detail;
    toast.appendChild(detail);
  }
  if (parts.pill) {
    const pill = document.createElement('span');
    pill.className = 'pmd-toast-pill';
    pill.textContent = parts.pill;
    toast.appendChild(pill);
  }
}

export function showToast(message: string, opts: ToastOptions = {}): void {
  // Guard for non-DOM environments (vitest's Node default). Callers
  // can invoke showToast from any Command without breaking unit tests.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  ensureTracking();
  const durationMs = opts.durationMs ?? defaultDurationMs(message);
  const fadeMs = opts.fadeMs ?? 200;

  const toast = document.createElement('div');
  toast.className = 'pmd-toast';
  if (opts.icon || opts.detail || opts.pill) {
    appendRichParts(toast, message, opts);
  } else {
    toast.textContent = message;
  }
  // Offset slightly down/right from the cursor so it doesn't sit
  // under the pointer.
  toast.style.left = `${lastMouseX + 10}px`;
  toast.style.top = `${lastMouseY + 14}px`;
  toast.style.transitionDuration = `${fadeMs}ms`;
  document.body.appendChild(toast);
  // Clamp inside the viewport: toasts spawn at the cursor, so even a
  // width-capped toast can overflow when the cursor sits near the
  // right or bottom edge. Measured after insertion (wrapping decides
  // the final box), nudged back with a small margin.
  const margin = 8;
  const rect = toast.getBoundingClientRect();
  if (rect.right > window.innerWidth - margin) {
    toast.style.left = `${Math.max(margin, window.innerWidth - margin - rect.width)}px`;
  }
  if (rect.bottom > window.innerHeight - margin) {
    toast.style.top = `${Math.max(margin, window.innerHeight - margin - rect.height)}px`;
  }

  // Trigger fade after duration - fade time so the toast finishes
  // dismissing right around the duration mark.
  const visibleMs = Math.max(0, durationMs - fadeMs);
  setTimeout(() => {
    toast.classList.add('pmd-toast-fade');
    setTimeout(() => toast.remove(), fadeMs);
  }, visibleMs);
}

export interface ActionToastOptions {
  /** The button's label, e.g. "Go back". */
  actionLabel: string;
  /** Runs when the button is pressed; the toast closes first. */
  onAction: () => void;
  /** How long it stays up (ms). Default 8000: long enough to reach for. */
  durationMs?: number;
}

/** Closes a bottom toast. `immediate` skips the fade, for when another notice
 *  is about to take the same spot. Closing twice is harmless. */
export type CloseToast = (immediate?: boolean) => void;

export interface BottomToastOptions {
  /** A button at the end. The toast closes first, then `onClick` runs. */
  action?: { label: string; onClick: () => void };
  /** How long it stays up (ms). Default: 8000 with a button (long enough to
   *  reach for), reading time without one. */
  durationMs?: number;
  /** A small icon before the message. */
  icon?: IconName;
  /** Quieter text after the message (e.g. what was sent). */
  detail?: string;
  /** A small outlined pill after that (e.g. "at end"). */
  pill?: string;
}

/** A toast fixed at the bottom centre of the window rather than at the pointer.
 *  With a button it takes clicks and waits longer, because it offers something
 *  to do rather than confirming something done; without one it ignores the
 *  pointer. Takes the same icon / detail / pill as `showToast`. Returns a
 *  function that closes it. */
export function showBottomToast(message: string, opts: BottomToastOptions = {}): CloseToast {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const toast = document.createElement('div');
  toast.className = 'pmd-toast pmd-toast-action';
  toast.setAttribute('role', 'status');
  if (opts.icon || opts.detail || opts.pill) {
    appendRichParts(toast, message, opts);
  } else {
    const text = document.createElement('span');
    text.className = 'pmd-toast-action-text';
    text.textContent = message;
    toast.appendChild(text);
  }
  const action = opts.action;
  let button: HTMLButtonElement | null = null;
  if (action) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'pmd-toast-action-btn';
    button.textContent = action.label;
    // Pressing it must not pull the keyboard focus out of the editor.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    toast.appendChild(button);
  } else {
    toast.classList.add('pmd-toast-passive');
  }
  document.body.appendChild(toast);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const close: CloseToast = (immediate = false) => {
    if (closed) return;
    closed = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (immediate) {
      toast.remove();
      return;
    }
    toast.classList.add('pmd-toast-fade');
    setTimeout(() => toast.remove(), 200);
  };
  button?.addEventListener('click', () => {
    // The toast stays in the page while it fades: a second press must not fire twice.
    if (closed || !action) return;
    close();
    action.onClick();
  });
  timer = setTimeout(close, opts.durationMs ?? (action ? 8000 : defaultDurationMs(message)));
  return close;
}

/** A bottom toast with one button. */
export function showActionToast(message: string, opts: ActionToastOptions): CloseToast {
  return showBottomToast(message, {
    action: { label: opts.actionLabel, onClick: opts.onAction },
    ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
  });
}
