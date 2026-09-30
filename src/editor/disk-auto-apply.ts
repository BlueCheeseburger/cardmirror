/**
 * Auto-apply a changed-on-disk file to a document with no unsaved edits.
 *
 * The amber "Changed on disk" pill (disk-conflict.ts) used to be the only
 * outcome of someone else's save landing on a file you have open. When
 * YOUR copy is clean there is nothing to decide, so the new contents are
 * patched into the open document instead: only the span that differs is
 * replaced, so the caret, the scroll position and the undo history
 * survive, and the patch is neither dirty nor autosaved (writing identical
 * content back would only make the other person's window see a change).
 *
 * Everything that makes this unsafe leaves the pill alone (`skipped`) or
 * waits (`deferred`): unsaved edits, read mode or the timer pop-out, a
 * co-editing session, a document holding live views / linked copies,
 * mid-composition typing, a file that no longer parses. The merge of
 * unsaved edits with the new file is a separate, later step.
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { fromDocxFull, parseNative } from '../index.js';
import { getElectronHost } from './host/index.js';
import { maybeDecryptForOpen, OpenCancelledError } from './open-encrypted.js';
import { loadThreads, type Thread } from './comments-plugin.js';

/** Transaction meta marking a doc change that came from the file on disk:
 *  the dispatchers skip the dirty flag, the autosave and the journal. */
export const DISK_SYNC_META = 'pmd-disk-sync';

export type AutoApplyOutcome =
  | 'applied' // the open document now matches the file
  | 'unchanged' // the file's content equals the open document (a sync client touched it)
  | 'deferred' // read mode / timer: try again when it clears
  | 'skipped'; // leave the pill (unsaved edits, session, live links, unreadable file)

export interface AutoApplyTarget {
  view: EditorView;
  format: 'cmir' | 'docx' | null;
  isDirty: () => boolean;
  /** Read mode or the timer pop-out is up — never change the doc mid-speech. */
  isSuppressed: () => boolean;
  /** Part of a co-editing session (host or guest). */
  inSession: () => boolean;
  /** Holds live views or linked copies (the file can't represent them). */
  hasLiveLinks: () => boolean;
  /** Clear dirty / edit-generation state after the patch. */
  markClean: () => void;
  /** Re-claim the file as the change-detection baseline. */
  claimBaseline: () => Promise<void>;
}

export interface DiskDoc {
  doc: PMNode;
  threads: Thread[] | undefined;
}

/** Read and parse the file at `handle`, or null when it can't be read. */
export async function readDiskDoc(handle: string): Promise<DiskDoc | null> {
  const electron = getElectronHost();
  if (!electron) return null;
  const file = await electron.readFileAtPath(handle);
  if (!file) return null;
  const bytes = await maybeDecryptForOpen(file.bytes, file.name);
  if (file.format === 'docx') {
    const result = await fromDocxFull(bytes);
    return { doc: result.doc, threads: result.threads };
  }
  const parsed = parseNative(bytes);
  return { doc: parsed.doc, threads: parsed.threads.length > 0 ? parsed.threads : undefined };
}

/** Replace only the span of `view`'s document that differs from `next`
 *  (common prefix and suffix are left untouched), as a non-history,
 *  non-dirtying transaction. Returns false when the documents already
 *  match. Falls back to replacing everything if the narrow patch doesn't
 *  reproduce `next` exactly. */
export function patchViewToDoc(view: EditorView, next: PMNode): boolean {
  const prev = view.state.doc;
  const start = prev.content.findDiffStart(next.content);
  if (start == null) return false;
  const ends = prev.content.findDiffEnd(next.content);
  let endA = ends ? ends.a : prev.content.size;
  let endB = ends ? ends.b : next.content.size;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  let tr = view.state.tr.replace(start, endA, next.slice(start, endB));
  if (!tr.doc.eq(next)) {
    tr = view.state.tr.replaceWith(0, prev.content.size, next.content);
  }
  view.dispatch(tr.setMeta('addToHistory', false).setMeta(DISK_SYNC_META, true));
  return true;
}

/** Try to bring the open document up to date with the file at `handle`. */
export async function autoApplyDiskChange(handle: string, target: AutoApplyTarget): Promise<AutoApplyOutcome> {
  const { view } = target;
  if (view.isDestroyed) return 'skipped';
  if (target.isDirty() || target.inSession() || target.hasLiveLinks() || view.composing) return 'skipped';
  if (target.isSuppressed()) return 'deferred';

  let disk: DiskDoc | null;
  try {
    disk = await readDiskDoc(handle);
  } catch (err) {
    if (!(err instanceof OpenCancelledError)) console.warn('Auto-apply: could not read the changed file:', err);
    return 'skipped';
  }
  if (!disk) return 'skipped';

  // The read was async: re-check everything that could have changed.
  if (view.isDestroyed || target.isDirty() || target.inSession() || target.hasLiveLinks() || view.composing) {
    return 'skipped';
  }
  if (target.isSuppressed()) return 'deferred';

  let changed = false;
  try {
    changed = patchViewToDoc(view, disk.doc);
    if (disk.threads) view.dispatch(loadThreads(view.state, disk.threads));
  } catch (err) {
    console.warn('Auto-apply: patching the document failed:', err);
    return 'skipped';
  }
  target.markClean();
  await target.claimBaseline();
  return changed ? 'applied' : 'unchanged';
}
