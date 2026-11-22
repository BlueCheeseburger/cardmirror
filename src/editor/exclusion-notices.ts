/**
 * The two popups for file search folders and exclusions that overlap.
 *
 *   - Adding a search folder that sits INSIDE an excluded folder: the search
 *     folder is searched anyway (the more specific entry wins, see
 *     `isPathExcluded`), and the rest of the excluded folder stays hidden.
 *   - Adding an exclusion that CONTAINS a search folder: the same rule, from the
 *     other side. The search folder keeps being searched.
 *
 * Either way the user is told what will happen and can back out.
 */

import { exclusionContaining, searchFoldersInside } from './file-search.js';
import { settings } from './settings.js';
import { showConfirm, type ConfirmOptions } from './confirm-dialog.js';

/** The last part of a path, for naming a folder in a sentence. */
export function folderName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const last = trimmed.split(/[\\/]/).pop();
  return last || trimmed || p;
}

/** “A”, “A” and “B”, “A”, “B” and “C”, “A”, “B”, “C” and 2 more. */
function nameList(paths: readonly string[]): string {
  const names = paths.map((p) => `“${folderName(p)}”`);
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]}, ${names[2]} and ${names.length - 3} more`;
}

/** The popup for a search folder added inside an excluded folder. */
export function rootInsideExclusionPrompt(folder: string, exclusion: string): ConfirmOptions {
  const inner = `“${folderName(folder)}”`;
  const outer = `“${folderName(exclusion)}”`;
  return {
    title: 'This folder is inside an excluded folder',
    message:
      `${inner} is inside ${outer}, which you excluded from file search.\n\n` +
      `Everything else in ${outer} stays hidden, but ${inner} and its subfolders will be searched.\n\n` +
      'You can change the exclusion under Settings → Files → File search.',
    confirmLabel: 'Search this folder',
    cancelLabel: 'Don’t add',
  };
}

/** The popup for an exclusion added around one or more search folders. */
export function exclusionAroundRootsPrompt(exclusion: string, roots: readonly string[]): ConfirmOptions {
  const outer = `“${folderName(exclusion)}”`;
  const one = roots.length === 1;
  return {
    title: 'This folder contains a search folder',
    message:
      `${outer} contains ${one ? 'a folder' : `${roots.length} folders`} you search: ${nameList(roots)}.\n\n` +
      `${one ? 'It' : 'They'} and ${one ? 'its' : 'their'} subfolders will still be searched; ` +
      `everything else in ${outer} will be hidden.`,
    confirmLabel: 'Exclude',
    cancelLabel: 'Cancel',
  };
}

/** Before adding `folder` to the search folders: ask when it sits inside an
 *  exclusion. Resolves true to go ahead (also when there is nothing to say). */
export async function confirmSearchFolder(folder: string): Promise<boolean> {
  const exclusion = exclusionContaining(folder, settings.get('fileSearchExclusions'));
  if (exclusion === null) return true;
  return showConfirm(rootInsideExclusionPrompt(folder, exclusion));
}

/** Before adding `entry` to the exclusions: ask when it contains search folders. */
export async function confirmExclusion(entry: string): Promise<boolean> {
  const roots = searchFoldersInside(entry, settings.get('fileSearchRoots'));
  if (roots.length === 0) return true;
  return showConfirm(exclusionAroundRootsPrompt(entry, roots));
}
