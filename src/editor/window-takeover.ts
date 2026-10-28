/**
 * A full-window tool (Compare documents) taking over the window it opens
 * over. While it is up the window is named after the tool instead of the
 * document underneath (an Untitled starter, say), and documents are not
 * opened into it: they go to a new window, and the desktop's "which
 * window?" chooser leaves the window out. The title code and the open
 * routing in `index.ts` read this; a name the user gave the window still
 * wins over the tool's.
 *
 * Takeovers stack: the most recent one names the window, and each one
 * hands back its own release, so two overlapping owners can't clear each
 * other.
 */

const stack: Array<{ title: string }> = [];
const listeners = new Set<() => void>();

/** The name the current takeover gives the window, or null when none is up. */
export function currentTakeoverTitle(): string | null {
  return stack.length > 0 ? stack[stack.length - 1]!.title : null;
}

/** Whether a takeover is up (documents must not open into this window). */
export function isTakenOver(): boolean {
  return stack.length > 0;
}

/** Take the window over until the returned function is called (safe to call twice). */
export function enterTakeover(title: string): () => void {
  const entry = { title };
  stack.push(entry);
  notify();
  return () => {
    const i = stack.indexOf(entry);
    if (i === -1) return;
    stack.splice(i, 1);
    notify();
  };
}

/** Called whenever a takeover starts or ends. Returns an unsubscribe. */
export function onTakeoverChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}
