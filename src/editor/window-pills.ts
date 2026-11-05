/**
 * The little labels that say which window is which, in every dialog that
 * lists windows: the "which window?" chooser (drawn by the desktop shell,
 * which keeps a copy of this vocabulary in multipane-chooser.ts, plus a
 * "Last viewed" pill that only the chooser has; a test holds the shared
 * words in step), the pane-drag tray, Select Speech Document and the
 * Switch Window palette. The speech doc itself is not a pill any more: its own
 * name is drawn in amber with the speech mic at its left (`renderDocNames`),
 * the same way the "which window?" chooser draws it. A window whose speech doc
 * name cannot be found among the names it shows keeps the "Speech doc" pill, so
 * it is never left unmarked. "Last viewed" is not here: in these dialogs the
 * window you are in is the one you viewed last, so no other window can be.
 *
 *   This window          the window you asked from
 *   Speech doc           the window (or, in Select Speech Document, the
 *                        document) that receives speech sends
 *   Minimized            the window is minimized
 *   Comparing documents  the window is busy with Compare documents and
 *                        cannot take a document
 */

import { setIcon } from './icons';

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

/** A document name drawn as the speech doc: the speech mic, then the name, in
 *  the speech amber. The same look as the "which window?" chooser. */
export function renderSpeechName(name: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'pmd-speech-name';
  el.title = 'This is the speech doc';
  const mic = document.createElement('span');
  mic.className = 'pmd-speech-name-mic';
  mic.setAttribute('aria-hidden', 'true');
  setIcon(mic, 'mic');
  el.append(mic, name);
  return el;
}

/** Names joined by " · " as one run of text, with the speech doc's own name
 *  (the first one equal to `speechDoc`) drawn by `renderSpeechName`. `marked`
 *  says whether a name was found, so the caller can leave the window's
 *  "Speech doc" pill off exactly when the name carries the marker. */
export function renderDocNames(
  names: readonly string[],
  speechDoc: string | null | undefined,
): { el: HTMLSpanElement; marked: boolean } {
  const el = document.createElement('span');
  let marked = false;
  names.forEach((n, i) => {
    if (i > 0) el.append(' · ');
    if (!marked && speechDoc != null && n === speechDoc) {
      marked = true;
      el.append(renderSpeechName(n));
    } else {
      el.append(n);
    }
  });
  return { el, marked };
}

/** Whether `speechDoc` is one of `names` (the test `renderDocNames` applies). */
export function namesSpeechDoc(names: readonly string[], speechDoc: string | null | undefined): boolean {
  return speechDoc != null && names.includes(speechDoc);
}
