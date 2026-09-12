/**
 * Drag a pane's title chip onto another pane to move that document
 * between slots — the pointer equivalent of the `sendDocToSlotN`
 * commands, and the discoverable one (those are unbound by default).
 *
 * Pointer events, not HTML5 drag-and-drop: the window already has a
 * file-drop handler wired to `dragover`/`drop`, and a chip drag that
 * rode the same channel would have to be told apart from a real file
 * mid-gesture. Pointer capture also keeps the drag alive over the
 * editors, which swallow plenty of mouse events of their own.
 *
 * The gesture starts only after the pointer travels `DRAG_THRESHOLD`
 * px, so the chip's other affordances — click to focus the pane,
 * double-click the name to rename — are untouched by it.
 *
 * This module owns the gesture; WHAT a slot is, and what moving a doc
 * into one means, stays in multi-pane-shell.ts behind these callbacks.
 */

/** How far the pointer must travel before this reads as a drag rather
 *  than a click. Roughly the platform convention (macOS uses ~4px,
 *  Windows 4-5), rounded up a touch because the chip is also a
 *  double-click target. */
const DRAG_THRESHOLD = 6;

export interface PaneChipDragOptions {
  /** Whether a drag may start at all right now (a doc is visible, the
   *  workspace isn't in expand mode, …). */
  canDrag: () => boolean;
  /** Text for the thing following the pointer. */
  label: () => string;
  /** Which slot is under this point, or null for "not a pane". */
  slotAtPoint: (x: number, y: number) => string | null;
  /** The gesture began: reveal empty slots as drop zones. */
  onDragStart: () => void;
  /** The gesture ended, for ANY reason (drop, Escape, cancel). Always
   *  runs, and always before `onDrop`, so the commit sees a cleaned-up
   *  layout rather than one still dressed for dragging. */
  onDragEnd: () => void;
  /** The hovered slot changed (null = not over a droppable slot). */
  onHover: (slotId: string | null) => void;
  /** Committed: move the dragged doc into this slot. */
  onDrop: (slotId: string) => void;
}

export interface PaneChipDragHandle {
  destroy(): void;
}

/** True while a chip drag is in progress anywhere in this window.
 *  Read by handlers that must stand down mid-gesture. */
let dragging = false;
export function isPaneChipDragging(): boolean {
  return dragging;
}

/** Make `chip` draggable onto another pane. */
export function installPaneChipDrag(
  chip: HTMLElement,
  opts: PaneChipDragOptions,
): PaneChipDragHandle {
  let startX = 0;
  let startY = 0;
  let pointerId: number | null = null;
  let active = false;
  let ghost: HTMLElement | null = null;
  let hovered: string | null = null;

  /** The chip's own controls (close, save, the stack switcher, the
   *  rename field) keep their clicks — a drag must not start on them. */
  function onControl(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      target.closest('button, input, textarea, select, a, [contenteditable="true"]') !== null
    );
  }

  function moveGhost(x: number, y: number): void {
    if (!ghost) return;
    // Offset so the label sits down-right of the cursor and never
    // under it — the drop target has to stay visible.
    ghost.style.transform = `translate(${x + 14}px, ${y + 12}px)`;
  }

  function begin(x: number, y: number): void {
    active = true;
    dragging = true;
    ghost = document.createElement('div');
    ghost.className = 'pmd-pane-drag-ghost';
    ghost.textContent = opts.label();
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    moveGhost(x, y);
    document.body.classList.add('pmd-pane-dragging');
    chip.classList.add('pmd-pane-chip-dragging');
    opts.onDragStart();
  }

  function hover(slotId: string | null): void {
    if (slotId === hovered) return;
    hovered = slotId;
    opts.onHover(slotId);
    ghost?.classList.toggle('pmd-pane-drag-ghost-armed', slotId !== null);
  }

  /** Tear the gesture down and return the slot it ended over (null
   *  when it ended nowhere, or was cancelled). */
  function end(cancelled: boolean): string | null {
    const landed = cancelled ? null : hovered;
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerCancel, true);
    pointerId = null;
    if (active) {
      ghost?.remove();
      ghost = null;
      document.body.classList.remove('pmd-pane-dragging');
      chip.classList.remove('pmd-pane-chip-dragging');
      hovered = null;
      active = false;
      dragging = false;
      opts.onDragEnd();
    }
    return landed;
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || pointerId !== null) return;
    if (onControl(e.target)) return;
    if (!opts.canDrag()) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    // Track on the document, not the chip, and take no pointer
    // capture: the gesture spends most of its life over other panes'
    // editors, and capture would retarget this pointer's compatibility
    // mouse events to the chip — which is exactly the double-click the
    // name label needs in order to start a rename.
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
  };

  function onPointerMove(e: PointerEvent): void {
    if (pointerId !== e.pointerId) return;
    if (!active) {
      if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) {
        return;
      }
      if (!opts.canDrag()) {
        end(true);
        return;
      }
      begin(e.clientX, e.clientY);
    }
    // Past the threshold this is a drag, not a text selection.
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    hover(opts.slotAtPoint(e.clientX, e.clientY));
  }

  function onPointerUp(e: PointerEvent): void {
    if (pointerId !== e.pointerId) return;
    const landed = end(false);
    if (landed !== null) opts.onDrop(landed);
  }

  function onPointerCancel(e: PointerEvent): void {
    if (pointerId !== e.pointerId) return;
    end(true);
  }

  // Escape abandons the drag, the way it backs out of every other
  // in-progress gesture in the app. Capture phase so it lands before
  // any overlay handler that might swallow it.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!active || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    end(true);
  };

  chip.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown, true);

  return {
    destroy(): void {
      end(true);
      chip.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    },
  };
}
