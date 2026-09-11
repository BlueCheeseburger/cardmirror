/**
 * Status-bar PolicyDebateFlow chip — a quick, LOCAL, instantly-reversible
 * pause/resume for a connection that's already paired, distinct from the
 * real "unpair" action (Settings → PolicyDebateFlow's Disconnect button,
 * which calls pf-revoke-token via flow-send.ts's revokeFlowToken and
 * clears policyDebateFlowToken). A hard revoke can't be undone with one
 * click — the token row is deleted server-side, so "reconnecting" would
 * mean a whole new pairing (a fresh code from PolicyDebateFlow, pasted
 * back into Settings) — so the chip never touches the token or calls the
 * network on click. It only flips `policyDebateFlowEnabled`, the existing
 * master on/off switch that's independent of the credential.
 *
 * States:
 *   Connected — enabled AND a token is stored (poll hasn't 401'd).
 *               Click pauses (sets policyDebateFlowEnabled false).
 *   Off       — either paused (a token exists, enabled is false; click
 *               resumes) or never paired (no token yet, enabled true;
 *               click opens Settings to paste one — the only case that
 *               still needs it, since there's nothing local to toggle).
 *   (hidden)  — enabled is false AND no token: never configured at all.
 *
 * Clicking toggles `policyDebateFlowEnabled` whenever a token exists
 * (flow-send.ts's own enabled check then makes sendToFlowAtCursor a
 * no-op while paused) — no network call either direction.
 *
 * A 30-second background poll against pf-presence, running only while
 * "Connected", mirrors PolicyDebateFlow's own polling cadence: a 401
 * means the token itself is dead (revoked from the other side, or
 * expired) rather than merely paused, so that case clears the token
 * outright — a soft pause has nothing left to resume once that happens.
 *
 * Desktop-only: index.ts wraps the init call in a getElectronHost()
 * guard (same gate as sendToFlowAtCursor).
 */

import { settings } from './settings.js';
import { showToast } from './toast.js';

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
    // Nothing to pause/resume and nothing to bootstrap toward — hide.
    if (!enabled && !token) {
      el.hidden = true;
      stopPoll();
      return;
    }
    el.hidden = false;
    const connected = enabled && !!token;
    el.textContent = connected ? 'Flow · Connected' : 'Flow · Off';
    el.setAttribute('data-pf-state', connected ? 'connected' : 'off');
    if (connected) {
      el.title = 'PolicyDebateFlow: connected — click to pause';
    } else if (token) {
      el.title = 'PolicyDebateFlow: paused — click to resume';
    } else {
      el.title = 'PolicyDebateFlow: not connected — click to open Settings';
    }
    if (connected) schedulePoll();
    else stopPoll();
  }

  el.addEventListener('click', () => {
    const enabled = settings.get('policyDebateFlowEnabled');
    const token = settings.get('policyDebateFlowToken');
    if (enabled && token) {
      // Pause: a purely local, instantly-reversible toggle — never
      // touches the token or the network. Real disconnect (revoking
      // the token) lives only in Settings → PolicyDebateFlow.
      settings.set('policyDebateFlowEnabled', false);
      showToast('PolicyDebateFlow paused');
    } else if (token) {
      // Resume: same local toggle, back on.
      settings.set('policyDebateFlowEnabled', true);
      showToast('PolicyDebateFlow resumed');
    } else {
      // Never paired — nothing to toggle, send them to pair one.
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
