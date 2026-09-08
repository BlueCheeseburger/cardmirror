/**
 * Tiny platform-detection helpers with zero dependencies of their
 * own — kept separate from `ribbon-commands.ts` (which used to own
 * `isMacPlatform`) specifically so files further down the import
 * graph (`settings.ts`, and anything else `ribbon-commands.ts`
 * itself imports) can use them without a circular import back
 * through `ribbon-commands.ts`.
 */

/** True when running on macOS (renderer-side — `navigator.platform`
 *  is what's actually available here). */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '');
}

/** "Cmd" on macOS, "Ctrl" everywhere else — for user-facing prose
 *  that names the app's cross-platform modifier key by word instead
 *  of going through `formatKeyForDisplay`'s "Mod-" → "⌘"/"Ctrl+"
 *  substitution (settings descriptions, tooltips, dialog copy that
 *  isn't built from a raw PM keymap string). Evaluated once per call
 *  — cheap enough to call inline in a template literal wherever these
 *  strings are defined; the platform doesn't change mid-session. */
export function ctrlOrCmdWord(): 'Ctrl' | 'Cmd' {
  return isMacPlatform() ? 'Cmd' : 'Ctrl';
}
