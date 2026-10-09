/**
 * Status-bar update chip — install-on-confirm (adopted 2026-07-16,
 * modeled on ebb's update UX): auto-updates never dialog. The desktop
 * main process stages downloads silently and reports chip state; this
 * module renders the chip and forwards clicks. Three states:
 *
 *   'downloading' — the update is actively being fetched. Same pill,
 *                 but its background fills left-to-right as `pct`
 *                 climbs and the text names the percent. Not clickable
 *                 in any useful way (there's nothing to act on yet);
 *                 the click handler just no-ops until it advances.
 *   'ready'     — the update is downloaded and staged (Windows/Linux).
 *                 Click = restart now and install. Users who never
 *                 click still get it on next quit (install-on-quit
 *                 stays on as the fallback).
 *   'available' — detected but not stageable (macOS until the swap
 *                 updater lands). Click = open the release page.
 *
 * Pure DOM + host-interface module so the chip logic is testable
 * outside the index.ts app shell.
 */

import { showToast } from './toast.js';

export type UpdateChipState =
  | { state: 'downloading'; version: string; pct: number }
  | { state: 'available'; version: string }
  | { state: 'ready'; version: string }
  // Plugin updates (fork, 2026-09-25): found by the check that runs
  // with every app update check. Main shows these only when there's no
  // app update on the chip. Click → confirm and install them; once
  // installed, click → restart to load them.
  | { state: 'plugins'; plugins: { name: string; version: string }[] }
  | { state: 'plugins-updating'; count: number }
  | { state: 'plugins-ready'; count: number };

/** Chip states the user has dismissed with the × (keyed by state + version,
 *  so a newer state — e.g. "available" → "ready" — shows again). In memory
 *  only: the chip is back at the next launch. */
const dismissed = new Set<string>();
const stateKey = (s: UpdateChipState): string =>
  `${s.state}:${'version' in s ? s.version : 'count' in s ? s.count : s.plugins.map((p) => p.name + p.version).join(',')}`;

/** Chips to repaint when dismissals are cleared (the status bar's and the
 *  home screen's are separate instances sharing the one `dismissed` set). */
const revealListeners = new Set<() => void>();

/** Bring back every chip the user hid with the ×. Called by a MANUAL
 *  update check (Settings → Check for updates, Help → Check for Updates…):
 *  both tell the user to "watch for the status-bar chip", and without this
 *  a chip hidden earlier in the session stayed hidden for good, leaving no
 *  way to install the update short of restarting the app. */
export function revealDismissedUpdateChips(): void {
  dismissed.clear();
  for (const repaint of revealListeners) repaint();
}

export const DISMISS_NOTE =
  'Update hidden. To bring it back, click Check for updates in Settings → General → About this install (or Help → Check for Updates…).';

export interface UpdateChipHost {
  getUpdateChipState(): Promise<UpdateChipState | null>;
  updateChipAction(): Promise<void>;
  onUpdateChip(handler: (payload: UpdateChipState | null) => void): () => void;
  /** Main asking every window to un-hide the chip (a manual check from the
   *  Help menu). Optional: an older preload doesn't have it. */
  onUpdateChipReveal?(handler: () => void): () => void;
}

/** Render one chip state into the button. Exported for tests. */
export function renderUpdateChip(el: HTMLButtonElement, s: UpdateChipState | null): void {
  if (s && dismissed.has(stateKey(s))) s = null;
  renderChip(el, s);
  // A × that appears on hover (a dismiss target inside the pill; its glyph
  // is CSS-drawn so the chip's text stays just the message). Not while a
  // download is in flight.
  if (s && s.state !== 'downloading' && s.state !== 'plugins-updating') {
    const x = document.createElement('span');
    x.className = 'pmd-update-chip-x';
    x.setAttribute('role', 'button');
    x.setAttribute('aria-label', 'Hide this update notice');
    el.appendChild(x);
  }
}

function renderChip(el: HTMLButtonElement, s: UpdateChipState | null): void {
  if (!s) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (s.state === 'downloading') {
    const pct = Math.max(0, Math.min(100, Math.round(s.pct)));
    el.setAttribute('data-state', 'downloading');
    el.style.setProperty('--pmd-update-pct', `${pct}%`);
    // The percent is a separate, fixed-width span (`.pmd-update-chip-pct`,
    // sized in style.css to fit "100%") so the pill doesn't grow/shrink
    // as the digit count changes across the 0–100 climb — only this one
    // span's text changes per tick, the prefix stays put.
    const pctEl = document.createElement('span');
    pctEl.className = 'pmd-update-chip-pct';
    pctEl.textContent = `${pct}%`;
    el.replaceChildren(`Downloading update ${s.version} — `, pctEl);
    el.title = `Downloading update ${s.version}: ${pct}% complete`;
    return;
  }
  el.removeAttribute('data-state');
  el.style.removeProperty('--pmd-update-pct');
  if (s.state === 'plugins') {
    const [first] = s.plugins;
    el.textContent =
      s.plugins.length === 1 && first
        ? `Plugin update: ${first.name} ${first.version}`
        : `${s.plugins.length} plugin updates available`;
    el.title = `Update ${s.plugins.map((p) => `${p.name} to ${p.version}`).join(', ')}`;
    return;
  }
  if (s.state === 'plugins-updating') {
    el.textContent = s.count === 1 ? 'Updating plugin…' : 'Updating plugins…';
    el.title = 'Downloading the new plugin versions';
    return;
  }
  if (s.state === 'plugins-ready') {
    el.textContent = `${s.count === 1 ? 'Plugin' : 'Plugins'} updated — restart to apply`;
    el.title = 'Restart CardMirror to load the updated plugins';
    return;
  }
  if (s.state === 'ready') {
    el.textContent = `Update ${s.version} ready — restart to install`;
    el.title = 'Restart CardMirror now to finish installing the update';
  } else {
    el.textContent = `Update ${s.version} available`;
    el.title = 'Open the release page to download the update';
  }
}

/** Wire the chip: initial state pull (late-opened windows), live
 *  subscription, click → the main process picks the action. */
export function initUpdateChip(el: HTMLButtonElement, host: UpdateChipHost): () => void {
  let current: UpdateChipState | null = null;
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest('.pmd-update-chip-x')) {
      e.stopPropagation();
      if (current) dismissed.add(stateKey(current));
      renderUpdateChip(el, null);
      showToast(DISMISS_NOTE);
      return;
    }
    void host.updateChipAction().catch((err) => {
      console.warn('Update chip action failed:', err);
    });
  });
  const show = (s: UpdateChipState | null): void => {
    current = s;
    renderUpdateChip(el, s);
  };
  const unsubscribe = host.onUpdateChip(show);
  const repaint = (): void => renderUpdateChip(el, current);
  revealListeners.add(repaint);
  const unsubscribeReveal = host.onUpdateChipReveal?.(revealDismissedUpdateChips);
  void host
    .getUpdateChipState()
    .then(show)
    .catch(() => {});
  return () => {
    unsubscribe();
    unsubscribeReveal?.();
    revealListeners.delete(repaint);
  };
}
