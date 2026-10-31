/**
 * After a document is moved here from another window the destination window
 * comes to the front, so the person who moved it is now looking at a window
 * they did not choose to leave. This notice says where the document came
 * from and offers one press back to that window.
 */

import { showActionToast } from './toast.js';

export interface MovedDocSource {
  id: number;
  label: string;
}

/** Show "Moved “X” here from <window>." with a Go back button. Does nothing
 *  when the source is unknown (an older main) or the host cannot focus a
 *  window. `focusWindow` resolves false when that window has since closed. */
export function showMovedDocNotice(
  filename: string,
  from: MovedDocSource | null | undefined,
  focusWindow: ((windowId: number) => Promise<boolean>) | undefined,
  closed: (message: string) => void,
): (() => void) | null {
  if (!from || !focusWindow) return null;
  return showActionToast(`Moved “${filename}” here from ${from.label}.`, {
    actionLabel: 'Go back',
    onAction: () => {
      void focusWindow(from.id).then((ok) => {
        if (!ok) closed(`${from.label} has closed.`);
      });
    },
  });
}
