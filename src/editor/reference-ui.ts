/**
 * Keyboard shortcuts popup: the keyboard map on top, then one row per command
 * (grouped as in `ribbon-groups.ts`) that you can rebind in place: × removes a
 * binding, + adds one, ↺ restores that command's defaults; Restore all defaults
 * and the keyboard macros sit at the very bottom. This is also where the
 * Settings → Keyboard tab leads (the old settings editor is gone).
 */

import { setIcon } from './icons';
import { pushOverlay, popOverlay } from './overlay-stack.js';
import {
  installModalKeys,
  armDialogFocus,
  captureFocusForDialog,
} from './text-prompt.js';
import { isBackdropClick } from './backdrop-click.js';
import { buildKeyboardMap, type KeyboardMapHandle } from './keyboard-map.js';
import { buildKeybindingsEditor, type KeybindingsEditorHandle } from './keybindings-editor.js';


class ReferenceModal {
  private overlay: HTMLDivElement;
  private dialog: HTMLDivElement;
  /** Live filter query for the searchbar — kept on the instance
   *  so reopening the modal preserves the last search. */
  private searchQuery = '';
  /** Modal plumbing while open (2026-07-27 focus audit: same
   *  no-focus, unregistered pattern as the word-count modal —
   *  keystrokes fell through to the document behind). */
  private overlayToken: symbol | null = null;
  private removeKeys: (() => void) | null = null;
  private restoreFocus: (() => void) | null = null;
  private map: KeyboardMapHandle | null = null;
  private editor: KeybindingsEditorHandle | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'pmd-reference-overlay';
    this.overlay.style.display = 'none';

    this.dialog = document.createElement('div');
    this.dialog.className = 'pmd-reference-dialog';
    this.overlay.appendChild(this.dialog);

    this.overlay.addEventListener('click', (e) => {
      if (isBackdropClick(e, this.overlay)) this.close();
    });

    document.body.appendChild(this.overlay);
  }

  open(): void {
    this.render();
    this.overlay.style.display = '';
    if (this.overlayToken === null) {
      const token = pushOverlay();
      this.overlayToken = token;
      this.restoreFocus = captureFocusForDialog();
      this.removeKeys = installModalKeys(this.dialog, token, (e) => {
        if (e.key === 'Escape') {
          this.close();
          return true;
        }
        return false;
      });
    }
    armDialogFocus(this.dialog, 'dialog', 'Keyboard shortcuts');
  }

  close(): void {
    this.overlay.style.display = 'none';
    this.editor = null;
    this.map?.destroy();
    this.map = null;
    if (this.overlayToken !== null) {
      popOverlay(this.overlayToken);
      this.overlayToken = null;
    }
    this.removeKeys?.();
    this.removeKeys = null;
    this.restoreFocus?.();
    this.restoreFocus = null;
  }

  private render(): void {
    this.dialog.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'pmd-reference-header';
    const title = document.createElement('h2');
    title.textContent = 'Keyboard shortcuts';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pmd-reference-close';
    setIcon(closeBtn, 'close');
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);
    this.dialog.appendChild(header);

    const searchRow = document.createElement('div');
    searchRow.className = 'pmd-reference-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'pmd-reference-search-input';
    searchInput.placeholder = 'Search shortcuts…';
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.editor?.setQuery(this.searchQuery);
    });
    searchRow.appendChild(searchInput);
    this.dialog.appendChild(searchRow);

    // The keyboard map first: a picture of what every key does right now.
    this.map?.destroy();
    this.map = buildKeyboardMap();
    this.dialog.insertBefore(this.map.el, searchRow);

    // The rebindable rows (the map watches settings and redraws itself, and
    // the rows re-render themselves).
    const body = document.createElement('div');
    body.className = 'pmd-reference-body';
    this.editor = buildKeybindingsEditor();
    body.appendChild(this.editor.el);
    this.dialog.appendChild(body);

    // Re-apply the persisted search to the fresh rows.
    this.editor.setQuery(this.searchQuery);
  }
}

let modal: ReferenceModal | null = null;

export function openReference(): void {
  if (!modal) modal = new ReferenceModal();
  modal.open();
}
