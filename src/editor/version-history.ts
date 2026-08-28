/**
 * Version history — the renderer half of the "Keep version history"
 * setting.
 *
 * On every save trigger (manual and autosave), the serialized bytes —
 * `.cmir` or `.docx`, whichever format the doc is in — are offered to
 * the main-process snapshot store
 * (apps/desktop/src/doc-history.ts) BEFORE the document's own disk
 * write is awaited — deliberately, so a save whose destination folder
 * is wedged (the field case: a cloud-sync placeholder hanging the
 * write) still leaves a recoverable version in app data. The store
 * dedups identical content by hash; this module adds the tier policy
 * and a per-doc minimum interval so bursts of autosaves don't grind
 * the store.
 *
 * Relationship to the crash journals: the journal is the always-on,
 * seconds-fresh, single overwritten copy whose deletion means "nothing
 * to recover"; this is the opt-out, capped, browsable trail behind it.
 * Never a replacement — see the journals' module docs.
 *
 * The solo branch of Recover Previous Version lives here too: a
 * version list for the focused doc's snapshots, mirroring the session
 * history dialog's chrome, each version opening as a new unsaved doc.
 */

import { getElectronHost } from './host/index.js';
import { isTopOverlay, popOverlay, pushOverlay } from './overlay-stack.js';
import { settings } from './settings.js';
import { showToast } from './toast.js';

export type VersionHistoryTier = 'off' | 'standard' | 'extended' | 'custom';

interface TierPolicy {
  minIntervalMs: number;
  retentionDays: number;
  maxDocBytes: number;
  maxTotalBytes: number;
}

/** The tiers the setting exposes. Standard is the capped default the
 *  settings copy describes; Extended is the opt-in "more history, more
 *  disk" mode whose description carries the disk warning. */
const TIER_POLICIES: Record<'standard' | 'extended', TierPolicy> = {
  standard: {
    minIntervalMs: 5 * 60 * 1000,
    retentionDays: 30,
    maxDocBytes: 50 * 1024 * 1024,
    maxTotalBytes: 500 * 1024 * 1024,
  },
  extended: {
    minIntervalMs: 2 * 60 * 1000,
    retentionDays: 90,
    maxDocBytes: 200 * 1024 * 1024,
    maxTotalBytes: 2 * 1024 * 1024 * 1024,
  },
};

/** Last snapshot ATTEMPT per doc (session-scoped). Attempt, not
 *  success: an unchanged-content skip still resets the clock — the
 *  content will still be unchanged in a minute. */
const lastAttemptAt = new Map<string, number>();

/**
 * Offer one save's bytes to the snapshot store. Fire-and-forget by
 * design: never awaited by a save path, never surfaces errors (a
 * failed snapshot must not scare anyone out of a successful save —
 * the journal still guards the crash case).
 */
/** The active tier's effective policy, or null when history is off.
 *  Custom takes Extended's cadence and retention and the user's own
 *  byte caps (the caps are the knob people actually asked for; a
 *  custom retention would multiply the matrix for little gain). */
export function currentHistoryPolicy(): TierPolicy | null {
  const tier = settings.get('versionHistory');
  if (tier === 'off') return null;
  if (tier === 'custom') {
    // 0 = uncapped. A huge FINITE stand-in rather than Infinity: the
    // policy crosses IPC and main validates Number.isFinite on it.
    const mb = (v: number): number =>
      v === 0 ? Number.MAX_SAFE_INTEGER : v * 1024 * 1024;
    return {
      minIntervalMs: TIER_POLICIES.extended.minIntervalMs,
      retentionDays: TIER_POLICIES.extended.retentionDays,
      maxDocBytes: mb(settings.get('versionHistoryDocCapMb')),
      maxTotalBytes: mb(settings.get('versionHistoryTotalCapMb')),
    };
  }
  return TIER_POLICIES[tier];
}

export function maybeSnapshotVersion(docId: string | null | undefined, bytes: Uint8Array): void {
  if (!docId) return; // never-saved drafts are the journal's job
  const host = getElectronHost();
  if (!host) return; // web: no app-data store
  const policy = currentHistoryPolicy();
  if (!policy) return;
  const now = Date.now();
  const last = lastAttemptAt.get(docId) ?? 0;
  if (now - last < policy.minIntervalMs) return;
  lastAttemptAt.set(docId, now);
  void host
    .historySnapshot(docId, bytes, {
      retentionDays: policy.retentionDays,
      maxDocBytes: policy.maxDocBytes,
      maxTotalBytes: policy.maxTotalBytes,
    })
    .catch(() => {});
}

// ─── Solo version list (Recover Previous Version branch) ───────────

/** Matches collab-recover-ui's OpenRecoveredDoc — supplied by index.ts. */
type OpenRecoveredDoc = (name: string, bytes: Uint8Array) => Promise<void>;

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Snapshots exist for this doc? (Cheap gate for the recover flow.) */
export async function hasVersionSnapshots(docId: string | null | undefined): Promise<boolean> {
  if (!docId) return false;
  const host = getElectronHost();
  if (!host) return false;
  return (await host.historyList(docId)).length > 0;
}

/**
 * The solo-doc version dialog: the focused doc's snapshots, newest
 * first, each opening as a NEW unsaved document — the original file is
 * never touched, same contract as session recovery.
 */
export async function openVersionSnapshotDialog(
  docId: string,
  docTitle: string,
  openDoc?: OpenRecoveredDoc,
): Promise<boolean> {
  const host = getElectronHost();
  if (!host) return false;
  const entries = await host.historyList(docId);
  if (entries.length === 0) return false;

  const overlay = document.createElement('div');
  overlay.className = 'pmd-bulk-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'pmd-bulk-dialog pmd-recover-dialog';
  overlay.appendChild(dialog);

  const token = pushOverlay();
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    popOverlay(token);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && isTopOverlay(token)) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const header = document.createElement('header');
  header.className = 'pmd-bulk-header';
  const h = document.createElement('h2');
  h.textContent = 'Recover Previous Version';
  header.appendChild(h);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'pmd-bulk-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', close);
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pmd-bulk-body pmd-recover-body';
  const blurb = document.createElement('p');
  blurb.className = 'pmd-bulk-blurb';
  blurb.textContent =
    `“${docTitle}” — ${entries.length} saved version${entries.length === 1 ? '' : 's'}. ` +
    `Opening a version makes a separate unsaved copy; the current document is not changed.`;
  body.appendChild(blurb);

  const list = document.createElement('div');
  list.className = 'pmd-recover-list';
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'pmd-recover-row';
    const label = document.createElement('span');
    label.className = 'pmd-recover-row-peer';
    label.textContent = `${fmtTime(entry.ts)} · ${fmtSize(entry.size)}`;
    row.appendChild(label);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'pmd-bulk-btn';
    open.textContent = 'Open a copy';
    open.addEventListener('click', () => {
      void (async () => {
        open.disabled = true;
        const bytes = await host.historyRead(docId, entry.id);
        if (!bytes) {
          showToast('That version is no longer available.');
          open.disabled = false;
          return;
        }
        close();
        await openDoc?.(`${docTitle} (${fmtTime(entry.ts)})`, bytes);
      })();
    });
    row.appendChild(open);
    list.appendChild(row);
  }
  body.appendChild(list);
  dialog.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'pmd-bulk-actions';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'pmd-bulk-btn pmd-bulk-btn-primary';
  done.textContent = 'Close';
  done.addEventListener('click', close);
  actions.append(done);
  dialog.appendChild(actions);

  document.body.appendChild(overlay);
  done.focus();
  return true;
}
