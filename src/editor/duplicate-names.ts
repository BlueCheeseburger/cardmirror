/**
 * Same-name disambiguation for the pane chips.
 *
 * Two open docs can share a filename (same name in different folders, or
 * one stacked behind the other in a slot). The chip only shows the name,
 * so the docs look identical. When a name is shared by 2+ open docs in
 * the window, each of them shows its full path in small text beside the
 * name; unique names stay clean.
 */

export interface NamedDoc {
  uid: string;
  filename: string;
  handle: unknown;
}

/** Case-insensitive, matching how the OS treats names on Windows/macOS. */
function nameKey(filename: string): string {
  return filename.trim().toLowerCase();
}

/** uid → path to show, for every doc whose name is shared with another
 *  doc in `docs`. Docs with no on-disk path (never saved) are omitted:
 *  there is nothing to show for them. */
export function duplicateNamePaths(docs: NamedDoc[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(nameKey(d.filename), (counts.get(nameKey(d.filename)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const d of docs) {
    if ((counts.get(nameKey(d.filename)) ?? 0) < 2) continue;
    if (typeof d.handle === 'string' && d.handle) out.set(d.uid, d.handle);
  }
  return out;
}
