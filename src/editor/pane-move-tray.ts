/**
 * The move tray: a floating strip shown while a pane's title chip is being
 * dragged. It is a map of where the document can go: one tile per slot in
 * this window (the tile for the slot the document is leaving says "Here"),
 * then "New window" and any other open windows.
 *
 * Every tile is a drop target. The drag gesture (pane-drag.ts) finds the
 * target under the pointer through `data-move-target`; this module only
 * draws the tray and lights up the hovered tile.
 *
 * Target tokens: `slot1`..`slot3`, `win:new`, `win:<windowId>`.
 */

export interface MoveTraySlot {
  id: string;
  /** Slot number shown on the tile. */
  num: number;
  /** The document currently shown in the slot, or null when it is empty. */
  name: string | null;
  /** The slot the dragged document is leaving. */
  source: boolean;
}

export interface MoveTrayWindow {
  id: number;
  label: string;
}

export interface MoveTray {
  /** Light up the tile for `target` (null clears). */
  setHover(target: string | null): void;
  /** Fill in the other windows once they are known. */
  setWindows(windows: readonly MoveTrayWindow[]): void;
  destroy(): void;
}

const NEW_WINDOW = 'win:new';

export const windowTarget = (id: number): string => `win:${id}`;

/** What dropping on `target` does, for the label that follows the pointer. */
export function describeMoveTarget(
  target: string,
  slots: readonly MoveTraySlot[],
  windows: readonly MoveTrayWindow[],
): string {
  if (target === NEW_WINDOW) return 'Open in a new window';
  if (target.startsWith('win:')) {
    const w = windows.find((x) => windowTarget(x.id) === target);
    return w ? `Send to ${w.label}` : 'Send to that window';
  }
  const slot = slots.find((s) => s.id === target);
  if (!slot) return '';
  return slot.name ? `Swap with ${slot.name}` : `Move to slot ${slot.num}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** `withWindows` is false on a host that cannot move a document to another
 *  window (the browser), where the tray offers this window's slots only. */
export function showMoveTray(
  slots: readonly MoveTraySlot[],
  initialWindows: readonly MoveTrayWindow[],
  withWindows = true,
): MoveTray {
  const root = el('div', 'pmd-move-tray');
  root.setAttribute('aria-hidden', 'true');

  const tiles = new Map<string, HTMLElement>();

  const slotGroup = el('div', 'pmd-move-tray-group');
  slotGroup.appendChild(el('div', 'pmd-move-tray-heading', 'This window'));
  const slotRow = el('div', 'pmd-move-tray-row');
  for (const s of slots) {
    const tile = el('div', 'pmd-move-tile pmd-move-tile-slot');
    tile.dataset['moveTarget'] = s.id;
    tile.classList.toggle('pmd-move-tile-source', s.source);
    tile.classList.toggle('pmd-move-tile-empty', !s.source && s.name === null);
    tile.appendChild(el('span', 'pmd-move-tile-num', String(s.num)));
    const text = el('span', 'pmd-move-tile-text');
    text.appendChild(el('span', 'pmd-move-tile-name', s.source ? 'Here' : (s.name ?? 'Empty')));
    if (!s.source && s.name) text.appendChild(el('span', 'pmd-move-tile-verb', 'Swap'));
    if (!s.source && !s.name) text.appendChild(el('span', 'pmd-move-tile-verb', 'Move here'));
    tile.appendChild(text);
    tiles.set(s.id, tile);
    slotRow.appendChild(tile);
  }
  slotGroup.appendChild(slotRow);

  const windowGroup = el('div', 'pmd-move-tray-group');
  windowGroup.appendChild(el('div', 'pmd-move-tray-heading', 'Another window'));
  const windowRow = el('div', 'pmd-move-tray-row');
  windowGroup.appendChild(windowRow);

  const tileFor = (target: string, name: string, verb: string, plus: boolean): HTMLElement => {
    const tile = el('div', 'pmd-move-tile pmd-move-tile-window');
    tile.dataset['moveTarget'] = target;
    tile.appendChild(el('span', 'pmd-move-tile-num', plus ? '+' : '⧉'));
    const text = el('span', 'pmd-move-tile-text');
    text.appendChild(el('span', 'pmd-move-tile-name', name));
    text.appendChild(el('span', 'pmd-move-tile-verb', verb));
    tile.appendChild(text);
    tiles.set(target, tile);
    return tile;
  };

  const renderWindows = (windows: readonly MoveTrayWindow[]): void => {
    for (const key of [...tiles.keys()]) {
      if (key.startsWith('win:')) tiles.delete(key);
    }
    windowRow.replaceChildren(tileFor(NEW_WINDOW, 'New window', 'Open there', true));
    for (const w of windows) windowRow.appendChild(tileFor(windowTarget(w.id), w.label, 'Send there', false));
  };
  renderWindows(initialWindows);

  if (withWindows) root.append(slotGroup, el('div', 'pmd-move-tray-divider'), windowGroup);
  else root.append(slotGroup);
  document.body.appendChild(root);
  // Next frame so the slide-in transition has a starting state.
  requestAnimationFrame(() => root.classList.add('pmd-move-tray-in'));

  let hovered: string | null = null;
  return {
    setHover(target) {
      if (target === hovered) return;
      if (hovered) tiles.get(hovered)?.classList.remove('pmd-move-tile-hot');
      hovered = target;
      if (target) tiles.get(target)?.classList.add('pmd-move-tile-hot');
    },
    setWindows(windows) {
      renderWindows(windows);
      if (hovered) tiles.get(hovered)?.classList.add('pmd-move-tile-hot');
    },
    destroy() {
      root.remove();
    },
  };
}
