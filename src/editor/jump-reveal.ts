/**
 * What a plugin jump (a click in a flow app) has to undo so the pane holding
 * the target document is actually on screen, and the toast that says so.
 *
 * A jump scrolls inside the target's pane, so a pane hidden with Hide Slot, or
 * covered by another pane that is expanded, would scroll out of sight while
 * CardMirror came to the front. The shell reveals the pane first (see
 * `MultiPaneShell.findViewForDocId`) and tells the user what it changed.
 */

export type JumpReveal = 'none' | 'unhide' | 'show-over-expanded';

/** `slotHidden`: the target's pane was hidden by the user. `otherExpanded`:
 *  a different pane is expanded, so only that one is on screen. */
export function jumpRevealNeeded(slotHidden: boolean, otherExpanded: boolean): JumpReveal {
  if (otherExpanded) return 'show-over-expanded';
  return slotHidden ? 'unhide' : 'none';
}

/** The toast for a reveal; empty for 'none'. */
export function jumpRevealToast(reveal: JumpReveal, filename: string | null | undefined): string {
  const name = filename ? `“${filename}”` : 'the document';
  if (reveal === 'unhide') return `Showed the hidden pane for ${name} to jump there.`;
  if (reveal === 'show-over-expanded') return `Switched the expanded pane to ${name} to jump there.`;
  return '';
}
