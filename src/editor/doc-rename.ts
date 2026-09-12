/**
 * Double-click-to-rename for the doc name shown in the chrome: the
 * ribbon's doc-name chip (single-doc) and each pane's title chip
 * (multi-pane). Renames the file on disk too, not just the label —
 * the point is not to have to leave for Finder.
 *
 * This module owns the two halves that are worth keeping away from the
 * call sites: deciding what the typed text actually means for a
 * filename, and the inline-edit affordance itself. The state work
 * (claims, recents, window title) stays in index.ts, which owns it.
 */

/** Extensions the app round-trips. A rename may not change which one a
 *  file has — that's a format conversion, which is Save As's job. */
const KNOWN_EXTENSIONS = ['.cmir', '.docx'] as const;

export type RenameResolution =
  | { ok: true; filename: string }
  | { ok: false; reason: 'empty' | 'unchanged' | 'format-change' };

/** The known extension `filename` ends with, preserving its original
 *  spelling ('.DOCX' stays '.DOCX'), or '' for anything else. */
function knownExtensionOf(filename: string): string {
  const lower = filename.toLowerCase();
  const match = KNOWN_EXTENSIONS.find((ext) => lower.endsWith(ext));
  return match ? filename.slice(-match.length) : '';
}

/** What `typed` should become, given the name the doc has now.
 *
 *  Typing no extension keeps the current one, so "1nc" on
 *  "1nc.docx" means "1nc.docx" rather than an extensionless file Word
 *  won't open. Typing a DIFFERENT known extension is refused outright:
 *  renaming "case.cmir" to "case.docx" would leave a .docx-named file
 *  holding .cmir bytes, which then fails to open — Save As is how you
 *  actually change format. */
export function resolveRenameFilename(current: string, typed: string): RenameResolution {
  const name = typed.trim();
  if (!name) return { ok: false, reason: 'empty' };
  const currentExt = knownExtensionOf(current);
  const typedExt = knownExtensionOf(name);
  if (typedExt && currentExt && typedExt.toLowerCase() !== currentExt.toLowerCase()) {
    return { ok: false, reason: 'format-change' };
  }
  // Re-attach the current extension when the user didn't type one.
  // (When they typed the same one, `name` already carries it.)
  const filename = typedExt ? name : `${name}${currentExt}`;
  if (filename === current) return { ok: false, reason: 'unchanged' };
  return { ok: true, filename };
}

export interface RenameHandle {
  /** Tear down the double-click affordance (pane close / re-render). */
  destroy(): void;
}

/** Is this label currently being edited? Callers that rewrite the
 *  label's text on a schedule check this first. */
export function isInlineRenaming(el: HTMLElement): boolean {
  return el.dataset['renaming'] === 'true';
}

export interface InlineRenameOptions {
  /** The name to seed the editor with. Null / '' disables renaming —
   *  an unsaved doc has no name to edit yet. */
  currentName: () => string | null;
  /** Called with the raw typed text when the user commits. */
  commit: (typed: string) => void;
  /** Put the label's own text back after an edit ends without a commit
   *  (Escape, or an empty field). */
  restore: () => void;
}

/** Make `el`'s text double-click-editable in place.
 *
 *  Commits on Enter or blur (Finder's behavior — the mental model here
 *  is renaming a file), cancels on Escape. The input stops its own
 *  keydowns from propagating so the app's global shortcuts and the
 *  editor's keymap don't act on text meant for the field. */
export function installInlineRename(el: HTMLElement, opts: InlineRenameOptions): RenameHandle {
  let input: HTMLInputElement | null = null;

  const end = (): void => {
    if (!input) return;
    input.remove();
    input = null;
    delete el.dataset['renaming'];
    opts.restore();
  };

  const begin = (): void => {
    if (input) return;
    const name = opts.currentName();
    if (!name) return;

    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'pmd-inline-rename';
    field.value = name;
    field.spellcheck = false;
    field.autocomplete = 'off';
    // Intrinsic width from the text — the chips this replaces are
    // content-sized flex children, where a CSS percentage width has
    // nothing to resolve against and collapses the field.
    field.size = Math.min(Math.max(name.length + 2, 12), 48);
    input = field;

    // Committed exactly once: Enter and blur both route here, and
    // Enter blurs the field on its way out.
    let settled = false;
    const commit = (): void => {
      if (settled) return;
      settled = true;
      const typed = field.value;
      end();
      opts.commit(typed);
    };

    field.addEventListener('keydown', (e) => {
      // Never let a rename keystroke reach the editor or a global
      // shortcut — plain letters here are text, not commands.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        settled = true;
        end();
      }
    });
    field.addEventListener('blur', () => commit());
    // The chip is a button in some hosts; a click inside the field
    // must not re-trigger whatever the chip itself does.
    field.addEventListener('click', (e) => e.stopPropagation());
    field.addEventListener('dblclick', (e) => e.stopPropagation());
    field.addEventListener('mousedown', (e) => e.stopPropagation());

    // Marks the label as mid-edit so whatever normally rewrites its
    // text (the window-title refresh, a chip re-render) leaves it
    // alone instead of deleting the field under the user's cursor.
    el.dataset['renaming'] = 'true';
    el.textContent = '';
    el.appendChild(field);
    field.focus();
    // Select the basename only, so typing replaces the name without
    // silently eating the extension.
    const dot = name.lastIndexOf('.');
    if (dot > 0) field.setSelectionRange(0, dot);
    else field.select();
  };

  const onDblClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    begin();
  };
  el.addEventListener('dblclick', onDblClick);

  return {
    destroy(): void {
      el.removeEventListener('dblclick', onDblClick);
      if (input) {
        input = null;
        opts.restore();
      }
    },
  };
}
