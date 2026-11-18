/**
 * Workspace store — "reopen the documents I had open last time."
 *
 * Two localStorage records, both host-agnostic in shape but only
 * useful where handles are serializable (Electron paths; the web
 * edition's `FileSystemFileHandle` can't be stored, exactly as in
 * `recents-store.ts`, so web docs are skipped):
 *
 *  - LIVE (`pmd-live-workspace:<windowId>`, one localStorage key per
 *    window): the docs that window currently has open. Every window
 *    rewrites its OWN key — and only its own — whenever its open set
 *    changes (single-doc: on handle change; three-pane: on every slot
 *    composition change). One key per window matters: the windows are
 *    separate processes sharing one localStorage, and when they all kept
 *    ONE map under one key, two windows reporting at the same moment (a
 *    restored workspace booting its windows together) each wrote back
 *    the map as it looked to them, and the later write erased the
 *    other's entry — that window was then missing from the next
 *    session's offer. (The old single-map key is still read, so a
 *    session that straddles the update is not lost.) A window that
 *    closes on its own is MARKED closed (`installWindowCloseForget`),
 *    not dropped: what the next session is offered is what was open at
 *    the QUIT plus any window closed by hand in the last few minutes
 *    before it (closing windows one by one is a way of quitting). A
 *    window closed long before the quit stays out. A quit — or a killed
 *    app — leaves entries exactly as they were, which is the point.
 *
 *  - LAST (`pmd-last-workspace`): the snapshot offered to the user.
 *    The first window of an app session calls `rolloverLastWorkspace()`
 *    at boot, which folds the LIVE map (i.e. the previous session's
 *    survivors) into LAST and empties LIVE so this session starts
 *    accumulating from scratch. `saveWorkspaceNow()` does the same
 *    fold mid-session for the explicit Save Workspace command.
 *
 * Closing every document before quitting is taken at face value: the
 * roll-over finds nothing and CLEARS the snapshot, so the next launch
 * offers nothing to reopen. The exception is a snapshot the user saved
 * deliberately (`pinned`, written by Save Workspace) — that survives an
 * empty quit, which is the whole reason to reach for the command. A
 * session that ends WITH documents open always replaces the snapshot,
 * pinned or not; pinning protects against erasure, it doesn't freeze
 * the row.
 *
 * The snapshot keeps the WINDOWS apart: one entry per window, in the
 * order the windows were opened, each with its own documents, its mode
 * (`panes` / `windows`, so a restore honours slot assignments only when
 * the user is still in three-pane mode) and its name when the user gave
 * it one. The home screen lists a row per window, and clicking a row
 * reopens that window. `docs` is the same documents flattened, for the
 * callers that only want a count or the whole set.
 */

import { settings } from './settings.js';

/** The pre-update single map (windowId → entry). Still read, never written. */
const LIVE_KEY = 'pmd-live-workspace';
/** One key per window: `LIVE_PREFIX + windowId` holds that window's entry. */
const LIVE_PREFIX = 'pmd-live-workspace:';
const LAST_KEY = 'pmd-last-workspace';
/** Set (to '1') once any window of this session has reported a document.
 *  Tells "the session never held a document" (a launch that was only a look
 *  at the home screen) from "every document was closed on purpose": the first
 *  must not wipe the snapshot that was on offer, the second does. */
const SESSION_DOCS_KEY = 'pmd-live-session-had-docs';
/** When the app last began to quit (ms since epoch), stamped by a window
 *  closing during the quit. Lets the next roll-over tell "windows closed
 *  a moment before the quit" from "a window closed an hour ago". */
const QUIT_KEY = 'pmd-live-quit-at';

/** Windows the user closed by hand in the last stretch before the app
 *  ended still count as part of the workspace. Closing the windows one by
 *  one (to install an update, say) is how many people quit, and offering
 *  only the last survivor lost the rest. */
const CLOSE_GRACE_MS = 3 * 60 * 1000;

/** Cap on a snapshot's size, against stale entries from windows that never
 *  got pruned. It was 24, which a busy three-pane session (several windows,
 *  each pane a stack of documents) passes easily; the windows past the cap were
 *  silently left out. The Home screen lists them with tick boxes, so a long
 *  list is no longer a hostile reopen. */
