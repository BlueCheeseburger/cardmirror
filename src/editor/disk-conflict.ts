/**
 * Disk-conflict state + the cloud badge (design brief 2026-09-06).
 *
 * Per open document (keyed by its on-disk handle) this tracks whether
 * the file lives in a cloud-synced folder and whether main's stat-only
 * poller has seen it change under the editor. One pill per window
 * shows the ACTIVE document's state, in its own tray at the editor's
 * bottom-right corner (the mirror of the Send / Receive / Dropzone
 * tray at the bottom-left, same pill styling):
 *
 *   local      — not rendered (no cloud provider);
 *   synced     — cloud glyph + the provider's name, "as of last sync"
 *                (we know the local disk, not the cloud); click reveals
 *                the file;
 *   changed    — amber + relative time; click opens the decision
 *                dialog (Reload / Keep mine as a copy / Overwrite);
 *   kept-copy  — the window is editing a conflicted copy; click
 *                offers the original.
 *
 * Nothing here ever toasts, steals focus, or animates on a state
 * transition — a conflict must never interrupt a speech. A keep-both
 * save announces itself only through the pill's "Conflicted copy"
 * state (design call 2026-09-06: no chip / toast on top of it). While read
 * mode or the timer pop-out is active the badge is frozen at its last
 * rendering and catches up when both clear. `changed` is cleared only
 * by a Reload or by an in-place save that main accepted (which means
 * the disk was byte-identical after all); a keep-both save moves the
 * window to the copy, whose state starts as `kept-copy`.
 */
import { promptForRouteChoice } from './text-prompt.js';
import { settings } from './settings.js';
import type { CloudProvider } from './host/types.js';

export type DiskBadgeState = 'local' | 'synced' | 'changed' | 'kept-copy';
export type ClaimResult = 'fresh' | 'journaled' | 'changed' | 'unknown';

export interface DocDiskInfo {
  provider: CloudProvider | null;
  state: DiskBadgeState;
  /** When the poller (or registration) first saw the file differ. */
  changedAt: number | null;
  /** For `kept-copy`: the original file's path. */
  copyOf: string | null;
}

const byHandle = new Map<string, DocDiskInfo>();

const PROVIDER_LABEL: Record<CloudProvider, string> = {
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  gdrive: 'Google Drive',
  icloud: 'iCloud Drive',
  other: 'a synced folder',
};

export function diskInfoFor(handle: unknown): DocDiskInfo | null {
  return typeof handle === 'string' ? (byHandle.get(handle) ?? null) : null;
}

/** A window registered `handle` as its open document. `claim` says how
 *  the changed-on-disk baseline was obtained (see doc-writes.ts):
 *  `changed` means the file already differs from the journaled baseline
 *  a recovered doc carried, so the badge starts amber. A `kept-copy`
 *  marked just before registration (the keep-both save) is preserved. */
export function noteDocRegistered(handle: string, claim: ClaimResult, provider: CloudProvider | null): void {
  const prev = byHandle.get(handle);
  if (prev?.state === 'kept-copy') {
    byHandle.set(handle, { ...prev, provider });
  } else {
    byHandle.set(handle, {
      provider,
      state: claim === 'changed' ? 'changed' : provider ? 'synced' : 'local',
      changedAt: claim === 'changed' ? Date.now() : null,
      copyOf: null,
    });
  }
  notifyDiskStateChanged();
}

/** Main's poller saw the file change on disk (stat-only: a sync
 *  client's timestamp touch shows up too; the save corrects it). */
export function noteDiskChanged(handle: string, at: number = Date.now()): void {
  const prev = byHandle.get(handle);
  if (!prev || prev.state === 'changed') return;
  byHandle.set(handle, { ...prev, state: 'changed', changedAt: at });
  notifyDiskStateChanged();
}

/** An in-place save main ACCEPTED: the disk matched the baseline (or
 *  was byte-identical), so a standing `changed` was a false alarm. */
export function noteSavedInPlace(handle: string): void {
  const prev = byHandle.get(handle);
  if (!prev || prev.state !== 'changed') return;
  byHandle.set(handle, { ...prev, state: prev.provider ? 'synced' : 'local', changedAt: null });
  notifyDiskStateChanged();
}

