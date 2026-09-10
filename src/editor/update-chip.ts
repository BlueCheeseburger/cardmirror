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

export type UpdateChipState =
  | { state: 'downloading'; version: string; pct: number }
  | { state: 'available'; version: string }
  | { state: 'ready'; version: string };

export interface UpdateChipHost {
  getUpdateChipState(): Promise<UpdateChipState | null>;
  updateChipAction(): Promise<void>;
  onUpdateChip(handler: (payload: UpdateChipState | null) => void): () => void;
}

/** Render one chip state into the button. Exported for tests. */
export function renderUpdateChip(el: HTMLButtonElement, s: UpdateChipState | null): void {
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
  el.addEventListener('click', () => {
    void host.updateChipAction().catch((err) => {
      console.warn('Update chip action failed:', err);
    });
  });
  const unsubscribe = host.onUpdateChip((s) => renderUpdateChip(el, s));
  void host
    .getUpdateChipState()
    .then((s) => renderUpdateChip(el, s))
    .catch(() => {});
  return unsubscribe;
}
