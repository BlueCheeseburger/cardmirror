/**
 * The "Sent to speech doc" notice. It sits at the bottom centre of the window
 * (the spot the other action notices use) rather than at the pointer, and while
 * the send can still be taken back it carries an Undo button.
 *
 * The notice is a single slot: a newer send replaces the older one, so Undo
 * always means the send you just made. Whether the send CAN be undone is the
 * caller's to say (`undo` is null when it can't): the speech doc may be in this
 * window, in another window or in another tab, and the notice only asks.
 */

import { showBottomToast, type CloseToast } from './toast.js';

/** How an Undo went. `refused`: the speech doc has moved on since the send (or
 *  keeps no undo history of its own), so nothing was touched. `gone`: the speech
 *  doc is no longer open anywhere that answers. */
export type SentUndoResult = 'undone' | 'refused' | 'gone';

/** Seconds are for reaching the button; without one the notice just informs. */
const WITH_UNDO_MS = 6000;
const WITHOUT_UNDO_MS = 3500;
const RESULT_MS = 2500;

let current: CloseToast | null = null;

/** Put `close` in the single slot, closing whatever held it (no fade, so two
 *  notices never overlap). */
function take(close: CloseToast): void {
  const previous = current;
  current = close;
  previous?.(true);
}

export function undoResultMessage(result: SentUndoResult, what: string | null): string {
  switch (result) {
    case 'undone':
      return what ? `Removed “${what}” from the speech doc.` : 'Removed it from the speech doc.';
    case 'refused':
      return "Can't undo this send from here. Use Undo in the speech doc.";
    case 'gone':
      return "The speech doc isn't open any more.";
  }
}

/** Show the notice for a send that landed. `what` is the first line of what was
 *  sent (null for a slice with no text). `undo` takes the send back out of the
 *  speech doc; null means it can't be undone from here, and no button shows. */
export function showSentNotice(
  what: string | null,
  atEnd: boolean,
  undo: (() => Promise<SentUndoResult>) | null,
): CloseToast {
  const close = showBottomToast('Sent to speech doc', {
    icon: 'mic',
    ...(what ? { detail: `“${what}”` } : {}),
    pill: atEnd ? 'at end' : 'at cursor',
    durationMs: undo ? WITH_UNDO_MS : WITHOUT_UNDO_MS,
    ...(undo
      ? {
          action: {
            label: 'Undo',
            onClick: () => {
              void undo()
                .catch((): SentUndoResult => 'gone')
                .then((result) => {
                  take(showBottomToast(undoResultMessage(result, what), { durationMs: RESULT_MS }));
                });
            },
          },
        }
      : {}),
  });
  take(close);
  return close;
}
