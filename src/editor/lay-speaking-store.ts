/**
 * Per-document flow/lay read-time preference.
 *
 * Remembers which saved files were left showing lay-speaking times (the
 * status-bar / pane-footer readout toggle) and which were deliberately left on
 * flow, keyed by absolute path, so the choice survives closing and reopening a
 * doc and restarting the app. Persisted to `localStorage`. Only Electron docs
 * have a stable string path; unsaved docs and web file handles never match, so
 * they start on the default speed (Settings → General → Word counts → Default
 * read-time speed; flow unless changed).
 *
 * A file you have never toggled has no entry and follows that default. Both
 * answers are stored: with the default on lay, a file you switched back to flow
 * has to stay on flow, which "absent means flow" could not say.
 */

const LAY_KEY = 'pmd-lay-speaking-paths';
const FLOW_KEY = 'pmd-flow-speaking-paths';

function read(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((p): p is string => typeof p === 'string'));
  } catch {
    return new Set();
  }
}

function write(key: string, paths: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...paths]));
  } catch {
    // Storage disabled / quota: the live toggle still works this session.
  }
}

/** Whether the file at `path` should show lay times: the choice last made for
 *  it, else `fallback` (the default speed). A non-string path has no choice. */
export function isLaySpeakingForPath(path: unknown, fallback = false): boolean {
  if (typeof path !== 'string' || !path) return fallback;
  if (read(LAY_KEY).has(path)) return true;
  if (read(FLOW_KEY).has(path)) return false;
  return fallback;
}

/** Remember the flow/lay choice for the file at `path`. No-op for a
 *  non-string path. */
export function setLaySpeakingForPath(path: unknown, on: boolean): void {
  if (typeof path !== 'string' || !path) return;
  const lay = read(LAY_KEY);
  const flow = read(FLOW_KEY);
  const [add, addKey, drop, dropKey] = on
    ? [lay, LAY_KEY, flow, FLOW_KEY]
    : [flow, FLOW_KEY, lay, LAY_KEY];
  if (add.has(path) && !drop.has(path)) return;
  add.add(path);
  drop.delete(path);
  write(addKey, add);
  write(dropKey, drop);
}
