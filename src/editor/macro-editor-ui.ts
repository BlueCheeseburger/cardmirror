/**
 * The formatted-macro editor: a small dialog with a real CardMirror editor in
 * it and a toolbar of styles and emphasis types. Type the text the macro should
 * type; make some of it a Tag or a Cite, underline it, emphasize it, highlight
 * it. Save, and pressing the macro's key types exactly that, formatting and all.
 *
 * It is the document editor, not a lookalike: the toolbar buttons run the same
 * ribbon commands as their shortcuts (F7 Tag, F8 Cite, F9 Underline, F10
 * Emphasis, F11 Highlight …) against this editor, and those shortcuts work in it
 * too. Opened from Settings → Keyboard shortcuts → Keyboard macros.
 */

import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { settings, type KeyboardMacro } from './settings.js';
import { schema } from '../schema/index.js';
import { docForMacro, macroContentFromDoc } from './macro-content.js';
import { formatKeyForDisplay, primaryKeyFor, type AnyCommandId } from './ribbon-commands.js';
import { pushOverlay, popOverlay } from './overlay-stack.js';
import { installModalKeys, captureFocusForDialog, armDialogFocus } from './text-prompt.js';
import { isBackdropClick } from './backdrop-click.js';
import { setIcon } from './icons';

/** The toolbar: paragraph styles, then emphasis types. `id` is the ribbon
 *  command a button runs; its shortcut is named in the tooltip. */
const STYLE_BUTTONS: { id: AnyCommandId; label: string }[] = [
  { id: 'setPocket', label: 'Pocket' },
  { id: 'setHat', label: 'Hat' },
  { id: 'setBlock', label: 'Block' },
  { id: 'setTag', label: 'Tag' },
  { id: 'setAnalytic', label: 'Analytic' },
  { id: 'setUndertag', label: 'Undertag' },
];
const MARK_BUTTONS: { id: AnyCommandId; label: string; cls?: string }[] = [
  { id: 'applyCite', label: 'Cite', cls: 'pmd-macro-ed-btn-cite' },
  { id: 'applyUnderline', label: 'Underline', cls: 'pmd-macro-ed-btn-underline' },
  { id: 'applyEmphasis', label: 'Emphasis', cls: 'pmd-macro-ed-btn-emphasis' },
  { id: 'applyHighlight', label: 'Highlight', cls: 'pmd-macro-ed-btn-highlight' },
  { id: 'toggleBold', label: 'B', cls: 'pmd-macro-ed-btn-bold' },
  { id: 'toggleItalic', label: 'I', cls: 'pmd-macro-ed-btn-italic' },
  { id: 'clearToNormal', label: 'Clear' },
];

let open = false;

