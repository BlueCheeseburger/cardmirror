/**
 * The little labels that say which window is which, in every dialog that
 * lists windows: the "which window?" chooser (drawn by the desktop shell,
 * which keeps a copy of this vocabulary in multipane-chooser.ts; a test
 * holds the two in step), the pane-drag tray, Select Speech Document and
 * the Switch Window palette.
 *
 *   This window          the window you asked from
 *   Last viewed          the window you were in just before this one
 *   Speech doc           the window (or, in Select Speech Document, the
 *                        document) that receives speech sends
 *   Minimized            the window is minimized
 *   Comparing documents  the window is busy with Compare documents and
 *                        cannot take a document
 */

export type WindowPillKind = 'thisWindow' | 'lastViewed' | 'speech' | 'minimized' | 'comparing';

export const WINDOW_PILL_TEXT: Record<WindowPillKind, string> = {
  thisWindow: 'This window',
  lastViewed: 'Last viewed',
  speech: 'Speech doc',
  minimized: 'Minimized',
  comparing: 'Comparing documents',
};

export const WINDOW_PILL_HINT: Record<WindowPillKind, string> = {
  thisWindow: 'The window you asked from',
  lastViewed: 'The window you were in just before this one',
  speech: 'This window holds the speech doc',
  minimized: 'This window is minimized',
  comparing: 'Busy with Compare documents, so it cannot take a document',
};

export interface WindowPillFlags {
  thisWindow?: boolean;
  lastViewed?: boolean;
  speech?: boolean;
  minimized?: boolean;
  comparing?: boolean;
}

/** Pills for a window, in the order they are drawn. */
export function windowPillKinds(f: WindowPillFlags): WindowPillKind[] {
  const out: WindowPillKind[] = [];
  if (f.thisWindow) out.push('thisWindow');
  if (f.lastViewed) out.push('lastViewed');
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
