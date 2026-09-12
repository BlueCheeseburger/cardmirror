/**
 * Right-click a pane's title chip → "Move to…": a floating menu
 * listing every OTHER live multi-pane window, plus "New Window",
 * so a doc can move to a window you can't reach by dragging its
 * chip onto a pane (chip-drag only reaches panes IN this window).
 *
 * Reuses `nav-panel.ts`'s context-menu styling and close-on-outside-
 * click plumbing (`.pmd-nav-context-menu`) for cross-surface
 * consistency — same pattern as `image-context-menu-plugin.ts`.
 */

import { positionFloatingMenu } from './context-menu-position.js';
import { registerOpenContextMenu, clearOpenContextMenu } from './context-menu-registry.js';

export interface MoveMenuCandidate {
  id: number;
  label: string;
}

export interface MoveMenuOptions {
  /** Is there a doc here to move at all? A right-click on an empty
   *  pane (shouldn't be reachable — the pane is hidden — but the
   *  chip is exposed regardless of caller correctness) opens nothing. */
  canMove: () => boolean;
  /** Other live multi-pane windows, freshly queried on each open (a
   *  window may have opened or closed since the last right-click). */
  listCandidates: () => Promise<MoveMenuCandidate[]>;
  /** The user picked a destination: an existing window's id, or
   *  'new-window'. */
  onPick: (target: number | 'new-window') => void;
}

let openMenuEl: HTMLElement | null = null;

function closeMoveMenu(): void {
  if (!openMenuEl) return;
  openMenuEl.remove();
  openMenuEl = null;
  clearOpenContextMenu(closeMoveMenu);
  window.removeEventListener('mousedown', maybeCloseMoveMenu, { capture: true });
  window.removeEventListener('keydown', maybeCloseMoveMenu, { capture: true });
}

function maybeCloseMoveMenu(e: MouseEvent | KeyboardEvent): void {
  if (e instanceof KeyboardEvent) {
    if (e.key === 'Escape') closeMoveMenu();
    return;
  }
  if (!openMenuEl) return;
  if (!openMenuEl.contains(e.target as Node)) closeMoveMenu();
}

/** Build and show the menu at `(x, y)`. Exported mainly so it's
 *  independently testable; `installMoveMenuTrigger` is the normal
 *  entry point. */
export async function openMoveMenu(x: number, y: number, opts: MoveMenuOptions): Promise<void> {
  closeMoveMenu();
  const candidates = await opts.listCandidates();

  const menu = document.createElement('div');
  menu.className = 'pmd-nav-context-menu';

  const addItem = (label: string, action: () => void): void => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-nav-context-item';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      closeMoveMenu();
      action();
    });
    menu.appendChild(btn);
  };

  for (const c of candidates) {
    addItem(`Move to “${c.label}”`, () => opts.onPick(c.id));
  }
  addItem('Move to New Window', () => opts.onPick('new-window'));

  document.body.appendChild(menu);
  positionFloatingMenu(menu, x, y);

  openMenuEl = menu;
  registerOpenContextMenu(closeMoveMenu);
  // Defer registration so the contextmenu's own mousedown doesn't
  // immediately close the menu we just opened (same reasoning as
  // the image/nav-panel context menus).
  setTimeout(() => {
    window.addEventListener('mousedown', maybeCloseMoveMenu, { capture: true });
    window.addEventListener('keydown', maybeCloseMoveMenu, { capture: true });
  });
}

/** Wire `el`'s right-click to open the move menu. Desktop-only by
 *  construction — callers only install this when a host actually
 *  supports cross-window moves. */
export function installMoveMenuTrigger(el: HTMLElement, opts: MoveMenuOptions): () => void {
  const onContextMenu = (e: MouseEvent): void => {
    if (e.defaultPrevented) return;
    if (!opts.canMove()) return;
    e.preventDefault();
    void openMoveMenu(e.clientX, e.clientY, opts);
  };
  el.addEventListener('contextmenu', onContextMenu);
  return () => el.removeEventListener('contextmenu', onContextMenu);
}
