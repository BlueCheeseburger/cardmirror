/**
 * A window's custom name (ribbon right-click → Name This Window…) is kept in the
 * main process, keyed by window id, and the renderer asks for it at boot. A
 * window that is created WITH a name (a window reopened from the Last workspace,
 * or one a document was moved to) has it set here, before its renderer starts,
 * so every layout picks it up the same way. Pure, so the rule is testable.
 */

/** The name to keep for `name`: trimmed, or null for anything that is not a
 *  non-blank string (which clears the name). */
export function normalizeWindowName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed || null;
}
