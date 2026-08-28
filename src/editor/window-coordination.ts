/**
 * Web cross-window coordination over BroadcastChannel — the browser-edition
 * counterpart to the Electron main process, which the desktop build uses as its
 * coordination hub.
 *
 * One persistent channel per window (opened by `installWindowCoordination` at
 * boot) tracks live peers and answers the **same-file query** (duplicate-open
 * guard): a window about to open a file asks whether any other window already
 * has it open, answered via `FileSystemFileHandle.isSameEntry` — the web
 * analogue of Electron's `openPathCheck`.
 *
 * Design notes:
 *  - A BroadcastChannel delivers to every OTHER instance of the same channel
 *    name — including other instances in the SAME window — so every handler
 *    ignores messages stamped with its own `WINDOW_ID`.
 *  - Live-peer tracking (`hello`/`here`/`bye`) lets same-file checks short-circuit
 *    instantly when this window is alone.
 *  - Everything degrades to a graceful no-op where BroadcastChannel is absent.
 */

import { getElectronHost } from './host/index.js';

const CHANNEL_NAME = 'pmd-window-coord';

/** Stable identity for THIS window, for the session. Shared across every channel
 *  instance this module opens in this window, so a window recognizes — and
 *  ignores — its own broadcasts. */
const WINDOW_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `w${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e9)}`;

type CoordMsg =
  | { kind: 'coord:hello'; from: string }
  | { kind: 'coord:here'; from: string }
  | { kind: 'coord:bye'; from: string }
  | { kind: 'file-open:query'; from: string; nonce: string; handle: unknown }
  | { kind: 'file-open:hit'; from: string; nonce: string };

function makeChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(CHANNEL_NAME)
      : null;
  } catch {
    return null;
  }
}

/** Cap on waiting for a same-file answer (only paid when peers exist AND none
 *  claims the file — the alone case short-circuits). */
const FILE_QUERY_MS = 300;

/** IDs of the other windows we currently believe are open. Maintained by the
 *  persistent coordination channel via hello/here/bye. */
const livePeers = new Set<string>();

/** Whether any other window is (believed to be) open. */
export function hasPeers(): boolean {
  return livePeers.size > 0;
}

function hasIsSameEntry(h: unknown): h is FileSystemFileHandle {
  return (
    !!h &&
    typeof (h as { isSameEntry?: unknown }).isSameEntry === 'function'
  );
}

async function respondToFileQuery(
  ch: BroadcastChannel,
  getOpenHandles: () => unknown[],
  msg: Extract<CoordMsg, { kind: 'file-open:query' }>,
): Promise<void> {
  for (const h of getOpenHandles()) {
    if (!hasIsSameEntry(h)) continue;
    try {
      if (await h.isSameEntry(msg.handle as FileSystemFileHandle)) {
        ch.postMessage({ kind: 'file-open:hit', from: WINDOW_ID, nonce: msg.nonce } satisfies CoordMsg);
        return;
      }
    } catch {
      /* ignore a handle we can't compare */
    }
  }
}

/**
 * Install the persistent coordination channel (once, at boot, on the browser
 * host only — Electron coordinates through main). Tracks live peers and answers
 * same-file queries. `getOpenHandles` returns the file handles this window
 * currently has open (for the duplicate-open guard).
 */
export function installWindowCoordination(hooks: {
  getOpenHandles: () => unknown[];
}): void {
  if (getElectronHost()) return; // desktop coordinates through main
  const ch = makeChannel();
  if (!ch) return;
  ch.addEventListener('message', (e: MessageEvent<CoordMsg>) => {
    const msg = e.data;
    if (!msg || msg.from === WINDOW_ID) return; // ignore our own broadcasts
    switch (msg.kind) {
      case 'coord:hello':
        livePeers.add(msg.from);
        ch.postMessage({ kind: 'coord:here', from: WINDOW_ID } satisfies CoordMsg);
        break;
      case 'coord:here':
        livePeers.add(msg.from);
        break;
      case 'coord:bye':
        livePeers.delete(msg.from);
        break;
      case 'file-open:query':
        void respondToFileQuery(ch, hooks.getOpenHandles, msg);
        break;
      default:
        break; // 'file-open:hit' is collected in its query
    }
  });
  // Announce ourselves and learn who's already here.
  ch.postMessage({ kind: 'coord:hello', from: WINDOW_ID } satisfies CoordMsg);
  // Best-effort departure notice so peers prune us promptly.
  window.addEventListener('pagehide', () => {
    try {
      ch.postMessage({ kind: 'coord:bye', from: WINDOW_ID } satisfies CoordMsg);
    } catch {
      /* ignore */
    }
  });
}

/**
 * Duplicate-open guard: does any OTHER window already have this file open?
 * Broadcasts the handle and resolves true if a peer answers that it matches one
 * of its open docs (via `isSameEntry`). Short-circuits to false when this window
 * is alone or the handle isn't comparable.
 */
export async function webIsFileOpenElsewhere(handle: unknown): Promise<boolean> {
  if (!hasIsSameEntry(handle) || !hasPeers()) return false;
  const channel = makeChannel();
  if (!channel) return false;
  const nonce =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : String(Math.random());
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      channel.removeEventListener('message', onMsg);
      channel.close();
      resolve(result);
    };
    const onMsg = (e: MessageEvent<CoordMsg>): void => {
      const msg = e.data;
      if (msg?.kind === 'file-open:hit' && msg.nonce === nonce && msg.from !== WINDOW_ID) {
        finish(true);
      }
    };
    channel.addEventListener('message', onMsg);
    channel.postMessage({
      kind: 'file-open:query',
      from: WINDOW_ID,
      nonce,
      handle,
    } satisfies CoordMsg);
    window.setTimeout(() => finish(false), FILE_QUERY_MS);
  });
}

/**
 * Whether `handle` is already open in another window — the duplicate-open guard.
 * Electron checks the main-process path registry (`openPathCheck`, string path
 * handles); web queries peer windows over BroadcastChannel (`isSameEntry`). A
 * second window editing the same file would race its save/autosave against the
 * first, so callers refuse the open when this returns true.
 */
export async function isFileOpenInAnotherWindow(handle: unknown): Promise<boolean> {
  const electron = getElectronHost();
  if (electron) {
    if (typeof handle === 'string' && handle) {
      const { takenByOther } = await electron.openPathCheck(handle);
      return takenByOther;
    }
    return false;
  }
  return webIsFileOpenElsewhere(handle);
}
