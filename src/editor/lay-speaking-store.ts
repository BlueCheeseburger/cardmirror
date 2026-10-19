/**
 * Per-document flow/lay read-time preference.
 *
 * Remembers which saved files were left showing lay-speaking times (the
 * status-bar / pane-footer readout toggle), keyed by absolute path, so the
 * choice survives closing and reopening a doc and restarting the app.
 * Persisted to `localStorage`. Only Electron docs have a stable string
 * path; unsaved docs and web file handles never match, so they start on
 * flow times as before.
 *
 * Stores only paths that are ON (lay) — absent means flow, the default.
 */

const STORAGE_KEY = 'pmd-lay-speaking-paths';

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
    // Storage disabled / quota: the live toggle still works this session.
  }
}

/** Whether the file at `path` was last left on lay times. False for a
 *  non-string path. */
export function isLaySpeakingForPath(path: unknown): boolean {
  if (typeof path !== 'string' || !path) return false;
  return read().has(path);
}

/** Remember the flow/lay choice for the file at `path`. No-op for a
 *  non-string path. */
export function setLaySpeakingForPath(path: unknown, on: boolean): void {
  if (typeof path !== 'string' || !path) return;
  const paths = read();
  if (on === paths.has(path)) return;
  if (on) paths.add(path);
  else paths.delete(path);
  write(paths);
}
