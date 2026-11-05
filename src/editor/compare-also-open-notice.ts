/**
 * Opening a file that a window with Compare documents already has up opens it in
 * an editor of its own (the Compare window shows the tool, not the document), so
 * the same file is now open in two windows. This notice says so, once, and offers
 * a press to the Compare window.
 */

import { showActionToast, showToast } from './toast.js';

/** The file's own name, from a path with either separator. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Show "“X” is also open in Compare documents in another window." with a Go to
 *  Compare button. `focusWindow` resolves false when that window has since
 *  closed (`closed` then says so); without it the notice is plain text. */
export function showAlsoInCompareNotice(
  path: string,
  compareWindowId: number,
  focusWindow: ((windowId: number) => Promise<boolean>) | undefined,
  closed: (message: string) => void,
): (() => void) | null {
  const message = `“${baseName(path)}” is also open in Compare documents in another window.`;
  if (!focusWindow) {
    showToast(message);
    return null;
  }
  return showActionToast(message, {
    actionLabel: 'Go to Compare',
    onAction: () => {
      void focusWindow(compareWindowId).then((ok) => {
        if (!ok) closed('That Compare window has closed.');
      });
    },
  });
}
