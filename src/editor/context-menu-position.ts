/**
 * Shared viewport-clamping for the app's small floating context menus
 * (link, image, text-selection, nav-pane, viewport-spellcheck). Every one
 * of these built its own copy of the same clamp — `Math.min(y, maxY)` off
 * raw `window.innerHeight` — which only ever slides the menu UP far enough
 * to fit inside the *browser* viewport. It doesn't know about `#status-bar`,
 * a fixed-position footer INSIDE that viewport, so a menu opened near the
 * bottom of the window renders with its last item or two under the status
 * bar instead of flipping above the click point the way a well-behaved
 * context menu should (field report: the link menu's "Remove Link" row
 * partly hidden behind the bar).
 */

/** Position `menu` (already appended to the DOM, so its real size is
 *  measurable) near viewport coordinates (x, y). Prefers opening
 *  down-and-right from the click point; flips to open ABOVE the point
 *  when it wouldn't fit below — accounting for `#status-bar`'s height,
 *  not just the raw window edge — rather than sliding down and letting
 *  the bottom rows render underneath the bar. Horizontal placement is a
 *  simple right-edge clamp (no reported issue there, so no flip needed). */
export function positionFloatingMenu(menu: HTMLElement, x: number, y: number): void {
  const margin = 4;
  const rect = menu.getBoundingClientRect();
  const statusBar = document.getElementById('status-bar');
  const statusBarHeight =
    statusBar && !statusBar.hidden ? statusBar.getBoundingClientRect().height : 0;
  const viewportBottom = window.innerHeight - statusBarHeight;

  const maxX = window.innerWidth - rect.width - margin;
  menu.style.left = `${Math.min(x, Math.max(margin, maxX))}px`;

  const fitsBelow = y + rect.height <= viewportBottom - margin;
  if (fitsBelow) {
    menu.style.top = `${Math.max(margin, y)}px`;
    return;
  }
  // Flip above the click point. If the menu is taller than the space
  // above too (a very short window), clamp to the top edge instead of
  // letting it overflow there.
  const above = y - rect.height;
  menu.style.top = `${Math.max(margin, Math.min(above, viewportBottom - rect.height - margin))}px`;
}
