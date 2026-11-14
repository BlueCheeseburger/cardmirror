/**
 * Drag-to-reorder for a vertical list of rows, with no visible handle: press
 * anywhere on a row and drag it through the list.
 *
 * It is made stiff on purpose, so a click that wanders or a hand that drifts
 * does not move anything:
 *  - the pointer has to travel `dragThreshold` px before a press becomes a
 *    drag at all (a smaller wobble is still a plain click);
 *  - a row swaps with its neighbour only once it has moved `swapFraction` (80%)
 *    of that neighbour's height past it, so a nudge or a drift leaves the order
 *    alone;
 *  - Escape (or the pointer being cancelled) puts everything back as it was.
 *
 * The rows move in the DOM as you drag (the held row follows the pointer with a
 * transform); nothing is committed until you let go, when `onReorder(from, to)`
 * runs once with the row's original and final index. The click that follows a
 * drop is swallowed, so letting go over a row does not also pick it.
 */

export interface RowReorderOptions {
  /** The rows, in their current order. Read fresh on every use. */
  rows: () => HTMLElement[];
  /** A selector inside a row whose presses never start a drag (a close button). */
  ignore?: string;
  /** Runs once on drop, only if the row ended up somewhere else. */
  onReorder: (from: number, to: number) => void;
  /** Pointer travel (px) before a press becomes a drag. Default 16. */
  dragThreshold?: number;
  /** How far (as a fraction of the neighbour's height) the held row must pass
   *  a neighbour to swap with it. Default 0.8. */
  swapFraction?: number;
}

export const ROW_DRAGGING_CLASS = 'pmd-row-dragging';
export const LIST_REORDERING_CLASS = 'pmd-reordering';

export function attachRowReorder(container: HTMLElement, opts: RowReorderOptions): () => void {
  const threshold = opts.dragThreshold ?? 16;
  const swapFraction = opts.swapFraction ?? 0.8;

  let row: HTMLElement | null = null;
  let pointerId = -1;
  let startY = 0;
  let dragging = false;
  /** Heights of the rows the held one has swapped past (down +, up -): the
   *  amount its layout position has already moved under the pointer. */
  let shift = 0;
  let fromIndex = -1;
  let teardown: (() => void) | null = null;

  const heightOf = (el: HTMLElement): number => el.getBoundingClientRect().height || el.offsetHeight || 1;

  const finish = (commit: boolean): void => {
    const held = row;
    const wasDragging = dragging;
    teardown?.();
    teardown = null;
    row = null;
    dragging = false;
    shift = 0;
    if (!held || !wasDragging) return;
    held.classList.remove(ROW_DRAGGING_CLASS);
    held.style.transform = '';
    held.style.zIndex = '';
    container.classList.remove(LIST_REORDERING_CLASS);
    // The pointerup that ends a drag is followed by a click on whatever is
    // under it: swallow that one click so the drop does not also pick a row.
    const swallow = (e: Event): void => {
      e.stopPropagation();
      e.preventDefault();
    };
    container.addEventListener('click', swallow, true);
    setTimeout(() => container.removeEventListener('click', swallow, true), 0);
    const list = opts.rows();
    const to = list.indexOf(held);
    if (commit) {
      if (to >= 0 && to !== fromIndex) opts.onReorder(fromIndex, to);
    } else {
      // Put the row back where it started.
      const others = list.filter((r) => r !== held);
      const before = others[fromIndex] ?? null;
      if (before) before.before(held);
      else others[others.length - 1]?.after(held);
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (!row || e.pointerId !== pointerId) return;
    const dy = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(dy) < threshold) return;
      dragging = true;
      row.classList.add(ROW_DRAGGING_CLASS);
      row.style.zIndex = '1';
      container.classList.add(LIST_REORDERING_CLASS);
    }
    const held = row;
    // Swap with the neighbour once the row has moved far enough past it. One
    // swap per step keeps it from jumping several rows on a fast move.
    for (let guard = 0; guard < 50; guard++) {
      const list = opts.rows();
      const i = list.indexOf(held);
      const offset = dy - shift;
      const next = list[i + 1];
      const prev = list[i - 1];
      if (next && offset > heightOf(next) * swapFraction) {
        next.after(held);
        shift += heightOf(next);
      } else if (prev && offset < -heightOf(prev) * swapFraction) {
        prev.before(held);
        shift -= heightOf(prev);
      } else {
        break;
      }
    }
    held.style.transform = `translateY(${dy - shift}px)`;
    e.preventDefault();
  };

  const onUp = (e: PointerEvent): void => {
    if (!row || e.pointerId !== pointerId) return;
    finish(true);
  };
  const onCancel = (e: PointerEvent): void => {
    if (!row || e.pointerId !== pointerId) return;
    finish(false);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !dragging) return;
    // Esc mid-drag cancels the drag, not the list around it.
    e.stopPropagation();
    e.preventDefault();
    finish(false);
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary || row) return;
    const target = e.target as Element | null;
    if (!target) return;
    if (opts.ignore && target.closest(opts.ignore)) return;
    const list = opts.rows();
    const hit = list.find((r) => r.contains(target));
    if (!hit) return;
    row = hit;
    pointerId = e.pointerId;
    startY = e.clientY;
    shift = 0;
    dragging = false;
    fromIndex = list.indexOf(hit);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey, true);
    teardown = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey, true);
    };
  };

  container.addEventListener('pointerdown', onDown);
  return () => {
    finish(false);
    container.removeEventListener('pointerdown', onDown);
  };
}
