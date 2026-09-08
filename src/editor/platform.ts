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

/** Finder cosmetic quirk, display-only: classic Mac OS used ":" as its
 *  path separator, and macOS still stores a filename that way on disk
 *  whenever a user types a literal "/" into it in Finder (APFS/HFS+'s
 *  own separator) — Finder translates ":" back to "/" for display, but
 *  a raw filename read off disk (as every open/recent/chip label in
 *  this app is) still has the colon. Field report, 2026-09-09: a file
 *  Finder shows as "1nc-9/8.docx" appeared in CardMirror's chip as
 *  "1nc-9:8.docx". Apply the same translation wherever a filename is
 *  shown to the user, so it reads the same as Finder — NEVER to an
 *  actual path/handle used for file I/O, which must keep the real
 *  on-disk (colon) form. No-op off macOS, where this quirk doesn't
 *  exist. */
export function displayFilename(name: string): string {
  return isMacPlatform() ? name.replace(/:/g, '/') : name;
}