const MAX_DOCS = 120;

/** Live entries older than this are dropped on read. Bounds the map
 *  against windowIds that vanished without a rollover (a crash on a
 *  machine where the next launch never happened, say). */
const LIVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type WorkspaceSlotId = 'slot1' | 'slot2' | 'slot3';

export interface WorkspaceDoc {
  /** Absolute path (Electron). Docs without a serializable handle
   *  are never recorded, so this is always a non-empty string. */
  path: string;
  filename: string;
  format: 'cmir' | 'docx' | null;
  /** Three-pane only: which slot held the doc. Null in single-doc
   *  mode, and ignored by a restore running in the other mode. */
  slot: WorkspaceSlotId | null;
}

/** One window of the snapshot. */
export interface WorkspaceWindow {
  /** The name the user gave the window (Name This Window), or null. */
  name: string | null;
  /** The layout the window was in; slot assignments only mean something
   *  for `panes`. */
  mode: 'panes' | 'windows';
  docs: WorkspaceDoc[];
}

export interface WorkspaceSnapshot {
  savedAt: number;
  /** Every window that was open, oldest first. Never empty, and no
   *  window in it is empty. */
  windows: WorkspaceWindow[];
  /** Every window's documents, flattened in window order. */
  docs: WorkspaceDoc[];
  /** True when the user saved this set deliberately (Save Workspace)
   *  rather than it being the automatic end-of-session capture. Only
   *  effect: an empty quit doesn't clear it. */
  pinned: boolean;
}

interface LiveEntry {
  /** When this window first reported; windows list in this order, so a
   *  window doesn't hop to the end of the list every time it opens a doc. */
  openedAt: number;
  updatedAt: number;
  mode: 'panes' | 'windows';
  name: string | null;
  docs: WorkspaceDoc[];
  /** Set when the window closed on its own (not as part of a quit). */
  closedAt?: number;
}

/** Identity for THIS window inside the LIVE map, minted per load.
 *  Deliberately NOT persisted: a reloaded window is a new window as
 *  far as the map is concerned, and its old entry is swept by the
 *  next rollover. */