/** The window switched to a conflicted copy of `originalHandle`. */
export function noteKeptCopy(copyHandle: string, originalHandle: string): void {
  const orig = byHandle.get(originalHandle);
  byHandle.set(copyHandle, {
    provider: orig?.provider ?? null,
    state: 'kept-copy',
    changedAt: null,
    copyOf: originalHandle,
  });
  notifyDiskStateChanged();
}

/** Reload from disk replaced the in-memory doc with the file. */
export function noteReloaded(handle: string): void {
  const prev = byHandle.get(handle);
  if (!prev) return;
  byHandle.set(handle, { ...prev, state: prev.provider ? 'synced' : 'local', changedAt: null, copyOf: null });
  notifyDiskStateChanged();
}

export function noteDocReleased(handle: string): void {
  byHandle.delete(handle);
  notifyDiskStateChanged();
}

/** Per-pane badges (see `createPaneDiskBadge` below) subscribe here so
 *  every note* mutation refreshes them too, not just the single-doc
 *  window tray's default badge. */
const paneRefreshListeners = new Set<() => void>();

function notifyDiskStateChanged(): void {
  refreshDiskBadge();
  for (const l of paneRefreshListeners) l();
}

/** The name used in a conflicted copy's filename: the co-editing display
 *  name if set, else the comment author name (the default "You" does not
 *  count), else null — main falls back to the computer account username.
 *  Never anything from the Debate Decoded account. */
export function conflictedCopyUserName(): string | null {
  const pairing = settings.get('pairingDisplayName').trim();
  if (pairing) return pairing;
  const author = settings.get('commentAuthor').trim();
  if (author && author.toLowerCase() !== 'you') return author;
  return null;
}

