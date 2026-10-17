/**
 * "That key can't do anything right now": a short note near the pointer when a
 * recognized shortcut is held back (a dialog is open, say), so a dead key is
 * never a silent one. A held-down or repeated key keeps one note on screen
 * instead of stacking a new one per press.
 */
import { showToast } from './toast.js';

export function notifyKeyBlocked(message: string): void {
  if (typeof document === 'undefined') return;
  const showing = [...document.querySelectorAll('.pmd-toast:not(.pmd-toast-fade)')].some(
    (t) => t.textContent === message,
  );
  if (showing) return;
  showToast(message);
}

/** Said when a shortcut is pressed while a dialog is open. */
export const CLOSE_DIALOG_FIRST = 'Close this dialog first.';
