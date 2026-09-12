/**
 * Folders you've saved into, for the Save As dialog's "Save in a
 * previously saved location" list.
 *
 * Deliberately FOLDERS, not files: the filename comes from the dialog's
 * Name field, so one remembered folder serves every doc you ever put
 * there. (Remembering full file paths would make a click an overwrite
 * of somebody else's document, which is not what "save it in there"
 * means.)
 *
 * Persisted to `localStorage`, same shape as `recents-store.ts` — and,
 * like it, shared across Electron windows, so a folder first used in
 * one window shows up in another's next Save As. Read on demand (the
 * dialog is transient); no subscribe API, because nothing renders this
 * list except a modal that re-reads every time it opens.
 *
 * Electron-only in practice: the web edition has no filesystem paths to
 * write into, so the caller doesn't offer the list there.
 */

const STORAGE_KEY = 'pmd-save-locations';
const OPEN_KEY = 'pmd-save-locations-open';

/** Unpinned folders are a recency window, not a history — old ones
 *  rotate out. Pinned folders are exempt and never counted here. */
const MAX_UNPINNED = 8;

export interface SaveLocation {
  /** Absolute directory path, no trailing separator. */
  dir: string;
  lastSavedAt: number;
  /** When the user pinned it, or null. Pinned entries sort above the
   *  rest and never rotate out. */
  pinnedAt: number | null;
}

function read(): SaveLocation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is SaveLocation =>
        !!e &&
        typeof e === 'object' &&
        typeof e.dir === 'string' &&
        !!e.dir &&
        typeof e.lastSavedAt === 'number' &&
        (e.pinnedAt === null || typeof e.pinnedAt === 'number'),
    );
  } catch {
    return [];
  }
}

function write(items: SaveLocation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage disabled / quota — the list just won't survive a restart.
  }
}

/** Pinned first (most recently pinned on top), then the rest by how
 *  recently they were saved into. */
function sorted(items: SaveLocation[]): SaveLocation[] {
  return items.slice().sort((a, b) => {
    if (a.pinnedAt !== null && b.pinnedAt !== null) return b.pinnedAt - a.pinnedAt;
    if (a.pinnedAt !== null) return -1;
    if (b.pinnedAt !== null) return 1;
    return b.lastSavedAt - a.lastSavedAt;
  });
}

/** Current locations, display order. */
export function listSaveLocations(): SaveLocation[] {
  return sorted(read());
}

/** Record a folder as just-saved-into. De-dups on the exact path,
 *  refreshes its timestamp, and trims unpinned entries past the cap
 *  (oldest first). No-op for an empty path. */
export function recordSaveLocation(dir: string): void {
  const clean = stripTrailingSeparator(dir);
  if (!clean) return;
  const existing = read();
  const prior = existing.find((e) => e.dir === clean);
  const entry: SaveLocation = {
    dir: clean,
    lastSavedAt: Date.now(),
    pinnedAt: prior?.pinnedAt ?? null,
  };
  const rest = existing.filter((e) => e.dir !== clean);
  const next = sorted([entry, ...rest]);
  // Trim only the unpinned tail; pinned entries are exempt.
  const pinned = next.filter((e) => e.pinnedAt !== null);
  const unpinned = next.filter((e) => e.pinnedAt === null).slice(0, MAX_UNPINNED);
  write([...pinned, ...unpinned]);
}

/** Pin / unpin a folder. Pinning a folder that isn't in the list yet
 *  adds it (the dialog only offers pins for rows it already shows, but
 *  a stale render shouldn't silently drop the pin). */
export function toggleSaveLocationPin(dir: string): void {
  const clean = stripTrailingSeparator(dir);
  if (!clean) return;
  const items = read();
  const existing = items.find((e) => e.dir === clean);
  if (!existing) {
    write([...items, { dir: clean, lastSavedAt: Date.now(), pinnedAt: Date.now() }]);
    return;
  }
  existing.pinnedAt = existing.pinnedAt === null ? Date.now() : null;
  write(items);
}

/** Forget a folder entirely (pinned or not). */
export function removeSaveLocation(dir: string): void {
  const clean = stripTrailingSeparator(dir);
  if (!clean) return;
  write(read().filter((e) => e.dir !== clean));
}

/** Whether the Save As dialog's location section is expanded. Closed
 *  for new users; the user's choice then persists indefinitely. */
export function saveLocationsExpanded(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSaveLocationsExpanded(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Storage disabled — the section just reverts to closed next time.
  }
}

/** The directory part of an absolute file path, handling both
 *  separators (an Electron renderer sees Windows paths verbatim).
 *  Returns '' when there's no directory part to take. */
export function dirnameOf(filePath: string): string {
  const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (cut < 0) return '';
  // Keep the root's separator: dirname('/a.cmir') is '/', not ''.
  if (cut === 0) return filePath.slice(0, 1);
  return filePath.slice(0, cut);
}

/** Join a directory and a filename with the separator the directory
 *  already uses, so a Windows path doesn't come back half-POSIX. */
export function joinPath(dir: string, filename: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const base = stripTrailingSeparator(dir);
  // A root ('/' , 'C:\') keeps its separator through the strip, so
  // adding another would produce '//name'.
  if (!base || /[/\\]$/.test(base)) return `${base}${filename}`;
  return `${base}${sep}${filename}`;
}

/** Drop a trailing separator, but never turn a root into ''. */
function stripTrailingSeparator(dir: string): string {
  const trimmed = dir.trim();
  if (trimmed.length <= 1) return trimmed;
  return /[/\\]$/.test(trimmed) ? trimmed.slice(0, -1) : trimmed;
}
