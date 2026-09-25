/**
 * Resizable image NodeView — gives editor images Word-style resize
 * handles. The image node stays an inline atom whose size is carried
 * by the existing `widthEmu` / `heightEmu` attrs (English Metric
 * Units, 9525 EMU per CSS pixel), so a resize round-trips straight to
 * the `.docx` `<wp:extent>` on export with no new metadata added to
 * the schema.
 *
 * The inner element is rendered by the schema's own `toDOM` (an
 * `<img>` for renderable formats, a placeholder `<span>` for EMF /
 * WMF / TIFF), so this view adds only a thin wrapper plus handles.
 * Handles are created lazily on selection and removed on deselect, so
 * an unselected image costs one extra wrapper span and nothing more —
 * keeping large multi-image documents light.
 */

import { DOMSerializer } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { NodeSelection } from 'prosemirror-state';
import { settings } from './settings.js';
import { transclusionNodeViews } from './transclusion-nodeview.js';
import { selfRefNodeViews } from './self-transclusion-nodeview.js';
import { TEXT_COLUMN_PX, buildImageNodeFromBlob, pickImageFile } from './image-insert.js';
import { editAltText } from './image-context-menu-plugin.js';
import { showToast } from './toast.js';

const EMU_PER_PX = 9525;
const MIN_PX = 16;

/**
 * Eight handles, all proportional like Google Docs (fork, 2026-09-25):
 * a corner follows the horizontal drag, a side edge (e / w) the
 * horizontal and a top or bottom edge (n / s) the vertical, and the
 * other side always follows the image's shape. There's no stretching.
 * `renderInner` pins the image's width AND height to the stored EMU
 * dimensions (overriding the schema's responsive `height: auto`), so
 * what you drag is exactly what exports. Handles are created only
 * while the image is selected, so unselected images carry no handle DOM.
 */
const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Dir = (typeof HANDLE_DIRS)[number];

/** Accumulated CSS `zoom` up the ancestor chain (editor panes zoom via
 *  the `zoom` property). Lets us convert screen-space pointer deltas
 *  into the element's own CSS pixels regardless of zoom level. */
function zoomFactorOf(el: HTMLElement): number {
  let z = 1;
  let n: HTMLElement | null = el;
  while (n) {
    const cz = parseFloat(getComputedStyle(n).zoom);
    if (Number.isFinite(cz) && cz > 0) z *= cz;
    n = n.parentElement;
  }
  return z > 0 ? z : 1;
}

/**
 * The new size for dragging handle `dir` by (`dx`, `dy`) CSS px from a
 * `startW`×`startH` image, keeping its proportions. Corners and the
 * e / w edges follow the horizontal drag; n / s follow the vertical.
 * Handles on the left or top grow the image when dragged outward
 * (left or up). Never smaller than `MIN_PX` on either side.
 */
export function proportionalResize(
  dir: Dir,
  startW: number,
  startH: number,
  dx: number,
  dy: number,
): { width: number; height: number } {
  const aspect = startW / startH;
  const west = dir === 'nw' || dir === 'w' || dir === 'sw';
  let w: number;
  if (dir === 'n' || dir === 's') {
    const h = dir === 's' ? startH + dy : startH - dy;
    w = h * aspect;
  } else {
    w = west ? startW - dx : startW + dx;
  }
  // Floor whichever side is smaller at MIN_PX.
  const minW = aspect >= 1 ? MIN_PX * aspect : MIN_PX;
  w = Math.max(minW, w);
  return { width: w, height: w / aspect };
}

/** One toolbar button: its label, tooltip, and whether it's enabled. */
interface ToolbarButton {
  label: string;
  title: string;
  disabled?: boolean;
  /** Shown pressed (the image is already this size). */
  active?: boolean;
  run: () => void;
}

