/**
 * The names in a pane's document list (the ▾ list on its title bar), shown
 * without the .docx / .cmir ending: a row reads "1NC Shell---GGSA", not
 * "1NC Shell---GGSA.docx". The ending stays on any name that would otherwise
 * look like another row's (the same file saved as both a .docx and a .cmir),
 * so two rows are never told apart by nothing at all.
 */

const KNOWN_EXT = /\.(cmir|docx)$/i;

/** `name` without its .cmir / .docx ending (anything else is left as it is). */
export function stripDocExtension(name: string): string {
  return name.replace(KNOWN_EXT, '');
}

/** The label for each name, in order. */
export function stackRowNames(names: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const n of names) {
    const stem = stripDocExtension(n);
    counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }
  return names.map((n) => {
    const stem = stripDocExtension(n);
    // Two rows with one stem but different endings keep the ending; rows with the
    // very same name are already told apart by their folder path in the list.
    const sameName = names.filter((m) => m === n).length;
    return (counts.get(stem) ?? 0) > sameName ? n : stem;
  });
}
