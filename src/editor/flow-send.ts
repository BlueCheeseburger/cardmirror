/**
 * Send-to-PolicyDebateFlow: push the tagline (+ short cite) under the
 * cursor straight into a connected PolicyDebateFlow flow, so a user
 * can rattle down their case pressing one key per tagline without
 * ever switching to the browser.
 *
 * Deliberately modular and inert by default: nothing in this file
 * runs unless `policyDebateFlowEnabled` is on AND a token is saved
 * (`sendTaglineToFlowAtCursor` bails before any network access
 * otherwise) — see `settings.ts`'s `policyDebateFlowEnabled` /
 * `policyDebateFlowToken` and their Settings row in `settings-ui.ts`
 * (`buildFlowConnectionEditor`). No other CardMirror module imports
 * from this one, so the integration can be deleted wholesale without
 * touching anything else.
 *
 * Network contract (PolicyDebateFlow, commit dd4725b): two Bearer-token
 * Edge Functions, no Supabase anon key needed on this side. Read
 * presence first (confirms a flow tab is actually open and gets the
 * live target cell), then send — matches the agreed "presence check
 * immediately before sending, no persisted staging table" design.
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { collectCiteText } from './headings.js';
import { settings } from './settings.js';
import { showToast } from './toast.js';

const PF_FUNCTIONS_BASE = 'https://tprgqlhytbgfybcolgmu.supabase.co/functions/v1';

/** The card / analytic_unit enclosing the cursor, walking up from the
 *  deepest depth — mirrors `speech-doc-send.ts`'s `enclosingStructureRange`
 *  for just the two tagline-bearing node types (a hat/pocket/block
 *  heading isn't a tagline and has no cite, so it's not a valid send
 *  target here; matches the "grab the nearest tagline above" behavior
 *  agreed for this command, scoped to what can actually have a cite). */
function nearestCardAtCursor(view: EditorView): PMNode | null {
  const $pos = view.state.selection.$from;
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'card' || node.type.name === 'analytic_unit') return node;
  }
  return null;
}

interface TaglinePayload {
  /** The tagline's plain text. Sent as PolicyDebateFlow's `taglineText`. */
  taglineText: string;
  /** Cite-marked run(s) from anywhere in the card — CardMirror's
   *  existing "short cite" convention (author + date), the same text
   *  the nav pane already shows. Sent as `authorDate`; PolicyDebateFlow
   *  requires this be non-empty (422s otherwise), so callers check
   *  before sending rather than let that round-trip fail. */
  authorDate: string;
}

/** Extract the tagline + short cite from the card enclosing the
 *  cursor. `null` if the cursor isn't inside a card/analytic, the
 *  tag is empty, or there's no cite to send (PolicyDebateFlow
 *  requires `authorDate`). Exported for direct unit testing. */
export function extractTaglinePayload(view: EditorView): TaglinePayload | null {
  const card = nearestCardAtCursor(view);
  if (!card) return null;
  const taglineText = (card.firstChild?.textContent ?? '').trim();
  if (!taglineText) return null;
  const authorDate = collectCiteText(card).trim();
  if (!authorDate) return null;
  return { taglineText, authorDate };
}

interface PfPresence {
  present: true;
  flowId: string;
  flowName: string;
  sheetId: string;
  sheetName: string;
  focusedRow: number;
  focusedCol: number;
}

/** POST pf-revoke-token — the real "unpair" action, used only by
 *  Settings → PolicyDebateFlow's Disconnect button
 *  (`buildFlowConnectionEditor` in `settings-ui.ts`). The status-bar
 *  chip (`flow-chip.ts`) deliberately does NOT call this: a revoke
 *  deletes the token row server-side, which can't be undone with one
 *  click, so the chip only pauses/resumes locally
 *  (`policyDebateFlowEnabled`) and leaves the token alone. `200 { ok:
 *  true }` on success, `401` if the token was already invalid/missing
 *  — either way the caller proceeds to clear the token locally, which
 *  is the authoritative disconnect from CardMirror's side regardless
 *  of whether the remote call landed. */
