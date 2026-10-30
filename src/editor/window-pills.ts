/**
 * The little labels that say which window is which, in every dialog that
 * lists windows: the "which window?" chooser (drawn by the desktop shell,
 * which keeps a copy of this vocabulary in multipane-chooser.ts, plus a
 * "Last viewed" pill that only the chooser has; a test holds the shared
 * words in step), the pane-drag tray, Select Speech Document and the
 * Switch Window palette. "Last viewed" is not here: in these dialogs the
 * window you are in is the one you viewed last, so no other window can be.
 *
 *   This window          the window you asked from
 *   Speech doc           the window (or, in Select Speech Document, the
 *                        document) that receives speech sends
 *   Minimized            the window is minimized
 *   Comparing documents  the window is busy with Compare documents and
 *                        cannot take a document
 */

export type WindowPillKind = 'thisWindow' | 'speech' | 'minimized' | 'comparing';

export const WINDOW_PILL_TEXT: Record<WindowPillKind, string> = {
  thisWindow: 'This window',
  speech: 'Speech doc',
  minimized: 'Minimized',
  comparing: 'Comparing documents',
};

export const WINDOW_PILL_HINT: Record<WindowPillKind, string> = {
  thisWindow: 'The window you asked from',
  speech: 'This window holds the speech doc',
  minimized: 'This window is minimized',
  comparing: 'Busy with Compare documents, so it cannot take a document',
};

export interface WindowPillFlags {
  thisWindow?: boolean;
  speech?: boolean;
  minimized?: boolean;
  comparing?: boolean;
}

/** Pills for a window, in the order they are drawn. */
export function windowPillKinds(f: WindowPillFlags): WindowPillKind[] {
  const out: WindowPillKind[] = [];
  if (f.thisWindow) out.push('thisWindow');
  if (f.speech) out.push('speech');
  if (f.minimized) out.push('minimized');
  if (f.comparing) out.push('comparing');
  return out;
}

/** A row of pills, or null when there are none. */
export function renderWindowPills(kinds: readonly WindowPillKind[]): HTMLSpanElement | null {
  if (kinds.length === 0) return null;
  const wrap = document.createElement('span');
  wrap.className = 'pmd-win-pills';
  for (const k of kinds) {
    const pill = document.createElement('span');
    pill.className = `pmd-win-pill pmd-win-pill-${k}`;
    pill.textContent = WINDOW_PILL_TEXT[k];
    pill.title = WINDOW_PILL_HINT[k];
    wrap.appendChild(pill);
  }
  return wrap;
}
