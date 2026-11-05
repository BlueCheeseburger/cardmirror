/**
 * Save Send / Read / Marked / Starred Doc write without a dialog, so nothing
 * said where the copy went. This notice does: what was saved, its file name and
 * the folder it landed in, with a Show in folder button where the host can
 * reveal a file.
 */

import { showActionToast, showToast } from './toast.js';

const parts = (path: string): string[] => path.split(/[\\/]/).filter(Boolean);

/** "Send doc saved: SEND_1AC.docx in Round 3" (the folder is left out when the
 *  host gave no path). `label` is the preset's name, e.g. "Send doc". */
export function presetSavedMessage(label: string, fileName: string, handle: unknown): string {
  const folder = typeof handle === 'string' && handle ? parts(handle).slice(-2, -1)[0] : undefined;
  return `${label} saved: ${fileName}${folder ? ` in ${folder}` : ''}`;
}

/** Tell the user a preset save landed. With a path and a reveal function the
 *  notice carries a Show in folder button; otherwise it is a plain toast. */
export function showPresetSavedNotice(
  label: string,
  fileName: string,
  handle: unknown,
  reveal: ((path: string) => void) | undefined,
): (() => void) | null {
  const message = presetSavedMessage(label, fileName, handle);
  if (typeof handle !== 'string' || !handle || !reveal) {
    showToast(message);
    return null;
  }
  return showActionToast(message, {
    actionLabel: 'Show in folder',
    onAction: () => reveal(handle),
    durationMs: 6000,
  });
}