const WINDOW_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `w${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

/** This window's name, mirrored here by `setWindowWorkspaceName` so every
 *  report carries it without the callers having to know. */
let windowName: string | null = null;

type Listener = (snapshot: WorkspaceSnapshot | null) => void;
const listeners = new Set<Listener>();

function isDoc(d: unknown): d is WorkspaceDoc {
  if (!d || typeof d !== 'object') return false;
  const doc = d as WorkspaceDoc;
  return typeof doc.path === 'string' && !!doc.path && typeof doc.filename === 'string';
}

function normalizeDoc(d: WorkspaceDoc): WorkspaceDoc {
  return {
    path: d.path,
    filename: d.filename,
    format: d.format === 'cmir' || d.format === 'docx' ? d.format : null,
    slot: d.slot === 'slot1' || d.slot === 'slot2' || d.slot === 'slot3' ? d.slot : null,
  };
}

function normalizeName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed || null;
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled / quota — the feature degrades to "no
    // snapshot", which every caller already handles.
  }
}

/** One entry as stored, validated; null when it is unusable or too old. */
function parseEntry(value: unknown, cutoff: number): LiveEntry | null {
  if (!value || typeof value !== 'object') return null;
  const e = value as LiveEntry;
  if (typeof e.updatedAt !== 'number' || e.updatedAt < cutoff) return null;
  if (!Array.isArray(e.docs)) return null;
  return {
    openedAt: typeof e.openedAt === 'number' ? e.openedAt : e.updatedAt,
    updatedAt: e.updatedAt,
    mode: e.mode === 'panes' ? 'panes' : 'windows',
    name: normalizeName(e.name),
    docs: e.docs.filter(isDoc).map(normalizeDoc),
    ...(typeof e.closedAt === 'number' ? { closedAt: e.closedAt } : {}),
  };
}

/** Every window's live entry: the per-window keys, plus any left in the old
 *  single map by a session that began before the update. */
function readLive(): Record<string, LiveEntry> {
  const out: Record<string, LiveEntry> = {};
  const cutoff = Date.now() - LIVE_MAX_AGE_MS;
  const legacy = readJson(LIVE_KEY);
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [id, value] of Object.entries(legacy as Record<string, unknown>)) {
      const e = parseEntry(value, cutoff);
      if (e) out[id] = e;
    }
  }
  for (const key of liveKeys()) {
    const e = parseEntry(readJson(key), cutoff);
    if (e) out[key.slice(LIVE_PREFIX.length)] = e;
  }
  return out;
}

/** The localStorage keys holding per-window entries. */
function liveKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LIVE_PREFIX)) keys.push(key);
    }
  } catch {
    /* storage unavailable: no entries */
  }
  return keys;
}

/** THIS window's own entry. */
function readOwn(): LiveEntry | null {
  return parseEntry(readJson(LIVE_PREFIX + WINDOW_ID), Date.now() - LIVE_MAX_AGE_MS);
}

function writeOwn(entry: LiveEntry | null): void {
  writeJson(LIVE_PREFIX + WINDOW_ID, entry);
}

/** Empty the live record: every window's key and the old single map. */
function clearLive(): void {
  for (const key of liveKeys()) writeJson(key, null);
  writeJson(LIVE_KEY, null);
}

/** Build a snapshot from windows already in order: de-duplicate by path
 *  (a document belongs to one window; a stale entry could say otherwise),
 *  cap the total, and drop any window left with nothing. */
function buildSnapshot(windows: WorkspaceWindow[], savedAt: number, pinned: boolean): WorkspaceSnapshot | null {
  const seen = new Set<string>();
  const kept: WorkspaceWindow[] = [];
  const docs: WorkspaceDoc[] = [];
  for (const win of windows) {
    const own: WorkspaceDoc[] = [];
    for (const doc of win.docs) {
      if (docs.length >= MAX_DOCS) break;
      if (seen.has(doc.path)) continue;
      seen.add(doc.path);
      own.push(doc);
      docs.push(doc);
    }
    if (own.length > 0) kept.push({ name: win.name, mode: win.mode, docs: own });
    if (docs.length >= MAX_DOCS) break;
  }
  if (kept.length === 0) return null;
  return { savedAt, windows: kept, docs, pinned };
}

/** Which live entries belong in a snapshot. Open windows always do. A
 *  window that closed on its own does only when `includeClosed` is set
 *  (the end-of-session fold, never an explicit Save Workspace) AND it
 *  closed within the grace period before the session ended. The session
 *  ended when the app began to quit; when it never did (every window
 *  closed by hand, which just exits), when the last window closed. While
 *  other windows stay open with no quit recorded, nothing is "the end",
 *  so closed windows stay out. Paths an open window holds are stripped
 *  from the closed ones (a reloaded window leaves its old entry behind). */
function entriesForSnapshot(live: Record<string, LiveEntry>, includeClosed: boolean): LiveEntry[] {
  const all = Object.values(live).filter((e) => e.docs.length > 0);
  const open = all.filter((e) => e.closedAt === undefined);
  if (!includeClosed) return open;
  const closed = all.filter((e) => e.closedAt !== undefined);
  if (closed.length === 0) return open;
  const quitAt = readQuitAt();
  const lastClose = Math.max(...closed.map((e) => e.closedAt as number));
  const endedAt = quitAt ?? (open.length === 0 ? lastClose : null);
  if (endedAt === null) return open;
  const held = new Set(open.flatMap((e) => e.docs.map((d) => d.path)));
  const recent = closed
    .filter((e) => (e.closedAt as number) >= endedAt - CLOSE_GRACE_MS)
    .map((e) => ({ ...e, docs: e.docs.filter((d) => !held.has(d.path)) }))
    .filter((e) => e.docs.length > 0);
  return [...open, ...recent];
}

function readQuitAt(): number | null {
  const v = readJson(QUIT_KEY);
  return typeof v === 'number' ? v : null;
}

/** Fold the LIVE map into one snapshot: one window per entry, the
 *  oldest first (so the set reads in the order the user built it). */
function foldLive(live: Record<string, LiveEntry>, includeClosed: boolean): WorkspaceSnapshot | null {
  const entries = entriesForSnapshot(live, includeClosed).sort((a, b) => a.openedAt - b.openedAt);
  return buildSnapshot(
    entries.map((e) => ({ name: e.name, mode: e.mode, docs: e.docs })),
    Date.now(),
    false,
  );
}

/** Record what THIS window currently has open. Docs without a string
 *  path (unsaved, or a web handle) are dropped — they can't be
 *  reopened, and recording them would render dead rows. Cheap enough
 *  to call from every open / close / Save As. */
export function reportWindowWorkspace(
  mode: 'panes' | 'windows',
  docs: Array<{ path: unknown; filename: string | null; format: 'cmir' | 'docx' | null; slot?: WorkspaceSlotId | null }>,
): void {
  if (!settings.get('lastWorkspaceEnabled')) return; // off: nothing is recorded
  const kept: WorkspaceDoc[] = [];
  for (const d of docs) {
    if (typeof d.path !== 'string' || !d.path || !d.filename) continue;
    kept.push({ path: d.path, filename: d.filename, format: d.format, slot: d.slot ?? null });
  }
  if (kept.length === 0) {
    writeOwn(null);
    return;
  }
  const now = Date.now();
  // (Reporting again clears any closed mark: a window that reports is open.)
  writeOwn({
    openedAt: readOwn()?.openedAt ?? now,
    updatedAt: now,
    mode,
    name: windowName,
    docs: kept,
  });
  // This session has held a document (see SESSION_DOCS_KEY).
  writeJson(SESSION_DOCS_KEY, '1');
}

/** Tell the store this window's name (null = unnamed), so the snapshot
 *  can label the window. Rewrites this window's entry in place when it
 *  has one; a window with no entry yet picks the name up on its first
 *  report. */
export function setWindowWorkspaceName(name: string | null): void {
  const next = normalizeName(name);
  if (next === windowName) return;
  windowName = next;
  if (!settings.get('lastWorkspaceEnabled')) return;
  const mine = readOwn();
  if (!mine) return;
  writeOwn({ ...mine, name: next });
}

/** Drop THIS window's live entry outright. */
export function forgetWindowWorkspace(): void {
  writeOwn(null);
}

/** THIS window closed on its own. Keep its entry, stamped, so the
 *  end-of-session fold can still offer it when the session ended soon
 *  after (see `entriesForSnapshot`). */
export function markWindowClosed(): void {
  const mine = readOwn();
  if (!mine) return;
  writeOwn({ ...mine, closedAt: Date.now() });
}

/** The app is quitting: stamp when, so windows closed by hand just
 *  before it are told apart from ones closed long ago. */
export function markAppQuitting(): void {
  writeJson(QUIT_KEY, Date.now());
}

/** Mark this window's entry closed when the window goes away WITHOUT
 *  the app quitting — an ordinary close, a reload, a mode-switch close.
 *  `isAppQuitting` is asked synchronously from `pagehide`, where
 *  nothing can be awaited; when it says the app is quitting (or it
 *  cannot tell), the entry stays as it is and the quit is stamped,
 *  which is the whole feature. */
export function installWindowCloseForget(isAppQuitting: () => boolean): () => void {
  const onHide = (): void => {
    let quitting = true;
    try {
      quitting = isAppQuitting();
    } catch {
      quitting = true;
    }
    if (quitting) markAppQuitting();
    else markWindowClosed();
  };
  window.addEventListener('pagehide', onHide);
  return () => window.removeEventListener('pagehide', onHide);
}

/** The snapshot the user can reopen, or null when there is none (or
 *  the feature is off — the section then never renders). */
export function lastWorkspace(): WorkspaceSnapshot | null {
  if (!settings.get('lastWorkspaceEnabled')) return null;
  const parsed = readJson(LAST_KEY);
  if (!parsed || typeof parsed !== 'object') return null;
  const s = parsed as {
    savedAt?: unknown;
    mode?: unknown;
    windows?: unknown;
    docs?: unknown;
    pinned?: unknown;
  };
  if (typeof s.savedAt !== 'number') return null;
  let windows: WorkspaceWindow[];
  if (Array.isArray(s.windows)) {
    windows = s.windows
      .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object' && Array.isArray((w as { docs?: unknown }).docs))
      .map((w) => ({
        name: normalizeName(w['name']),
        mode: w['mode'] === 'panes' ? 'panes' : 'windows',
        docs: (w['docs'] as unknown[]).filter(isDoc).map(normalizeDoc),
      }));
  } else if (Array.isArray(s.docs)) {
    // Written before windows were kept apart: a three-pane session is
    // one window's worth of documents, a single-doc one a window each.
    const docs = s.docs.filter(isDoc).map(normalizeDoc);
    windows =
      s.mode === 'panes'
        ? [{ name: null, mode: 'panes', docs }]
        : docs.map((d) => ({ name: null, mode: 'windows' as const, docs: [d] }));
  } else {
    return null;
  }
  return buildSnapshot(windows, s.savedAt, s.pinned === true);
}

function publish(snapshot: WorkspaceSnapshot | null): void {
  for (const fn of listeners) fn(snapshot);
}

/** Boot-time roll-over, run ONCE per app session by the first window:
 *  the LIVE map still holds the previous session's open docs, so fold
 *  it into LAST and empty it. A session that ended with nothing open
 *  clears LAST — unless the standing snapshot was pinned by Save
 *  Workspace, which is exactly the set the user asked to keep.
 *  Returns the resulting snapshot. */
export function rolloverLastWorkspace(): WorkspaceSnapshot | null {
  if (!settings.get('lastWorkspaceEnabled')) return null; // off: leave storage alone
  const folded = foldLive(readLive(), true);
  const sessionHeldDocs = readJson(SESSION_DOCS_KEY) === '1';
  clearLive();
  writeJson(QUIT_KEY, null);
  writeJson(SESSION_DOCS_KEY, null);
  let snapshot: WorkspaceSnapshot | null;
  if (folded) {
    writeJson(LAST_KEY, folded);
    snapshot = folded;
  } else {
    const standing = lastWorkspace();
    // A pinned snapshot survives an empty quit. So does ANY standing snapshot
    // when the session never held a document at all: a launch that only looked
    // at the Home screen (or an update restart before anything was reopened)
    // says nothing about what the user wants back, and used to erase it.
    // Closing documents on purpose is different: the session held some.
    snapshot = standing && (standing.pinned || !sessionHeldDocs) ? standing : null;
    if (!snapshot) writeJson(LAST_KEY, null);
  }
  publish(snapshot);
  return snapshot;
}

/** Explicit "Save Workspace": fold what every live window reports
 *  RIGHT NOW into LAST, without disturbing the live map. Returns the
 *  saved snapshot, or null when nothing reopenable is open. */
export function saveWorkspaceNow(): WorkspaceSnapshot | null {
  if (!settings.get('lastWorkspaceEnabled')) return null;
  const folded = foldLive(readLive(), false);
  if (!folded) return null;
  const pinned: WorkspaceSnapshot = { ...folded, pinned: true };
  writeJson(LAST_KEY, pinned);
  publish(pinned);
  return pinned;
}

export function clearLastWorkspace(): void {
  writeJson(LAST_KEY, null);
  publish(null);
}

export function subscribeLastWorkspace(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Cross-window sync, same mechanism recents use: a write from ANOTHER
// window arrives as a `storage` event (never fired in the writing
// window, which published to its own listeners above). Keeps a home
// screen sitting visible in one window current when another saves.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LAST_KEY || e.key === null) publish(lastWorkspace());
  });
}
// The master switch flips what `lastWorkspace()` answers, so a Home
// screen sitting open shows or hides the section as soon as it changes.
let lastEnabled = settings.get('lastWorkspaceEnabled');
settings.subscribe((s) => {
  if (s.lastWorkspaceEnabled !== lastEnabled) {
    lastEnabled = s.lastWorkspaceEnabled;
    publish(lastWorkspace());
  }
});
