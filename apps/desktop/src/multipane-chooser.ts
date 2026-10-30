/**
 * Button layout + response decoding for the "which window?" chooser
 * (main.ts's `pickMultiPaneTarget`).
 *
 * Split out from main.ts purely so it's testable: the dialog itself
 * needs a live Electron app, but the part that actually breaks is the
 * index arithmetic — which button is "New Window", which is "Cancel",
 * and what Esc maps to. Those differ between the two callers:
 *
 *   - OS-open (no Cancel): a file the OS handed us has to land
 *     somewhere, so Esc falls through to "New Window".
 *   - New Document (withCancel): dismissing should create nothing, so
 *     Esc maps to its own Cancel button.
 */

export interface ChooserPrompt {
  buttons: string[];
  cancelId: number;
}

export type ChooserResponse =
  | { kind: 'window'; index: number }
  | { kind: 'new-window' }
  | { kind: 'cancel' };

/** Buttons for `labels.length` candidate windows. `cancelId` is always
 *  the last button: "New Window" without a Cancel (Esc = new window),
 *  "Cancel" with one (Esc = cancel). */
export function buildChooserPrompt(
  labels: string[],
  opts: { withCancel?: boolean } = {},
): ChooserPrompt {
  const buttons = [...labels, 'New Window', ...(opts.withCancel ? ['Cancel'] : [])];
  return { buttons, cancelId: buttons.length - 1 };
}

/** Decode `dialog.showMessageBox`'s response index against the layout
 *  `buildChooserPrompt` produced for the same `labels` / `opts`.
 *  Anything out of range reads as "New Window" rather than throwing —
 *  a nonsense index should still leave the user with a usable window. */
export function readChooserResponse(
  response: number,
  labelCount: number,
  opts: { withCancel?: boolean } = {},
): ChooserResponse {
  if (Number.isInteger(response) && response >= 0 && response < labelCount) {
    return { kind: 'window', index: response };
  }
  if (opts.withCancel && response === labelCount + 1) return { kind: 'cancel' };
  return { kind: 'new-window' };
}

/** The little labels on a window's row. The renderer keeps its own copy of
 *  this vocabulary (`src/editor/window-pills.ts`); a test holds the two
 *  in step, because the chooser is a separate page that cannot import it. */
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

/** The window you were in just before this one: the first of `focusOrder`
 *  (window ids, most recently focused first) that is among `candidates`,
 *  leaving out `excludeId` (the window that is asking). Null when there is
 *  none. Windows main never saw focused rank last, so they never win. */
export function lastViewedWindowId(
  focusOrder: readonly number[],
  candidates: readonly number[],
  excludeId?: number,
): number | null {
  for (const id of focusOrder) {
    if (id !== excludeId && candidates.includes(id)) return id;
  }
  return null;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Windows in a stable, alphabetical order for the chooser, so a window
 *  keeps the same number key between openings (muscle memory). A label
 *  lists the window's docs joined by " · "; the docs are sorted within it
 *  too, so opening or reordering docs inside a window doesn't reshuffle
 *  the list. Ties break on the window id. */
export function sortChooserEntries<T extends { label: string; id: number }>(
  entries: T[],
): T[] {
  const normalized = entries.map((e) => ({
    ...e,
    label: e.label
      .split(' · ')
      .map((p) => p.trim())
      .filter(Boolean)
      .sort(collator.compare)
      .join(' · ') || e.label,
  }));
  return normalized.sort((a, b) => collator.compare(a.label, b.label) || a.id - b.id);
}
