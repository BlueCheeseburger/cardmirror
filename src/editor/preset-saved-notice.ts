/**
 * Save Send / Read / Marked / Starred Doc write without a dialog, so nothing
 * said where the copy went. This notice does: what was saved, its file name and
 * the folder it landed in, with a Show in folder button where the host can
 * reveal a file.
 */

import { showActionToast, showBottomToast, showToast, type CloseToast } from './toast.js';

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

export interface ExportUndoNotice {
  /** The preset's name, e.g. "Send doc". */
  label: string;
  fileName: string;
  /** The saved file's path. */
  handle: string;
  /** Moves the new file to the trash; resolves to whether it did. */
  undo: () => Promise<boolean>;
}

/** The notice for a save with the Undo setting on: where it went ("Send doc
 *  saved to Round 3", the file's name beside it) and an Undo button, which
 *  moves the new file to the trash. Replaces the Show in folder notice, since a
 *  toast carries one button. */
export function showExportUndoNotice(n: ExportUndoNotice): CloseToast {
  const folder = parts(n.handle).slice(-2, -1)[0];
  return showBottomToast(`${n.label} saved${folder ? ` to ${folder}` : ''}`, {
    detail: n.fileName,
    durationMs: 8000,
    action: {
      label: 'Undo',
      onClick: () => {
        void n.undo().then((ok) => {
          showToast(ok ? `Moved ${n.fileName} to the trash.` : `Couldn’t undo: ${n.fileName} is still saved.`);
        });
      },
    },
  });
}
