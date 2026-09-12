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
