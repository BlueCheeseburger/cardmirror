/**
 * Handing a document's FILE to another app by dragging: the cloud / computer
 * badge in each pane's footer (and the single window's footer) and the blue
 * title bar over the document are drag handles. Drop one into Slack, Mail,
 * Teams, Finder or Explorer and the OS receives the saved file — the
 * cross-platform counterpart of the macOS title-bar proxy icon (which Windows
 * and Linux lack).
 *
 * Desktop only: the web build has no file paths, so nothing is draggable there
 * (and on a packaged shell too old to start a native drag). What travels is the
 * file as saved, so a document with no file on disk has nothing to hand out.
 *
 * The drag itself is Electron's `webContents.startDrag`, requested over IPC
 * (`host:drag-file-out` in main.ts) while the mouse button is still down: from
 * the element's own `dragstart` (`installFileDragSource`), or — for a pane's
 * title bar, whose own pointer drag moves the document between panes — once
 * that gesture leaves the window (`startNativeFileDrag`). The folder mark below
 * doubles as the drag icon (Windows insists on one).
 */

/** The folder mark from logo.png, wordmark cropped off, background
 *  transparent, 48px — the drag icon. Recipe
 *  (Pillow): bounding box by color SATURATION so the black wordmark
 *  never counts, flood-fill the white corners to transparent, drop any
 *  leftover grey, square canvas, LANCZOS to 48px. */
export const FILE_MARK_DATA_URL =
  'data:image/png;base64,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';

export interface FileDragHost {
  /** False on a packaged shell whose preload predates the drag surface. */
  canDragFileOut(): boolean;
  dragFileOut(path: string, iconDataUrl: string): void;
  showItemInFolder?(path: string): Promise<void>;
}

/** The absolute path a document handle stands for on desktop, or null when it
 *  has no file on disk (untitled, a recovered draft) or isn't a path (a web
 *  file handle). */
export function filePathOf(handle: unknown): string | null {
  return typeof handle === 'string' && handle.length > 0 ? handle : null;
}

/** Start the OS-level drag of `path`. False when this host can't. */
export function startNativeFileDrag(host: FileDragHost | null, path: string | null): boolean {
  if (!host || !path || !host.canDragFileOut()) return false;
  host.dragFileOut(path, FILE_MARK_DATA_URL);
  return true;
}

/** Make `el` hand its document's file to other apps when dragged. `getPath`
 *  is asked at drag time, so it always reflects the current document; with no
 *  path (or no desktop host) the drag is simply refused. Returns a disposer. */
export function installFileDragSource(
  el: HTMLElement,
  getPath: () => string | null,
  getHost: () => FileDragHost | null,
): () => void {
  el.draggable = true;
  const onDragStart = (e: DragEvent): void => {
    // Electron: cancel the DOM drag and start the native one from here.
    e.preventDefault();
    startNativeFileDrag(getHost(), getPath());
  };
  el.addEventListener('dragstart', onDragStart);
  return () => {
    el.removeEventListener('dragstart', onDragStart);
    el.draggable = false;
  };
}
