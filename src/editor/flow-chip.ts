/**
 * Status-bar PolicyDebateFlow chip — shows connection state and lets
 * the user disconnect without opening Settings.
 *
 * States:
 *   Connected — token is set and last poll succeeded (or hasn't failed).
 *   Off       — PF is enabled but no token is stored.
 *   (hidden)  — policyDebateFlowEnabled is false.
 *
 * Clicking "Connected" → POSTs pf-revoke-token (the same server-side
 * revoke PolicyDebateFlow's own status button uses) so the connection
 * is severed for both sides, then clears the token locally regardless
 * of the response — a 401 there just means it was already revoked.
 *
 * Clicking "Off" → calls openSettings() so the user can paste a token.
 *
 * A 30-second background poll against pf-presence mirrors
 * PolicyDebateFlow's own polling cadence, so a disconnect triggered
 * from their side (or token expiry) is reflected here without the
 * user needing to click anything.
 *
 * Desktop-only: index.ts wraps the init call in a getElectronHost()
 * guard (same gate as sendToFlowAtCursor).
 */

import { settings } from './settings.js';
import { showToast } from './toast.js';
import { revokeFlowToken } from './flow-send.js';

const PF_FUNCTIONS_BASE = 'https://tprgqlhytbgfybcolgmu.supabase.co/functions/v1';
const POLL_MS = 30_000;

/** Returns false only when the server explicitly says the token is
 *  invalid (401). Network errors return true so an offline state
 *  doesn't spuriously disconnect. */
async function tokenIsValid(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${PF_FUNCTIONS_BASE}/pf-presence`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status !== 401;
  } catch {
    return true;
  }
}

/** Mount the PolicyDebateFlow status chip. Returns a cleanup function
 *  that cancels the poll timer and unsubscribes from settings. */
export function initFlowChip(
  el: HTMLButtonElement,
  openSettings: () => void,
): () => void {
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  function stopPoll(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePoll(): void {
    stopPoll();
    pollTimer = setTimeout(async () => {
      const token = settings.get('policyDebateFlowToken');
      if (!token) return;
      const valid = await tokenIsValid(token);
      if (!valid) {
        settings.set('policyDebateFlowToken', '');
        showToast('PolicyDebateFlow: session expired — disconnected');
      } else {
        schedulePoll();
      }
    }, POLL_MS);
  }

  function render(): void {
    const enabled = settings.get('policyDebateFlowEnabled');
    const token = settings.get('policyDebateFlowToken');
    if (!enabled) {
      el.hidden = true;
      stopPoll();
      return;
    }
    el.hidden = false;
    const connected = !!token;
    el.textContent = connected ? 'Flow · Connected' : 'Flow · Off';
    el.setAttribute('data-pf-state', connected ? 'connected' : 'off');
    el.title = connected
      ? 'PolicyDebateFlow: connected — click to disconnect'
      : 'PolicyDebateFlow: not connected — click to open Settings';
    if (connected) schedulePoll();
    else stopPoll();
  }

  el.addEventListener('click', () => {
    const token = settings.get('policyDebateFlowToken');
    if (token) {
      void revokeFlowToken(token);
      settings.set('policyDebateFlowToken', '');
      showToast('Disconnected from PolicyDebateFlow');
    } else {
      openSettings();
    }
  });

  render();
  const unsubscribe = settings.subscribe(render);

  return () => {
    stopPoll();
    unsubscribe();
  };
}