export function relativeTime(ms: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ── Pill ────────────────────────────────────────────────────────────
// One per window, in its own fixed tray at the editor's bottom-RIGHT
// corner — the mirror of the Send / Receive / Dropzone tray at the
// bottom-left, and styled as the same family of pills (design call
// 2026-09-06). Shows the ACTIVE document's state.

export interface DiskBadgeDeps {
  /** The active document's handle + display name (either layout). */
  getActive: () => { handle: string | null; name: string | null };
  /** Read mode or the timer pop-out is active: freeze the pill. */
  isSuppressed: () => boolean;
  /** The active document has unsaved edits — "Keep their changes" says
   *  it will discard them (no separate confirmation). */
  isDirty?: () => boolean;
  /** The active document hosts a live co-editing session — Reload is
   *  withheld (it would replace the shared document under everyone). */
  isSessionHost: (handle: string) => boolean;
  reveal: (handle: string) => void;
  /** Replaces the doc from disk, discarding unsaved edits (no prompt). */
  reloadFromDisk: (handle: string) => Promise<void>;
  keepMineAsCopy: (handle: string) => Promise<void>;
  /** Force-writes the disk (no second confirmation — design call). */
  overwrite: (handle: string) => Promise<void>;
  openOriginal: (originalHandle: string) => Promise<void>;
}

let trayEl: HTMLElement | null = null;
let badgeEl: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;
let barEl: HTMLElement | null = null;
let badgeDeps: DiskBadgeDeps | null = null;
let clockTimer: number | null = null;

/** Cloud outline, drawn like the Send pill's paper plane (stroke icon). */
const CLOUD_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M7 18.5h11a4 4 0 0 0 .6-7.95A6.5 6.5 0 0 0 6.2 9.3 4.6 4.6 0 0 0 7 18.5z"/></svg>';

/** Compact, brand-colored provider marks for the per-pane badge (see
 *  `createPaneDiskBadge`) — small enough to sit in a pane footer next
 *  to the word-count/copresence/save controls, and identifiable at a
 *  glance without a text label. Simplified, not pixel-accurate
 *  reproductions of each company's logo. `other` reuses the generic
 *  stroke cloud above. */
const PROVIDER_ICON: Record<CloudProvider, string> = {
  dropbox:
    '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="#0061FF" d="M6 3 12 7 6 11 0 7 6 3Zm12 0 6 4-6 4-6-4 6-4ZM0 15l6-4 6 4-6 4-6-4Zm18-4 6 4-6 4-6-4 6-4ZM6 20l6-4 6 4-6 4-6-4Z"/></svg>',
  onedrive:
    '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="#0A63C9" d="M9.5 18a4.75 4.75 0 0 1-.62-9.46 6 6 0 0 1 11.52 2.36A4.25 4.25 0 0 1 19.75 18H9.5Z"/></svg>',
  gdrive:
    '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="#00AC47" d="M8.05 2 2 12.2 5.4 18 11.5 7.8 8.05 2Z"/>' +
    '<path fill="#EA4335" d="M15.95 2H8.05L11.5 7.8h7.9L15.95 2Z"/>' +
    '<path fill="#FFBA00" d="M22 12.2 15.95 2 12.5 7.8 18.6 18 22 12.2Z"/>' +
    '<path fill="#4285F4" d="M5.4 18 8.2 22.7h7.6L18.6 18H5.4Z"/></svg>',
  icloud:
    '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="#3693F3" d="M9.5 18a4.75 4.75 0 0 1-.62-9.46 6 6 0 0 1 11.52 2.36A4.25 4.25 0 0 1 19.75 18H9.5Z"/></svg>',
  other: CLOUD_SVG,
};

/** Create the tray + pill once (in `opts.parent`, default the body). */
export function installDiskBadge(deps: DiskBadgeDeps, opts?: { parent?: HTMLElement }): void {
  badgeDeps = deps;
  if (badgeEl) return;
  const parent = opts?.parent ?? document.body;
  trayEl = document.createElement('div');
  trayEl.className = 'pmd-pill-tray-right';
  const root = document.createElement('div');
  root.className = 'pmd-pill pmd-disk-pill pmd-disk-badge';
  root.hidden = true;
  const bar = document.createElement('div');
  bar.className = 'pmd-pill-bar pmd-disk-bar';
  bar.setAttribute('role', 'button');
  bar.tabIndex = 0;
  const icon = document.createElement('span');
  icon.className = 'pmd-pill-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = CLOUD_SVG;
  bar.appendChild(icon);
  const label = document.createElement('span');
  label.className = 'pmd-pill-label';
  bar.appendChild(label);
  root.appendChild(bar);
  bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's focus
  bar.addEventListener('click', () => void onBadgeClick());
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void onBadgeClick();
    }
  });
  trayEl.appendChild(root);
  parent.appendChild(trayEl);
  badgeEl = root;
  barEl = bar;
  labelEl = label;
  refreshDiskBadge();
}

function render(): void {
  if (!badgeEl || !barEl || !labelEl || !badgeDeps) return;
  const { handle, name } = badgeDeps.getActive();
  const info = handle ? byHandle.get(handle) : null;
  if (!info || info.state === 'local') {
    badgeEl.hidden = true;
    badgeEl.removeAttribute('data-state');
    document.documentElement.classList.remove('pmd-disk-pill-active');
    stopClock();
    return;
  }
  const provider = info.provider ? PROVIDER_LABEL[info.provider] : 'a synced folder';
  badgeEl.hidden = false;
  badgeEl.setAttribute('data-state', info.state);
  document.documentElement.classList.add('pmd-disk-pill-active');
  let label = '';
  let title = '';
  if (info.state === 'synced') {
    label = info.provider ? PROVIDER_LABEL[info.provider] : 'Synced';
    title = `In ${provider} · as of last sync. Click to reveal the file.`;
  } else if (info.state === 'changed') {
    const when = info.changedAt ? relativeTime(info.changedAt) : '';
    label = when ? `Changed on disk ${when}` : 'Changed on disk';
    title = `"${name ?? 'This document'}" changed on disk ${when} — another device or program wrote it. Click to decide.`;
  } else {
    label = 'Conflicted copy';
    title = `You are editing a conflicted copy of "${info.copyOf ? baseName(info.copyOf) : name ?? 'the original'}". Click for the original.`;
  }
  labelEl.textContent = label;
  badgeEl.title = title;
  barEl.title = title;
  barEl.setAttribute('aria-label', title);
  if (info.state === 'changed') startClock();
  else stopClock();
}

