/**
 * Per-document autosave preference store.
 *
 * Remembers which saved files the user has turned autosave OFF for,
 * keyed by absolute path, so the autosave toggle survives closing and
 * reopening a doc. Persisted to `localStorage` (survives restarts;
 * shared across same-session Electron windows).
 *
 * This is distinct from the live `autosaveEnabled` setting, which stays
 * transient/per-window (see `TRANSIENT_SETTING_KEYS` in settings.ts):
 * the setting drives the current window's behavior, and opening a known
 * doc restores its remembered state from here. Only Electron docs have
 * a stable string path; web `FileSystemFileHandle`s aren't serializable,
 * so web docs never match (autosave stays its default-off there — see
 * `isAutosaveOnForPath`).
 *
 * Stores only paths that are OFF — a path absent from the set means on
 * (the default, 2026-09-07), so the store stays small and self-pruning-ish.
 * Deliberately a different storage key than the old ON-paths store: that
 * store never recorded an explicit "off" choice as distinct from "never
 * touched" (off was the default, so turning it off just removed the
 * entry), so there's no way to migrate its data forward without
 * silently reverting every user's explicit "off" picks to "on" — not
 * acceptable. Starting a fresh, empty OFF-set means everyone's autosave
 * defaults to on now (the actual point of the change) and nothing that
 * used to explicitly be ON stops being on.
 */

const STORAGE_KEY = 'pmd-autosave-paths-off';

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((p): p is string => typeof p === 'string'));
  } catch {
    return new Set();
  }
}

function write(paths: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...paths]));
  } catch {
    // Storage disabled / quota — the live `autosaveEnabled` setting
    // still drives this window; we just lose cross-restart persistence.
  }
}

/** Whether autosave should be on for the file at `path` — true unless
 *  the user explicitly turned it off for this path before. False for a
 *  non-string path (unsaved / web handle — nothing to autosave to yet). */
export function isAutosaveOnForPath(path: unknown): boolean {
  if (typeof path !== 'string' || !path) return false;
  return !read().has(path);
}

/** Remember the autosave toggle state for the file at `path`. No-op for
 *  a non-string path (unsaved docs / web — nothing stable to key on). */
export function setAutosaveForPath(path: unknown, on: boolean): void {
  if (typeof path !== 'string' || !path) return;
  const paths = read();
  if (on) {
    if (!paths.has(path)) return;
    paths.delete(path);
  } else {
    if (paths.has(path)) return;
    paths.add(path);
  }
  write(paths);
}
