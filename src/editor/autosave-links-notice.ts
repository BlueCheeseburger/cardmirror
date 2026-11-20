/**
 * A one-time notice that autosave is paused for a Word (.docx) file because it
 * holds live views or linked copies, which Word can't store (an autosave can't
 * ask "this will flatten them" the way a manual save does, so it skips instead).
 *
 * Until now the pause was only in the autosave button's tooltip. The notice
 * fires the first time a tick is skipped for a document, once per document per
 * session, and fires again only if autosave has resumed in between (the links
 * were removed or unlinked) and a link is added again.
 */

import { showToast } from './toast.js';

const told = new Set<string>();

/** "a live view", "2 linked copies", "a live view and a linked copy". */
export function describeLiveLinks(views: number, copies: number): string {
  const parts: string[] = [];
  if (views > 0) parts.push(views === 1 ? 'a live view' : `${views} live views`);
  if (copies > 0) parts.push(copies === 1 ? 'a linked copy' : `${copies} linked copies`);
  return parts.join(' and ');
}

/** Tell the user, once per document, that autosave is paused. `uid` identifies
 *  the document for the session (a pane record's uid, or the window's doc uid).
 *  Returns true when the notice was shown. */
export function noteAutosavePausedByLinks(uid: string, views: number, copies: number): boolean {
  const total = views + copies;
  if (total === 0 || told.has(uid)) return false;
  told.add(uid);
  const what = describeLiveLinks(views, copies);
  const them = total === 1 ? 'it' : 'them';
  showToast(`Autosave is paused: this Word file has ${what}, and .docx can’t hold ${them}.`, {
    detail: `Save by hand, or unlink ${them}, to resume. A .cmir file keeps ${them} live and autosaves.`,
    durationMs: 9000,
  });
  return true;
}

/** Autosave ran for this document, so the next pause is news again. */
export function clearAutosavePausedNotice(uid: string): void {
  told.delete(uid);
}

/** Test seam. */
export function __resetAutosaveLinksNoticeForTests(): void {
  told.clear();
}
