/**
 * Image drag and drop (fork, 2026-09-25).
 *
 * - Image files dragged in from the computer land where they're
 *   dropped (every image file, in order), shrunk to the page width if
 *   they're wider, like pasting one. Doc files (.cmir / .docx) never
 *   get here on desktop: `installDragToOpen` in index.ts takes those in
 *   the capture phase and opens them.
 * - An image already in the doc can be dragged to a new spot. That's
 *   ProseMirror's own node drag; this module only decides which
 *   `dragstart`s may reach it (see `allowImageDragStart`), since the
 *   editor otherwise swallows every native drag.
 */

import { NodeSelection, Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { buildImageNodeFromBlob, insertImageNodesAt } from './image-insert.js';
import { showToast } from './toast.js';

/**
 * Whether a `dragstart` is the start of moving an image (let it
 * through to ProseMirror) rather than a text drag (still blocked).
 * Only a drag that begins on the picture itself counts, not on a
 * resize handle or the toolbar, and only while the doc is editable.
 * The image becomes the whole selection first, so a drag that starts
 * on an image inside a larger text selection moves just the image.
 */
export function allowImageDragStart(view: EditorView, event: DragEvent): boolean {
  if (!view.editable) return false;
  const t = event.target as HTMLElement | null;
  const wrap = t?.closest?.<HTMLElement>('.pmd-image-wrap');
  if (!wrap || t!.closest('.pmd-image-handle, .pmd-image-toolbar')) return false;
  let pos: number;
  try {
    pos = view.posAtDOM(wrap, 0);
  } catch {
    return false;
  }
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'image') return false;
  const sel = view.state.selection;
  if (!(sel instanceof NodeSelection && sel.from === pos)) {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  }
  return true;
}

function imageFilesOf(event: DragEvent): File[] {
  return Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
}

export const imageDropPlugin: Plugin = new Plugin({
  props: {
    handleDrop(view, event) {
      const e = event as DragEvent;
      // An in-editor drag (moving an image) is ProseMirror's to handle.
      if (view.dragging) return false;
      const files = imageFilesOf(e);
      if (files.length === 0) return false;
      if (!view.editable) return true;
      const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!at) return true;
      const pos = at.pos;
      void (async () => {
        const nodes = (await Promise.all(files.map((f) => buildImageNodeFromBlob(f)))).filter(
          (n): n is PMNode => n != null,
        );
        if (nodes.length === 0) {
          showToast(files.length === 1 ? `Couldn't read "${files[0]!.name}" as an image.` : "Couldn't read those images.");
          return;
        }
        if (!insertImageNodesAt(view, pos, nodes)) {
          showToast('Drop images into a card, paragraph or heading.');
          return;
        }
        view.focus();
      })();
      return true;
    },
  },
});
