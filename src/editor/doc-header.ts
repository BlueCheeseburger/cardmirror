/**
 * The blue title bar over the document in the one-document-per-window layout.
 *
 * Three-pane mode already puts one of these on every pane (multi-pane-shell.ts
 * builds that chip); this builds the same strip for the single-document window
 * so the two layouts look like the same app — a single pane is just a
 * workspace with one pane open. It reuses the pane chip's classes, so the
 * styling, focus blue, speech amber and button states all come from the same
 * CSS. What a window of one has no use for is left out: no slot number, no
 * expand button.
 *
 * This module only builds the strip and exposes setters. What each button DOES
 * (saving, closing, renaming) stays with index.ts, behind the callbacks.
 */

import { setIcon } from './icons.js';
import { installInlineRename } from './doc-rename.js';
import { createChipSpeechButton } from './chip-speech-button.js';
import { installFileDragSource, type FileDragHost } from './file-drag.js';
import { installFileContextMenu } from './file-path-menu.js';

export interface DocHeaderOptions {
  /** The name to seed a rename with (no extension), or null for a document that
   *  has no name yet. */
  renameSeed: () => string | null;
  /** The user committed a rename with this text. */
  onRename: (typed: string) => void;
  /** Put the label's own text back after a rename ends without a commit. */
  onRenameEnd: () => void;
  onSave: () => void;
  onToggleAutosave: () => void;
  onToggleNav: () => void;
  onClose: () => void;
  onToggleSpeech: () => void;
  /** The document's file path now (null = never saved). */
  getPath: () => string | null;
  /** The host that can start a native file drag (desktop); null elsewhere. */
  getDragHost: () => FileDragHost | null;
  /** Show the file in the OS file manager. */
  reveal?: (path: string) => void;
}

export interface AutosaveChipState {
  pressed: boolean;
  effective: boolean;
  error: boolean;
  label: string;
}

export interface DocHeader {
  /** The container to place in the page. */
  el: HTMLElement;
  /** The name label (also the rename target). */
  nameEl: HTMLElement;
  setName(name: string): void;
  setSpeech(isSpeech: boolean): void;
  setNavShown(shown: boolean): void;
  setAutosave(state: AutosaveChipState): void;
  setSaveTitle(title: string): void;
  /** The save is in flight (amber) / over. */
  setSaving(saving: boolean): void;
  /** The button that shows the ✓ flash after a save. */
  saveButton: HTMLButtonElement;
  destroy(): void;
}

function chipButton(className: string, icon: Parameters<typeof setIcon>[1], title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  setIcon(btn, icon);
  btn.title = title;
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** Build the bar into `container` (which gets the pane-focus class so the chip
 *  paints blue). */
export function installDocHeader(container: HTMLElement, opts: DocHeaderOptions): DocHeader {
  container.classList.add('pmd-pane-focused');
  const chip = document.createElement('div');
  chip.className = 'pmd-pane-chip';

  const speech = createChipSpeechButton(opts.onToggleSpeech);
  chip.appendChild(speech.el);

  const nameEl = document.createElement('span');
  nameEl.className = 'pmd-pane-chip-name';
  nameEl.title = 'Double-click to rename';
  chip.appendChild(nameEl);
  const rename = installInlineRename(nameEl, {
    currentName: opts.renameSeed,
    commit: opts.onRename,
    restore: opts.onRenameEnd,
  });

  const saveBtn = chipButton('pmd-pane-chip-save', 'save', 'Save', opts.onSave);
  chip.appendChild(saveBtn);
  const autosaveBtn = chipButton('pmd-pane-chip-autosave', 'autosave', 'Autosave', opts.onToggleAutosave);
  autosaveBtn.setAttribute('aria-pressed', 'false');
  chip.appendChild(autosaveBtn);
  const navBtn = chipButton('pmd-pane-chip-nav', 'nav-toggle', 'Hide the outline', opts.onToggleNav);
  navBtn.setAttribute('aria-pressed', 'true');
  chip.appendChild(navBtn);
  const closeBtn = chipButton('pmd-pane-chip-close', 'close', 'Close this document', opts.onClose);
  chip.appendChild(closeBtn);

  // The bar is the file's handle: drag it into another app to share the saved
  // file; right-click anywhere on it to copy the path.
  const disposeDrag = installFileDragSource(chip, opts.getPath, opts.getDragHost);
  const disposeMenu = installFileContextMenu(chip, {
    getPath: opts.getPath,
    // Paths only exist on desktop; the web edition has nothing to copy.
    enabled: () => opts.getDragHost() !== null,
    ...(opts.reveal ? { reveal: opts.reveal } : {}),
  });

  container.appendChild(chip);

  return {
    el: container,
    nameEl,
    saveButton: saveBtn,
    setName(name: string): void {
      // A rename in progress keeps its field (see isInlineRenaming's callers).
      if (nameEl.dataset['renaming'] === 'true') return;
      nameEl.textContent = name;
    },
    setSpeech(isSpeech: boolean): void {
      container.classList.toggle('pmd-pane-speech', isSpeech);
      speech.setState(isSpeech);
    },
    setNavShown(shown: boolean): void {
      navBtn.setAttribute('aria-pressed', shown ? 'true' : 'false');
      navBtn.title = shown ? 'Hide the outline' : 'Show the outline';
    },
    setAutosave(state: AutosaveChipState): void {
      autosaveBtn.setAttribute('aria-pressed', state.pressed ? 'true' : 'false');
      autosaveBtn.dataset['autosaveEffective'] = state.effective ? 'true' : 'false';
      autosaveBtn.toggleAttribute('data-autosave-error', state.error);
      autosaveBtn.title = state.label;
    },
    setSaveTitle(title: string): void {
      saveBtn.title = title;
    },
    setSaving(saving: boolean): void {
      saveBtn.classList.toggle('pmd-save-saving', saving);
    },
    destroy(): void {
      rename.destroy();
      disposeDrag();
      disposeMenu();
      container.replaceChildren();
    },
  };
}