class ImageResizeView implements NodeView {
  readonly dom: HTMLElement;
  private inner!: HTMLElement;
  private node: PMNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private handles: HTMLElement[] = [];
  private toolbar: HTMLElement | null = null;
  /** The picture's own pixel size, cached per `data`: every re-render
   *  makes a fresh `<img>` that reads 0×0 until it decodes, and the
   *  toolbar's size buttons shouldn't flicker off after each resize. */
  private natural: { data: string; width: number; height: number } | null = null;
  private dragging = false;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement('span');
    this.dom.className = 'pmd-image-wrap';
    this.renderInner();
  }

  /** Render (or re-render) the schema's `<img>` / placeholder into the
   *  wrapper, then pin its display size to the stored EMU dimensions so
   *  an aspect-unlocked edge resize is WYSIWYG (the schema's default
   *  `height: auto` would otherwise snap the image back to its natural
   *  ratio, hiding a one-axis stretch). */
  private renderInner(): void {
    const spec = this.node.type.spec.toDOM?.(this.node);
    if (!spec) return;
    const { dom } = DOMSerializer.renderSpec(document, spec);
    const el = dom as HTMLElement;
    const widthEmu = Number(this.node.attrs['widthEmu'] ?? 0);
    const heightEmu = Number(this.node.attrs['heightEmu'] ?? 0);
    if (widthEmu > 0 && heightEmu > 0) {
      el.style.width = `${Math.round(widthEmu / EMU_PER_PX)}px`;
      el.style.height = `${Math.round(heightEmu / EMU_PER_PX)}px`;
      // Honor the explicit height (don't let the schema's `height: auto`
      // re-lock the aspect) and show the true set size like Word does.
      el.style.maxWidth = 'none';
    }
    if (this.inner) this.inner.replaceWith(el);
    else this.dom.appendChild(el);
    this.inner = el;
    if (el instanceof HTMLImageElement) {
      this.readNatural(el);
      // Not decoded yet → pick the size up (and refresh the toolbar)
      // once it is.
      el.addEventListener(
        'load',
        () => {
          if (this.readNatural(el) && this.toolbar) this.renderToolbar();
        },
        { once: true },
      );
    }
  }

  /** Cache `el`'s decoded size for the current `data`. True if known. */
  private readNatural(el: HTMLImageElement): boolean {
    if (el.naturalWidth > 0 && el.naturalHeight > 0) {
      this.natural = {
        data: String(this.node.attrs['data'] ?? ''),
        width: el.naturalWidth,
        height: el.naturalHeight,
      };
      return true;
    }
    return false;
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    // Skip re-render mid-drag: the live inline styles are authoritative
    // until the drag commits the new EMU dimensions.
    if (!this.dragging) this.renderInner();
    // A resize or replace keeps the image selected; refresh the
    // toolbar's pressed size button to match.
    if (this.toolbar) this.renderToolbar();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    if (settings.get('readMode') || !this.view.editable) return;
    this.addHandles();
    this.addToolbar();
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
    this.removeHandles();
    this.removeToolbar();
  }

  private addHandles(): void {
    if (this.handles.length) return;
    for (const dir of HANDLE_DIRS) {
      const h = document.createElement('span');
      h.className = `pmd-image-handle pmd-image-handle-${dir}`;
      // Grabbing a handle resizes; it must never start a move-drag.
      h.draggable = false;
      h.addEventListener('pointerdown', (e) => this.startResize(e, dir));
      this.dom.appendChild(h);
      this.handles.push(h);
    }
  }

  private removeHandles(): void {
    for (const h of this.handles) h.remove();
    this.handles = [];
  }

  // ------------------------------------------------------ Toolbar ----

  /** The Google Docs-style bar under a selected image: size presets,
   *  alt text, replace, delete. */
  private addToolbar(): void {
    if (this.toolbar) return;
    const bar = document.createElement('span');
    bar.className = 'pmd-image-toolbar';
    bar.contentEditable = 'false';
    bar.draggable = false;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Image');
    // Keep the editor's focus and the image selected through a click.
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    this.toolbar = bar;
    this.renderToolbar();
    this.dom.appendChild(bar);
  }

  private removeToolbar(): void {
    this.toolbar?.remove();
    this.toolbar = null;
  }

  private renderToolbar(): void {
    const bar = this.toolbar;
    if (!bar) return;
    bar.replaceChildren();
    const natural = this.naturalSize();
    const cur = this.currentSize();
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
    const scale = (pct: number): ToolbarButton => {
      const w = natural ? Math.round((natural.width * pct) / 100) : 0;
      return {
        label: pct === 100 ? 'Original size' : `${pct}%`,
        title: natural
          ? `${pct}% of the image's original size (${w} × ${Math.round((natural.height * pct) / 100)} px)`
          : "This image's original size isn't known",
        disabled: !natural,
        active: !!natural && !!cur && near(cur.width, w),
        run: () => natural && this.setSize(w, (natural.height * pct) / 100),
      };
    };
    const aspect = natural ? natural.width / natural.height : cur ? cur.width / cur.height : 0;
    const groups: ToolbarButton[][] = [
      [scale(25), scale(50), scale(75), scale(100)],
      [
        {
          label: 'Fit width',
          title: 'As wide as the page (6.5 in)',
          disabled: !aspect,
          active: !!cur && near(cur.width, TEXT_COLUMN_PX),
          run: () => aspect && this.setSize(TEXT_COLUMN_PX, TEXT_COLUMN_PX / aspect),
        },
      ],
      [
        {
          label: 'Alt text',
          title: 'Describe the image for screen readers',
          run: () => this.editAlt(),
        },
        {
          label: 'Replace',
          title: 'Swap in another image at this width',
          run: () => void this.replace(),
        },
        {
          label: 'Delete',
          title: 'Remove the image',
          run: () => this.remove(),
        },
      ],
    ];
    groups.forEach((group, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'pmd-image-toolbar-sep';
        bar.appendChild(sep);
      }
      for (const b of group) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pmd-image-toolbar-btn';
        btn.textContent = b.label;
        btn.title = b.title;
        btn.draggable = false;
        if (b.disabled) btn.disabled = true;
        if (b.active) {
          btn.classList.add('pmd-active');
          btn.setAttribute('aria-pressed', 'true');
        }
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!b.disabled) b.run();
        });
        bar.appendChild(btn);
      }
    });
  }

  /** The image's own pixel size, or null for a placeholder format or
   *  one that hasn't decoded. */
  private naturalSize(): { width: number; height: number } | null {
    if (this.inner instanceof HTMLImageElement) this.readNatural(this.inner);
    const n = this.natural;
    // A replaced picture's old size doesn't count.
    if (!n || n.data !== String(this.node.attrs['data'] ?? '')) return null;
    return { width: n.width, height: n.height };
  }

  /** The stored display size in CSS px, or null when unset. */
  private currentSize(): { width: number; height: number } | null {
    const w = Number(this.node.attrs['widthEmu'] ?? 0);
    const h = Number(this.node.attrs['heightEmu'] ?? 0);
    if (w <= 0 || h <= 0) return null;
    return { width: w / EMU_PER_PX, height: h / EMU_PER_PX };
  }

  private setSize(wPx: number, hPx: number): void {
    this.commit(Math.round(wPx), Math.max(1, Math.round(hPx)));
  }

  private editAlt(): void {
    const pos = this.getPos();
    if (pos == null) return;
    void editAltText(this.view, pos, this.node);
  }

  private remove(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const live = this.view.state.doc.nodeAt(pos);
    if (!live || live.type.name !== 'image') return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + live.nodeSize));
    this.view.focus();
  }

  /** Pick a new image file and put it in this one's place, keeping the
   *  current width (height follows the new image's shape). Alt text is
   *  cleared, since it described the old picture. */
  private async replace(): Promise<void> {
    const file = await pickImageFile();
    if (!file) return;
    const fresh = await buildImageNodeFromBlob(file);
    if (!fresh) {
      showToast(`Couldn't read "${file.name}" as an image.`);
      return;
    }
    // The picker is modal-ish; the doc may have moved on meanwhile.
    const pos = this.getPos();
    if (pos == null) return;
    const live = this.view.state.doc.nodeAt(pos);
    if (!live || live.type.name !== 'image') return;
    const keepW = Number(live.attrs['widthEmu'] ?? 0);
    const newW = Number(fresh.attrs['widthEmu'] ?? 0);
    const newH = Number(fresh.attrs['heightEmu'] ?? 0);
    const attrs = { ...fresh.attrs };
    if (keepW > 0 && newW > 0 && newH > 0) {
      attrs['widthEmu'] = keepW;
      attrs['heightEmu'] = Math.round((keepW * newH) / newW);
    }
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...live.attrs, ...attrs, alt: '' });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    this.view.dispatch(tr);
  }

  private startResize(e: PointerEvent, dir: Dir): void {
    e.preventDefault();
    e.stopPropagation();

    const z = zoomFactorOf(this.inner);
    const rect = this.inner.getBoundingClientRect();
    const startW = rect.width / z;
    const startH = rect.height / z;
    if (startW < 1 || startH < 1) return;
    const startX = e.clientX;
    const startY = e.clientY;

    this.dragging = true;
    const prevMaxWidth = this.inner.style.maxWidth;
    // Let the image grow past the container width while dragging.
    this.inner.style.maxWidth = 'none';
    const handle = e.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }

    let w = startW;
    let h = startH;

    const onMove = (ev: PointerEvent): void => {
      const dx = (ev.clientX - startX) / z;
      const dy = (ev.clientY - startY) / z;
      const next = proportionalResize(dir, startW, startH, dx, dy);
      w = next.width;
      h = next.height;
      this.inner.style.width = `${Math.round(w)}px`;
      this.inner.style.height = `${Math.round(h)}px`;
    };

    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      this.dragging = false;
      this.inner.style.maxWidth = prevMaxWidth;
      this.commit(Math.round(w), Math.round(h));
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  /** Write the new pixel dimensions back to the node as EMU. */
  private commit(wPx: number, hPx: number): void {
    const pos = this.getPos();
    if (pos == null) return;
    const live = this.view.state.doc.nodeAt(pos);
    if (!live || live.type.name !== 'image') return;
    const widthEmu = Math.max(0, Math.round(wPx * EMU_PER_PX));
    const heightEmu = Math.max(0, Math.round(hPx * EMU_PER_PX));
    if (live.attrs['widthEmu'] === widthEmu && live.attrs['heightEmu'] === heightEmu) {
      this.renderInner();
      return;
    }
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...live.attrs,
      widthEmu,
      heightEmu,
    });
    // Keep the image selected after the resize so its handles stay up
    // for a follow-up drag (Word keeps the selection too).
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    this.view.dispatch(tr);
  }

  /** Keep PM out of the handle-drag gestures; ordinary clicks on the
   *  image itself still fall through so it selects normally. */
  stopEvent(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    if (t?.classList?.contains('pmd-image-handle')) return true;
    // Toolbar clicks are the toolbar's, not a click into the doc (which
    // would deselect the image and tear the toolbar down mid-click).
    return !!(this.toolbar && t && this.toolbar.contains(t));
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.removeHandles();
    this.removeToolbar();
  }
}

/** NodeView map shared by every editor surface (single-doc + panes). */
export const editorNodeViews = {
  image: (
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): NodeView => new ImageResizeView(node, view, getPos),
  ...transclusionNodeViews,
  ...selfRefNodeViews,
};
