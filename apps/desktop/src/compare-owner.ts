/**
 * Opening a file that a window with Compare documents already owns does not
 * focus that window (it shows the tool, not the document): the file opens in an
 * editor of its own, and the new window takes over the path claim. The claimer
 * is told which Compare window held it, so it can say the file is also open
 * there. Pure, so the rule is testable without Electron.
 */

/** The window id to mention when `claimer` takes a path from `previousOwner`: the
 *  previous owner when it is a different window that has Compare documents up,
 *  else undefined (no previous owner, the claimer re-claiming its own file as a
 *  Reload From Disk does, or an ordinary editor window). */
export function compareWindowToNotify(
  previousOwner: number | undefined,
  claimer: number,
  takenOver: ReadonlySet<number>,
): number | undefined {
  if (previousOwner === undefined || previousOwner === claimer) return undefined;
  return takenOver.has(previousOwner) ? previousOwner : undefined;
}