/** Re-render for the active document — unless suppressed (read mode /
 *  timer pop-out), in which case the pill keeps its last rendering
 *  and catches up on the next refresh after the suppression clears. */
export function refreshDiskBadge(): void {
  if (!badgeEl || !badgeDeps) return;
  if (badgeDeps.isSuppressed()) return;
  render();
}

function startClock(): void {
  if (clockTimer !== null) return;
  clockTimer = window.setInterval(() => refreshDiskBadge(), 30_000);
}
function stopClock(): void {
  if (clockTimer === null) return;
  window.clearInterval(clockTimer);
  clockTimer = null;
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Shared "what should clicking the badge do" logic — the three-way
 *  disk-conflict decision, and the synced/kept-copy reveal shortcuts.
 *  Used by both the single-doc window's tray badge and each pane's
 *  compact badge in multi-pane mode. */
async function resolveBadgeClick(
  handle: string,
  name: string | null,
  info: DocDiskInfo,
  deps: Pick<
    DiskBadgeDeps,
    'isSessionHost' | 'isDirty' | 'reveal' | 'reloadFromDisk' | 'keepMineAsCopy' | 'overwrite' | 'openOriginal'
  >,
): Promise<void> {
  if (info.state === 'synced') {
    deps.reveal(handle);
    return;
  }
  if (info.state === 'kept-copy') {
    const choice = await promptForRouteChoice<'original' | 'reveal'>({
      message: `You are editing a conflicted copy of "${info.copyOf ? baseName(info.copyOf) : name ?? 'the original'}".`,
      choices: [
        { value: 'original', label: 'Open the original', description: 'In another window, alongside this copy.' },
        { value: 'reveal', label: 'Reveal in folder', description: 'Show both files in Finder / Explorer.' },
      ],
      cancelLabel: 'Close',
    });
    if (choice === 'original' && info.copyOf) await deps.openOriginal(info.copyOf);
    else if (choice === 'reveal') deps.reveal(handle);
    return;
  }
  // changed — three ways out, no secondary confirmations (design call
  // 2026-09-06): keep theirs (reload), keep mine (overwrite), keep both.
  const host = deps.isSessionHost(handle);
  const dirty = deps.isDirty?.() ?? false;
  const choices: Array<{ value: 'theirs' | 'mine' | 'both'; label: string; description: string }> = [];
  if (!host) {
    choices.push({
      value: 'theirs',
      label: 'Keep their changes',
      description: `Load their changes from disk. ${dirty ? 'Discards your unsaved changes.' : 'You have no unsaved changes.'}`,
    });
  }
  choices.push({
    value: 'mine',
    label: 'Keep my changes',
    description: 'Overwrite their changes with your version.',
  });
  choices.push({
    value: 'both',
    label: 'Keep both',
    description: 'Saves a conflicted copy in the same folder.',
  });
  const choice = await promptForRouteChoice<'theirs' | 'mine' | 'both'>({
    message:
      `"${name ?? 'This document'}" was changed by another device or program while you were editing it` +
      `${info.provider ? ` (it is in ${PROVIDER_LABEL[info.provider]})` : ''}.`,
    ...(host
      ? { detail: 'Keeping their changes is unavailable while you host a co-editing session — end the session first.' }
      : {}),
    choices,
  });
  if (choice === 'theirs') await deps.reloadFromDisk(handle);
  else if (choice === 'mine') await deps.overwrite(handle);
  else if (choice === 'both') await deps.keepMineAsCopy(handle);
}

async function onBadgeClick(): Promise<void> {
  if (!badgeDeps) return;
  const { handle, name } = badgeDeps.getActive();
  if (!handle) return;
  const info = byHandle.get(handle);
  if (!info) return;
  await resolveBadgeClick(handle, name, info, badgeDeps);
}

/** Test seam. */
export function __resetDiskConflictForTests(): void {
  byHandle.clear();
  stopClock();
  trayEl?.remove();
  trayEl = null;
  badgeEl = null;
  barEl = null;
  labelEl = null;
  badgeDeps = null;
  document.documentElement.classList.remove('pmd-disk-pill-active');
  paneRefreshListeners.clear();
}

// ── Per-pane badge (multi-pane mode) ──────────────────────────────
// One compact, icon-first pill per pane, appended into that pane's own
// `.pmd-pane-footer` — unlike the single-doc window's fixed bottom-
// right tray above, so it's unambiguous which pane's disk state each
// pill reflects. Shows the provider's own mark instead of a generic
// cloud + "Cloud" label (space is tighter with N of these on screen at
// once), and drops the label text entirely for the resting `synced`
// state; `changed`/`kept-copy` keep a short text cue since those need
// to say more than "which provider."

export interface PaneDiskBadgeHandle {
  el: HTMLElement;
  /** Re-render from current state (also called automatically on every
   *  note* mutation while installed). */
  refresh: () => void;
  /** Unsubscribe and remove the element — call when the pane closes. */
  destroy: () => void;
}

/** Mount a compact per-pane disk badge into `parent` (append at the
 *  end — callers appending after the word-count span, which is
 *  `flex: 1 1 auto` and pushes everything after it to the row's right
 *  edge, get the same right-aligned placement the footer's other
 *  controls already use). Hidden (zero footprint) for a local file,
 *  same as the single-doc tray badge. */
export function createPaneDiskBadge(deps: DiskBadgeDeps, parent: HTMLElement): PaneDiskBadgeHandle {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'pmd-pane-disk-badge';
  root.hidden = true;
  const icon = document.createElement('span');
  icon.className = 'pmd-pane-disk-badge-icon';
  icon.setAttribute('aria-hidden', 'true');
  root.appendChild(icon);
  const label = document.createElement('span');
  label.className = 'pmd-pane-disk-badge-label';
  root.appendChild(label);
  parent.appendChild(root);

  let clockTimer: number | null = null;
  function startClock(): void {
    if (clockTimer !== null) return;
    clockTimer = window.setInterval(render, 30_000);
  }
  function stopClock(): void {
    if (clockTimer === null) return;
    window.clearInterval(clockTimer);
    clockTimer = null;
  }

  function render(): void {
    if (deps.isSuppressed()) return;
    const { handle, name } = deps.getActive();
    const info = handle ? byHandle.get(handle) : null;
    if (!info || info.state === 'local') {
      root.hidden = true;
      root.removeAttribute('data-state');
      stopClock();
      return;
    }
    root.hidden = false;
    root.setAttribute('data-state', info.state);
    icon.innerHTML = info.provider ? PROVIDER_ICON[info.provider] : CLOUD_SVG;
    const provider = info.provider ? PROVIDER_LABEL[info.provider] : 'a synced folder';
    let text = '';
    let title = '';
    if (info.state === 'synced') {
      title = `In ${provider} · as of last sync. Click to reveal the file.`;
    } else if (info.state === 'changed') {
      const when = info.changedAt ? relativeTime(info.changedAt) : '';
      text = when;
      title = `"${name ?? 'This document'}" changed on disk ${when} — another device or program wrote it. Click to decide.`;
    } else {
      text = 'Copy';
      title = `You are editing a conflicted copy of "${info.copyOf ? baseName(info.copyOf) : name ?? 'the original'}". Click for the original.`;
    }
    label.textContent = text;
    root.title = title;
    root.setAttribute('aria-label', title);
    if (info.state === 'changed') startClock();
    else stopClock();
  }

  root.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's focus
  root.addEventListener('click', () => void onClick());

  async function onClick(): Promise<void> {
    const { handle, name } = deps.getActive();
    if (!handle) return;
    const info = byHandle.get(handle);
    if (!info) return;
    await resolveBadgeClick(handle, name, info, deps);
  }

  paneRefreshListeners.add(render);
  render();

  return {
    el: root,
    refresh: render,
    destroy: () => {
      paneRefreshListeners.delete(render);
      stopClock();
      root.remove();
    },
  };
}