/** Open the editor for the macro `macroId`. Resolves when it closes. */
export async function openMacroEditor(macroId: string): Promise<void> {
  if (open) return;
  const macro = settings.get('keyboardMacros').find((m) => m.id === macroId);
  if (!macro) return;
  open = true;
  try {
    const { buildEditorPlugins, runRibbonOnView } = await import('./index.js');
    await new Promise<void>((resolve) => mount(macro, buildEditorPlugins, runRibbonOnView, resolve));
  } finally {
    open = false;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function mount(
  macro: KeyboardMacro,
  buildEditorPlugins: () => import('prosemirror-state').Plugin[],
  runRibbonOnView: (view: EditorView, id: AnyCommandId) => void,
  done: () => void,
): void {
  const restoreFocus = captureFocusForDialog();
  const token = pushOverlay();

  const overlay = el('div', 'pmd-macro-ed-overlay');
  const dialog = el('div', 'pmd-macro-ed-dialog');
  overlay.appendChild(dialog);

  // Header
  const header = el('header', 'pmd-macro-ed-header');
  header.appendChild(el('h2', '', 'Formatted macro'));
  const closeBtn = el('button', 'pmd-macro-ed-close');
  closeBtn.type = 'button';
  closeBtn.title = 'Close without saving';
  setIcon(closeBtn, 'close');
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  // Shortcut line
  const keyLine = el('p', 'pmd-macro-ed-intro');
  keyLine.append(
    'Type what this macro should type. Use the buttons or your usual shortcuts to style it. ',
    macro.key ? 'Shortcut: ' : 'No shortcut yet; set one in the list when you are done.',
  );
  if (macro.key) keyLine.appendChild(el('kbd', 'pmd-macro-ed-key', formatKeyForDisplay(macro.key)));
  dialog.appendChild(keyLine);

  // Toolbar
  const toolbar = el('div', 'pmd-macro-ed-toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Styles and emphasis');
  const overrides = settings.get('ribbonKeyOverrides');
  const group = (title: string, buttons: { id: AnyCommandId; label: string; cls?: string }[]): void => {
    const g = el('div', 'pmd-macro-ed-group');
    g.appendChild(el('span', 'pmd-macro-ed-group-title', title));
    const row = el('div', 'pmd-macro-ed-group-row');
    for (const b of buttons) {
      const btn = el('button', `pmd-macro-ed-btn ${b.cls ?? ''}`.trim(), b.label);
      btn.type = 'button';
      const key = primaryKeyFor(b.id, overrides);
      btn.title = key ? `${b.label} (${formatKeyForDisplay(key)})` : b.label;
      // Keep the editor's selection: a button press must not take focus.
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => view && runRibbonOnView(view, b.id));
      row.appendChild(btn);
    }
    g.appendChild(row);
    toolbar.appendChild(g);
  };
  group('Style', STYLE_BUTTONS);
  group('Emphasis and marks', MARK_BUTTONS);
  dialog.appendChild(toolbar);

  // Editor
  const host = el('div', 'pmd-macro-ed-editor');
  dialog.appendChild(host);
  const note = el('p', 'pmd-macro-ed-note', 'A single plain paragraph types into the line you are on. With styles or several lines, it is inserted the way a paste would be.');
  dialog.appendChild(note);

  // Footer
  const footer = el('footer', 'pmd-macro-ed-footer');
  const cancelBtn = el('button', 'pmd-macro-ed-cancel', 'Cancel');
  cancelBtn.type = 'button';
  const saveBtn = el('button', 'pmd-macro-ed-save', 'Save macro');
  saveBtn.type = 'button';
  footer.append(cancelBtn, saveBtn);
  dialog.appendChild(footer);

  let view: EditorView | null = null;
  let closed = false;
  let removeKeys: () => void = () => {};

  const close = (): void => {
    if (closed) return;
    closed = true;
    removeKeys();
    view?.destroy();
    view = null;
    popOverlay(token);
    overlay.remove();
    restoreFocus();
    done();
  };

  const save = (): void => {
    if (!view) return;
    const content = macroContentFromDoc(view.state.doc);
    const macros = settings.get('keyboardMacros');
    settings.set(
      'keyboardMacros',
      macros.map((m) => {
        if (m.id !== macro.id) return m;
        const { contentJson: _drop, ...rest } = m;
        // Nothing typed: the macro goes back to an empty plain-text one.
        return content ? { ...rest, text: content.plainText, contentJson: content.json } : { ...rest, text: '' };
      }),
    );
    close();
  };

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  saveBtn.addEventListener('click', save);
  overlay.addEventListener('click', (e) => {
    if (isBackdropClick(e, overlay)) close();
  });
  removeKeys = installModalKeys(dialog, token, (e) => {
    if (e.key === 'Escape') {
      close();
      return true;
    }
    // Mod+Enter saves from inside the editor.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      save();
      return true;
    }
    return false;
  });

  document.body.appendChild(overlay);
  armDialogFocus(dialog, 'dialog', 'Formatted macro');

  const state = EditorState.create({ doc: docForMacro(macro), schema, plugins: buildEditorPlugins() });
  const created: EditorView = new EditorView(host, {
    state,
    dispatchTransaction(tx) {
      created.updateState(created.state.apply(tx));
    },
  });
  view = created;
  created.focus();
}
