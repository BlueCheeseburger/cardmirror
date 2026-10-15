/**
 * The small right-click menu for a document's file — "Copy file path" and
 * "Show in folder" — on the blue title bar over a document, the cloud /
 * computer badge in the footer, and the ribbon. One floating menu in the nav
 * pane's context-menu styling, closed by Escape or an outside click.
 */

import { positionFloatingMenu } from './context-menu-position.js';
import { registerOpenContextMenu, clearOpenContextMenu } from './context-menu-registry.js';
import { writeClipboardText } from './clipboard-write.js';
import { showToast } from './toast.js';

export interface FileMenuItem {
  label: string;
  action: () => void;
  /** Shown greyed and inert (an unsaved document has no path to copy). */
  disabled?: boolean;
  title?: string;
}

/** Copy `path` to the clipboard and say so. */
export async function copyFilePath(path: string): Promise<void> {
  const ok = await writeClipboardText(path);
  showToast(ok ? 'Copied file path' : 'Couldn’t copy the file path — the clipboard was busy. Try again.');
}

/** The menu's rows for a document whose file is `path` (null = never saved).
 *  `reveal` shows the file in the OS file manager; omit it where that isn't
 *  possible. */
export function fileMenuItems(path: string | null, reveal?: (path: string) => void): FileMenuItem[] {
  const items: FileMenuItem[] = [
    path
      ? { label: 'Copy file path', action: () => void copyFilePath(path) }
      : {
          label: 'Copy file path',
          action: () => {},
          disabled: true,
          title: 'Save the document first — it has no file yet',
        },
  ];
  if (path && reveal) items.push({ label: 'Show in folder', action: () => reveal(path) });
  return items;
}

let openMenuEl: HTMLElement | null = null;

export function closeFileMenu(): void {
  if (!openMenuEl) return;
  openMenuEl.remove();
  openMenuEl = null;
  clearOpenContextMenu(closeFileMenu);
  window.removeEventListener('mousedown', maybeClose, { capture: true });
  window.removeEventListener('keydown', maybeClose, { capture: true });
}

function maybeClose(e: MouseEvent | KeyboardEvent): void {
  if (e instanceof KeyboardEvent) {
    if (e.key === 'Escape') closeFileMenu();
    return;
  }
  if (!openMenuEl) return;
  if (!openMenuEl.contains(e.target as Node)) closeFileMenu();
}

/** Show the menu at viewport point `(x, y)`. */
export function openFileMenu(x: number, y: number, items: readonly FileMenuItem[]): void {
  closeFileMenu();
  if (items.length === 0) return;
  const menu = document.createElement('div');
  menu.className = 'pmd-nav-context-menu';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-nav-context-item';
    btn.textContent = item.label;
    if (item.title) btn.title = item.title;
    if (item.disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        closeFileMenu();
        item.action();
      });
    }
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  positionFloatingMenu(menu, x, y);
  openMenuEl = menu;
  registerOpenContextMenu(closeFileMenu);
  // Defer, so the contextmenu's own mousedown doesn't close what it just opened.
  setTimeout(() => {
    window.addEventListener('mousedown', maybeClose, { capture: true });
    window.addEventListener('keydown', maybeClose, { capture: true });
  });
}

export interface FileContextMenuOptions {
  /** The document's file path now (null = never saved). */
  getPath: () => string | null;
  /** Show the file in the OS file manager (desktop). */
  reveal?: (path: string) => void;
  /** Whether a right-click here should open the menu at all. */
  enabled?: () => boolean;
}

/** Open the menu on right-click over `el`. Returns a disposer. */
export function installFileContextMenu(el: HTMLElement, opts: FileContextMenuOptions): () => void {
  const onContextMenu = (e: MouseEvent): void => {
    if (e.defaultPrevented) return;
    if (opts.enabled && !opts.enabled()) return;
    e.preventDefault();
    openFileMenu(e.clientX, e.clientY, fileMenuItems(opts.getPath(), opts.reveal));
  };
  el.addEventListener('contextmenu', onContextMenu);
  return () => el.removeEventListener('contextmenu', onContextMenu);
}