export async function revokeFlowToken(token: string): Promise<void> {
  try {
    await fetch(`${PF_FUNCTIONS_BASE}/pf-revoke-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // network offline — local clear still disconnects this app
  }
}

type FlowSendResult =
  | { ok: true; flowName: string; sheetName: string }
  | { ok: false; reason: 'not-open' }
  | { ok: false; reason: 'paused' }
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'error'; message: string };

/** GET pf-presence — confirms a PolicyDebateFlow tab is open and
 *  recently focused, and returns exactly where to send the card.
 *
 *  `present: false` splits into two distinct reasons: `paused: true`
 *  (PolicyDebateFlow, commit d912ef2/v2) means the tab is open but the
 *  user paused delivery from their own status chip — deliberate, so
 *  the toast should say that rather than the generic "isn't open".
 *  `paused` only holds for 5 minutes after the pause (the same
 *  staleness window as ordinary idle presence); past that it degrades
 *  back to plain `present: false` with no `paused` field, same as a
 *  closed tab — that's intentional on PolicyDebateFlow's side, not a
 *  gap to work around here. */
async function readPresence(
  token: string,
): Promise<
  { ok: true; presence: PfPresence } | { ok: false; reason: 'not-open' | 'paused' | 'expired' | 'error' }
> {
  const res = await fetch(`${PF_FUNCTIONS_BASE}/pf-presence`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return { ok: false, reason: 'expired' };
  if (!res.ok) return { ok: false, reason: 'error' };
  const body: { present: boolean; paused?: boolean } & Partial<PfPresence> = await res.json();
  if (!body.present) return { ok: false, reason: body.paused ? 'paused' : 'not-open' };
  return { ok: true, presence: body as PfPresence };
}

/** POST pf-send-card — fire-and-forget from CardMirror's side (no
 *  apply-ack expected; the flow tab inserts + advances its own focus
 *  once the broadcast lands, matching the agreed no-ordering-guarantee
 *  design). Row/col/sheetId are passed straight through from the
 *  presence read that just confirmed them live, saving the function
 *  an extra DB round-trip. */
async function sendCard(
  token: string,
  payload: TaglinePayload,
  presence: PfPresence,
): Promise<{ ok: true } | { ok: false; reason: 'expired' | 'error'; message?: string }> {
  const res = await fetch(`${PF_FUNCTIONS_BASE}/pf-send-card`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taglineText: payload.taglineText,
      authorDate: payload.authorDate,
      sheetId: presence.sheetId,
      targetRow: presence.focusedRow,
      targetCol: presence.focusedCol,
    }),
  });
  if (res.status === 401) return { ok: false, reason: 'expired' };
  if (!res.ok) {
    const message = await res.text().catch(() => '');
    return { ok: false, reason: 'error', message: message || `HTTP ${res.status}` };
  }
  return { ok: true };
}

async function callPolicyDebateFlow(token: string, payload: TaglinePayload): Promise<FlowSendResult> {
  let presenceResult: Awaited<ReturnType<typeof readPresence>>;
  try {
    presenceResult = await readPresence(token);
  } catch {
    return { ok: false, reason: 'error', message: 'Network error reaching PolicyDebateFlow' };
  }
  if (!presenceResult.ok) {
    if (presenceResult.reason === 'expired') return { ok: false, reason: 'expired' };
    if (presenceResult.reason === 'not-open') return { ok: false, reason: 'not-open' };
    if (presenceResult.reason === 'paused') return { ok: false, reason: 'paused' };
    return { ok: false, reason: 'error', message: 'Could not reach PolicyDebateFlow' };
  }
  const { presence } = presenceResult;

  let sendResult: Awaited<ReturnType<typeof sendCard>>;
  try {
    sendResult = await sendCard(token, payload, presence);
  } catch {
    return { ok: false, reason: 'error', message: 'Network error reaching PolicyDebateFlow' };
  }
  if (!sendResult.ok) {
    if (sendResult.reason === 'expired') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'error', message: sendResult.message ?? 'Send failed' };
  }
  return { ok: true, flowName: presence.flowName, sheetName: presence.sheetName };
}

/** Does the actual work for `sendToFlowAtCursor`, as an awaitable
 *  Promise — split out from the void-returning ribbon command below
 *  purely so tests can await a deterministic result instead of racing
 *  a fire-and-forget `.then()`. Never throws; every path resolves via
 *  a toast. */
export async function sendTaglineToFlowAsync(view: EditorView): Promise<void> {
  if (!settings.get('policyDebateFlowEnabled') || !settings.get('policyDebateFlowToken')) {
    showToast('Connect PolicyDebateFlow in Settings first');
    return;
  }
  const payload = extractTaglinePayload(view);
  if (!payload) {
    showToast('No tagline (with a cite) here to send');
    return;
  }
  const token = settings.get('policyDebateFlowToken');
  const result = await callPolicyDebateFlow(token, payload);
  if (result.ok) {
    showToast(`Sent to ${result.sheetName} – ${result.flowName}`);
  } else if (result.reason === 'not-open') {
    showToast("PolicyDebateFlow isn't open");
  } else if (result.reason === 'paused') {
    showToast('PolicyDebateFlow is paused');
  } else if (result.reason === 'expired') {
    showToast('PolicyDebateFlow connection expired — re-pair in Settings');
  } else {
    showToast(`Send to PolicyDebateFlow failed: ${result.message}`);
  }
}

/** `sendToFlowAtCursor` ribbon command's implementation. Fire-and-forget
 *  wrapper around `sendTaglineToFlowAsync` — the ribbon dispatch table
 *  needs a synchronous `() => void`. */
export function sendTaglineToFlowAtCursor(view: EditorView): void {
  void sendTaglineToFlowAsync(view);
}
