/**
 * Open documents and windows — the data behind Search Everything's `p`
 * source (fork). Lists every doc open in any pane of any window, plus
 * each window by name, and brings one forward on Enter.
 *
 * On desktop the main process already keeps a cross-window doc directory
 * (`host:list-docs`, the one the Select Speech Doc picker uses), so a
 * listing is one IPC round trip; activating a doc in another window
 * raises that window and asks its renderer to show the doc. Where that
 * isn't available (the web edition, an older shell), only this window's
 * own docs are listed, from the provider `index.ts` registers.
 */

import { getElectronHost } from './host/index.js';

/** One open doc, wherever it lives. */
export interface OpenDocEntry {
  uid: string;
  /** Display filename, or null for a never-saved doc. */
  filename: string | null;
  /** Owning window's id; null when listed locally (no desktop host). */
  windowId: number | null;
  /** The owning window's user-given name, if it has one. */
  windowName: string | null;
  /** True when the doc lives in the window running the search. */
  isOwnWindow: boolean;
}

/** One window that holds open docs. */
export interface OpenWindowEntry {
  windowId: number | null;
  windowName: string | null;
  isOwnWindow: boolean;
  /** Filenames of the docs it holds, in listing order. */
  filenames: string[];
}

interface LocalProvider {
  /** This window's docs (every pane and stack in three-pane mode, the
   *  one doc in single-doc mode). */
  list(): Promise<Array<{ uid: string; filename: string | null }>>;
  /** Bring one of this window's docs forward. False if it's gone. */
  activate(uid: string): Promise<boolean>;
  /** This window's user-given name, if any. */
  windowName(): string | null;
}

let localProvider: LocalProvider | null = null;

/** Called once at boot by `index.ts`. */
export function setLocalOpenDocsProvider(p: LocalProvider | null): void {
  localProvider = p;
}

async function listLocal(): Promise<OpenDocEntry[]> {
  if (!localProvider) return [];
  const windowName = localProvider.windowName();
  return (await localProvider.list()).map((d) => ({
    uid: d.uid,
    filename: d.filename,
    windowId: null,
    windowName,
    isOwnWindow: true,
  }));
}

/** Every open doc: across all windows on desktop, this window only
 *  elsewhere. Never throws; a failed IPC falls back to the local list. */
export async function listOpenDocs(): Promise<OpenDocEntry[]> {
  const host = getElectronHost();
  if (host) {
    try {
      const rows = await host.listDocs();
      return rows.map((r) => ({
        uid: r.uid,
        filename: r.filename,
        windowId: r.windowId,
        windowName: r.windowName ?? null,
        isOwnWindow: r.isOwnWindow,
      }));
    } catch {
      /* fall through to the local list */
    }
  }
  return listLocal();
}

/** Group docs into their windows, own window first, then by id. */
export function windowsOf(docs: OpenDocEntry[]): OpenWindowEntry[] {
  const byKey = new Map<string, OpenWindowEntry>();
  for (const d of docs) {
    const key = d.windowId === null ? 'local' : String(d.windowId);
    let w = byKey.get(key);
    if (!w) {
      w = { windowId: d.windowId, windowName: d.windowName, isOwnWindow: d.isOwnWindow, filenames: [] };
      byKey.set(key, w);
    }
    if (d.filename) w.filenames.push(d.filename);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.isOwnWindow !== b.isOwnWindow) return a.isOwnWindow ? -1 : 1;
    return (a.windowId ?? 0) - (b.windowId ?? 0);
  });
}

/** Bring a doc forward: locally when it's in this window, else raise
 *  its window through the desktop host. Resolves false when the doc is
 *  no longer open anywhere. */
export async function activateOpenDoc(doc: OpenDocEntry): Promise<boolean> {
  if (doc.isOwnWindow) return (await localProvider?.activate(doc.uid)) ?? false;
  const host = getElectronHost();
  if (!host?.activateDoc) return false;
  try {
    return await host.activateDoc(doc.uid);
  } catch {
    return false;
  }
}

/** Raise a window. Own window: nothing to raise, just report success. */
export async function focusOpenWindow(win: OpenWindowEntry): Promise<boolean> {
  if (win.isOwnWindow || win.windowId === null) return true;
  const host = getElectronHost();
  if (!host?.focusWindow) return false;
  try {
    return await host.focusWindow(win.windowId);
  } catch {
    return false;
  }
}
