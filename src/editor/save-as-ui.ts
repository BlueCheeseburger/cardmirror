/**
 * Save As modal. Promise-based — resolves with the user's chosen
 * filename + format + export options, or `null` if they cancelled.
 *
 * Two output formats:
 *   - `cmir` — CardMirror native (lossless JSON, no Verbatim round-
 *     trip). Recommended for docs that live entirely in CardMirror.
 *   - `docx` — Microsoft Word / Verbatim. Use for sharing with
 *     teammates still on Verbatim, or for any tournament-day round
 *     where the receiving party needs Word.
 *
 * Layout: a Name section, a Format section, then a Save section of
 * one-click presets — As-Is (everything), Send Doc (no analytics /
 * undertags / comments), Read Doc (read-mode export), Marked Doc
 * (marked cards only), and Custom Save (opens a sub-dialog to pick
 * exactly what to include) — each with its description as a caption
 * below the button. Below that, a collapsible list of folders you've
 * saved into before: clicking one saves straight there, skipping the
 * OS picker entirely. Then Cancel. The format radio drives the
 * default filename extension and which filter the OS dialog defaults
 * to; all content options apply equally to both formats.
 */

import { settings } from './settings.js';
import { setIcon } from './icons';
import { pushOverlay, popOverlay } from './overlay-stack.js';
import { installModalKeys, captureFocusForDialog } from './text-prompt.js';
import {
  listSaveLocations,
  toggleSaveLocationPin,
  saveLocationsExpanded,
  setSaveLocationsExpanded,
} from './save-locations-store.js';

export type SaveAsFormat = 'cmir' | 'docx';

export interface SaveAsResult {
  filename: string;
  /** Which on-disk format the user picked. */
  format: SaveAsFormat;
  /** Include comments in the saved doc. */
  includeComments: boolean;
  /** Include analytic content. When false, doc-level analytic_units
   *  drop entirely; in-card analytic paragraphs drop. */
  includeAnalytics: boolean;
  /** Include undertag paragraphs (doc-level and inside cards /
   *  analytic_units). */
  includeUndertags: boolean;
  /** Save only what's visible in read mode: headings, tags, in-card
   *  analytics, cite-marked text inside cite_paragraphs, highlighted
   *  text inside body paragraphs. Mutually exclusive with the three
   *  include-* options above. */
  readMode: boolean;
  /** Bake the private note layer into the file as real comments. Off by
   *  default — notes are private and normally never leave CardMirror. */
  includeNotes: boolean;
  /** Bake the private AI-thread layer into the file as real comments.
   *  Off by default, same rationale as notes. */
  includeAiThreads: boolean;
  /** Keep ONLY the cards that contain a reading marker, flat (no headings, no
   *  analytics). Mutually exclusive with the include-* / readMode options. */
  markedCardsOnly: boolean;
  /** Set when the user picked a remembered folder instead of a save
   *  button: write `filename` straight into this directory and skip
   *  the OS picker. Absent on every other path. */
  destinationDir?: string;
}

export interface OpenSaveAsOptions {
  /** Initial filename suggestion (with or without an extension — the
   *  dialog will normalize on confirm). */
  initialFilename: string;
  /** Default format to pre-select. Usually the current doc's format
   *  (so re-saving stays in the same format unless the user changes
   *  it). New docs default to `'cmir'`, the native format. */
  defaultFormat: SaveAsFormat;
  /** Offer the "previously saved location" list. Off unless the caller
   *  can actually write to a bare directory path — the web edition
   *  can't, and the recovery flow doesn't. */
  allowSaveLocations?: boolean;
}

export function openSaveAs(opts: OpenSaveAsOptions): Promise<SaveAsResult | null> {
  return new Promise((resolve) => {
    new SaveAsModal(opts, resolve);
  });
}

const FORMAT_LABELS: Record<SaveAsFormat, string> = {
  cmir: 'CardMirror native (.cmir)',
  docx: 'Microsoft Word (.docx)',
};

/** What "save everything" means — the As-Is preset, the Enter-key
 *  submit, and a click on a remembered folder all use it. Anything
 *  narrower is a derived export (see `isFullSave` in index.ts). */
const AS_IS_OPTIONS: SaveContentOptions = {
  includeComments: true,
  includeAnalytics: true,
  includeUndertags: true,
  readMode: false,
  includeNotes: false,
  includeAiThreads: false,
  markedCardsOnly: false,
};

/** The content half of a `SaveAsResult` — everything except where the
 *  bytes go. */
type SaveContentOptions = Omit<SaveAsResult, 'filename' | 'format' | 'destinationDir'>;

const FORMAT_BLURBS: Record<SaveAsFormat, string> = {
  cmir: 'Lossless. No conversion. Best for docs that stay in CardMirror.',
  docx: 'For sharing with Verbatim users or any Word-based workflow.',
};

class SaveAsModal {
  private readonly overlay: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private filenameInput!: HTMLInputElement;
  /** Radio inputs keyed by format id. */
  private formatRadios!: Record<SaveAsFormat, HTMLInputElement>;
  private settled = false;
  private currentFormat: SaveAsFormat;
  /** Overlay-stack token + modal-key uninstaller + focus restorer
   *  (2026-07-27 focus audit: this dialog registered nothing, so
   *  background handlers saw "no modal open" while it was up, its
   *  Escape-only listener let other keys pass, and closing it never
   *  returned focus to the editor). */
  private overlayToken = pushOverlay();
  private removeKeys: () => void = () => {};
  private restoreFocus: () => void = () => {};

  constructor(
    private readonly opts: OpenSaveAsOptions,
    private readonly settle: (r: SaveAsResult | null) => void,
  ) {
    this.currentFormat = opts.defaultFormat;
    this.overlay = document.createElement('div');
    this.overlay.className = 'pmd-save-as-overlay';

    this.dialog = document.createElement('div');
    this.dialog.className = 'pmd-save-as-dialog';
    this.overlay.appendChild(this.dialog);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.cancel();
    });

    this.restoreFocus = captureFocusForDialog();
    this.removeKeys = installModalKeys(this.dialog, this.overlayToken, (e) => {
      if (e.key === 'Escape') {
        this.cancel();
        return true;
      }
      // Everything else: keys aimed at the dialog's own inputs pass
      // through natively (Enter in the filename field submits the
      // form); keys aimed anywhere else are swallowed by the helper.
      return false;
    });

    this.render();
    document.body.appendChild(this.overlay);

    requestAnimationFrame(() => {
      this.filenameInput.focus();
      // Select just the basename, not the extension, so the user can
      // type a new name without clobbering the extension.
      const dot = this.filenameInput.value.lastIndexOf('.');
      if (dot > 0) {
        this.filenameInput.setSelectionRange(0, dot);
      } else {
        this.filenameInput.select();
      }
    });
  }

  private render(): void {
    const header = document.createElement('header');
    header.className = 'pmd-save-as-header';
    const title = document.createElement('h2');
    title.textContent = 'Save As';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pmd-save-as-close';
    setIcon(closeBtn, 'close');
    closeBtn.title = 'Cancel';
    closeBtn.addEventListener('click', () => this.cancel());
    header.appendChild(closeBtn);
    this.dialog.appendChild(header);

    const form = document.createElement('form');
    form.className = 'pmd-save-as-body';
    // Enter in the filename field is the keyboard equivalent of As-Is
    // — the full-fidelity save, and the one a user typing a name and
    // hitting Return means. (It used to submit whatever the inline
    // Include checkboxes held; those now live behind Custom Save.)
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.confirmWith(AS_IS_OPTIONS);
    });

    // FILE NAME and FORMAT — the what/where, each under its heading.
    form.appendChild(this.buildFileNameSection());
    form.appendChild(this.buildFormatSection());

    // SAVE section heading — covers the presets and the custom-save
    // block below.
    const saveHeading = document.createElement('div');
    saveHeading.className = 'pmd-save-as-options-heading';
    saveHeading.textContent = 'Save';
    form.appendChild(saveHeading);

    // One-click presets — common content configurations. Each saves
    // immediately with the filename + format above; the description
    // shows as a caption below the button.
    const presets = document.createElement('div');
    presets.className = 'pmd-save-as-presets';
    presets.appendChild(
      this.buildPreset('As-Is', 'Includes everything in the document.', AS_IS_OPTIONS),
    );
    presets.appendChild(
      this.buildPreset(
        'Send Doc',
        'Excludes analytics, undertags, and comments.',
        {
          includeComments: false,
          includeAnalytics: false,
          includeUndertags: false,
          readMode: false,
          includeNotes: false,
          includeAiThreads: false,
          markedCardsOnly: false,
        },
        settings.get('sendDocPrefix'),
      ),
    );
    presets.appendChild(
      this.buildPreset(
        'Read Doc',
        'Exports the read-mode view of the document.',
        {
          includeComments: false,
          includeAnalytics: false,
          includeUndertags: false,
          readMode: true,
          includeNotes: false,
          includeAiThreads: false,
          markedCardsOnly: false,
        },
        settings.get('readDocPrefix'),
      ),
    );
    presets.appendChild(
      this.buildPreset(
        'Marked Doc',
        'Saves only the cards you marked.',
        {
          includeComments: false,
          includeAnalytics: false,
          includeUndertags: true,
          readMode: false,
          includeNotes: false,
          includeAiThreads: false,
          markedCardsOnly: true,
        },
        settings.get('markedDocPrefix'),
      ),
    );
    // Custom Save sits in the preset row, right of Marked Doc: it's
    // the fifth way to save, not a different kind of control. The
    // checkboxes it used to show inline now live in its sub-dialog.
    presets.appendChild(this.buildCustomSavePreset());
    form.appendChild(presets);

    // Previously saved folders — collapsed by default, and the user's
    // choice sticks (see save-locations-store). Omitted entirely on
    // hosts that can't write to a bare directory path.
    if (this.opts.allowSaveLocations) form.appendChild(this.buildLocationsSection());

    // Cancel sits alone at the very bottom.
    const footer = document.createElement('footer');
    footer.className = 'pmd-save-as-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pmd-save-as-btn pmd-save-as-btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.cancel());
    footer.appendChild(cancel);
    form.appendChild(footer);

    this.dialog.appendChild(form);
  }

  /** Build a preset cell: a primary (blue) button with its
   *  description as a caption below. Clicking the button saves
   *  immediately with the given content options (filename + format
   *  read live from the inputs). `prefix` is prepended to the file
   *  name (subject to the `prefixPresetSaveFilenames` setting). */
  private buildPreset(
    title: string,
    sub: string,
    opts: SaveContentOptions,
    prefix = '',
  ): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'pmd-save-as-preset';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-save-as-btn pmd-save-as-btn-primary pmd-save-as-preset-btn';
    btn.textContent = title;
    btn.addEventListener('click', () => this.confirmWith(opts, prefix));
    cell.appendChild(btn);
    const caption = document.createElement('span');
    caption.className = 'pmd-save-as-preset-sub';
    caption.textContent = sub;
    cell.appendChild(caption);
    return cell;
  }

  /** FILE NAME section: a heading + the file-name input. */
  private buildFileNameSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'pmd-save-as-field';
    const heading = document.createElement('div');
    heading.className = 'pmd-save-as-options-heading';
    heading.textContent = 'Name';
    wrap.appendChild(heading);
    this.filenameInput = document.createElement('input');
    this.filenameInput.type = 'text';
    this.filenameInput.className = 'pmd-save-as-input';
    this.filenameInput.value = withExtension(this.opts.initialFilename, this.currentFormat);
    this.filenameInput.spellcheck = false;
    this.filenameInput.autocomplete = 'off';
    wrap.appendChild(this.filenameInput);
    return wrap;
  }

  /** FORMAT section: a heading + the cmir / docx radio rows. */
  private buildFormatSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'pmd-save-as-format';
    const heading = document.createElement('div');
    heading.className = 'pmd-save-as-options-heading';
    heading.textContent = 'Format';
    wrap.appendChild(heading);

    const groupName = `pmd-save-as-format-${Math.random().toString(36).slice(2, 8)}`;
    this.formatRadios = { cmir: null!, docx: null! };
    for (const id of ['cmir', 'docx'] as const) {
      const row = document.createElement('label');
      row.className = 'pmd-save-as-format-row';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = groupName;
      input.value = id;
      input.checked = id === this.currentFormat;
      input.addEventListener('change', () => {
        if (input.checked) this.setFormat(id);
      });
      this.formatRadios[id] = input;
      row.appendChild(input);
      const text = document.createElement('span');
      text.className = 'pmd-save-as-format-row-text';
      const label = document.createElement('span');
      label.className = 'pmd-save-as-format-row-label';
      label.textContent = FORMAT_LABELS[id];
      text.appendChild(label);
      const blurb = document.createElement('span');
      blurb.className = 'pmd-save-as-format-row-blurb';
      blurb.textContent = FORMAT_BLURBS[id];
      text.appendChild(blurb);
      row.appendChild(text);
      wrap.appendChild(row);
    }
    return wrap;
  }

  /** Update the format and swap the filename's extension to match. */
  private setFormat(format: SaveAsFormat): void {
    this.currentFormat = format;
    this.filenameInput.value = withExtension(this.filenameInput.value, format);
  }

  /** The fifth preset cell: opens the Custom Save sub-dialog rather
   *  than saving straight away. */
  private buildCustomSavePreset(): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'pmd-save-as-preset';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-save-as-btn pmd-save-as-btn-primary pmd-save-as-preset-btn';
    btn.textContent = 'Custom Save';
    btn.addEventListener('click', () => this.openCustomSaveDialog());
    cell.appendChild(btn);
    const caption = document.createElement('span');
    caption.className = 'pmd-save-as-preset-sub';
    caption.textContent = 'Choose exactly what to include.';
    cell.appendChild(caption);
    return cell;
  }

  /** Custom Save: a small dialog stacked over this one with the five
   *  content checkboxes. Saving from it closes BOTH (it resolves the
   *  outer promise); cancelling closes only itself. */
  private openCustomSaveDialog(): void {
    const overlay = document.createElement('div');
    overlay.className = 'pmd-save-as-overlay pmd-save-as-custom-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'pmd-save-as-dialog pmd-save-as-custom-dialog';
    overlay.appendChild(dialog);

    const token = pushOverlay();
    let removeKeys: () => void = () => {};
    const close = (): void => {
      removeKeys();
      popOverlay(token);
      overlay.remove();
    };
    removeKeys = installModalKeys(dialog, token, (e) => {
      if (e.key === 'Escape') {
        close();
        return true;
      }
      return false;
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const header = document.createElement('header');
    header.className = 'pmd-save-as-header';
    const title = document.createElement('h2');
    title.textContent = 'Custom Save';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pmd-save-as-close';
    setIcon(closeBtn, 'close');
    closeBtn.title = 'Cancel';
    closeBtn.addEventListener('click', () => close());
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    const form = document.createElement('form');
    form.className = 'pmd-save-as-body';

    const options = document.createElement('div');
    options.className = 'pmd-save-as-options';
    const comments = buildCheckbox('Include comments', true);
    const analytics = buildCheckbox('Include analytics', true);
    const undertags = buildCheckbox('Include undertags', true);
    // Private annotation layers — off by default (they normally never
    // leave CardMirror). Checking them bakes the notes / AI threads into
    // the saved file as real Word-style comments.
    const notes = buildCheckbox('Include private notes (as comments)', false);
    const aiThreads = buildCheckbox('Include AI comments (as comments)', false);
    for (const box of [comments, analytics, undertags, notes, aiThreads]) {
      options.appendChild(box.parentElement!);
    }
    form.appendChild(options);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      close();
      this.confirmWith({
        includeComments: comments.checked,
        includeAnalytics: analytics.checked,
        includeUndertags: undertags.checked,
        readMode: false,
        includeNotes: notes.checked,
        includeAiThreads: aiThreads.checked,
        markedCardsOnly: false,
      });
    });

    const footer = document.createElement('footer');
    footer.className = 'pmd-save-as-footer pmd-save-as-custom-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pmd-save-as-btn pmd-save-as-btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close());
    footer.appendChild(cancel);
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'pmd-save-as-btn pmd-save-as-btn-primary';
    save.textContent = 'Save';
    footer.appendChild(save);
    form.appendChild(footer);

    dialog.appendChild(form);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => comments.focus());
  }

  /** "Save in a previously saved location": a disclosure whose open /
   *  closed state persists, wrapping one row per remembered folder.
   *  Clicking a row saves there immediately (As-Is, with the Name and
   *  Format above); the pin keeps a folder at the top of the list. */
  private buildLocationsSection(): HTMLElement {
    const wrap = document.createElement('section');
    wrap.className = 'pmd-save-as-locations';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'pmd-save-as-locations-toggle';
    const caret = document.createElement('span');
    caret.className = 'pmd-save-as-locations-caret';
    caret.setAttribute('aria-hidden', 'true');
    toggle.appendChild(caret);
    const toggleText = document.createElement('span');
    toggleText.textContent = 'Save in a previously saved location';
    toggle.appendChild(toggleText);
    wrap.appendChild(toggle);

    const list = document.createElement('div');
    list.className = 'pmd-save-as-locations-list';
    wrap.appendChild(list);

    const apply = (open: boolean): void => {
      wrap.classList.toggle('pmd-save-as-locations-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      list.hidden = !open;
    };
    toggle.addEventListener('click', () => {
      const next = !wrap.classList.contains('pmd-save-as-locations-open');
      setSaveLocationsExpanded(next);
      apply(next);
    });

    this.renderLocations(list);
    apply(saveLocationsExpanded());
    return wrap;
  }

  /** (Re)fill the folder list — called again after a pin toggles, so
   *  the row jumps to its new position immediately. */
  private renderLocations(list: HTMLElement): void {
    list.textContent = '';
    const locations = listSaveLocations();
    if (locations.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'pmd-save-as-locations-empty';
      empty.textContent = 'No saved locations yet — they appear here after you save somewhere.';
      list.appendChild(empty);
      return;
    }
    for (const loc of locations) {
      const row = document.createElement('div');
      row.className = 'pmd-save-as-location';
      if (loc.pinnedAt !== null) row.classList.add('pmd-save-as-location-pinned');

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'pmd-save-as-location-open';
      openBtn.title = `Save into ${loc.dir}`;
      const path = document.createElement('span');
      path.className = 'pmd-save-as-location-path';
      // Truncates on the LEFT (CSS `direction: rtl`) so the tail — the
      // folder that actually identifies it — stays readable. The LRM
      // guards stop bidi floating the leading separator to the end.
      path.textContent = `\u{200e}${loc.dir}\u{200e}`;
      openBtn.appendChild(path);
      openBtn.addEventListener('click', () => {
        this.confirmWith(AS_IS_OPTIONS, '', loc.dir);
      });
      row.appendChild(openBtn);

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pmd-save-as-location-pin';
      const pinned = loc.pinnedAt !== null;
      pin.textContent = pinned ? '★' : '☆';
      pin.title = pinned ? 'Unpin this location' : 'Pin this location to the top';
      pin.setAttribute('aria-label', pin.title);
      pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSaveLocationPin(loc.dir);
        this.renderLocations(list);
      });
      row.appendChild(pin);

      list.appendChild(row);
    }
  }

  /** Save with the given content options + the live filename /
   *  format. Shared by every preset, the Custom Save sub-dialog, and a
   *  click on a remembered folder. `prefix` (from the Send/Read/Marked
   *  Doc presets) is prepended to the file name when the
   *  `prefixPresetSaveFilenames` setting is on. `destinationDir` skips
   *  the OS picker. No-op on an empty filename. */
  private confirmWith(
    opts: SaveContentOptions,
    prefix = '',
    destinationDir?: string,
  ): void {
    const trimmed = this.filenameInput.value.trim();
    if (!trimmed) return;
    const named = withExtension(trimmed, this.currentFormat);
    const usePrefix = prefix && settings.get('prefixPresetSaveFilenames');
    this.finish({
      filename: usePrefix ? prefix + named : named,
      format: this.currentFormat,
      ...opts,
      ...(destinationDir ? { destinationDir } : {}),
    });
  }

  private cancel(): void {
    this.finish(null);
  }

  private finish(result: SaveAsResult | null): void {
    if (this.settled) return;
    this.settled = true;
    this.removeKeys();
    popOverlay(this.overlayToken);
    this.overlay.remove();
    this.restoreFocus();
    this.settle(result);
  }
}

/** A labelled checkbox row, returned as the input itself (its label is
 *  `box.parentElement`). */
function buildCheckbox(labelText: string, defaultChecked: boolean): HTMLInputElement {
  const label = document.createElement('label');
  label.className = 'pmd-save-as-option';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = defaultChecked;
  label.appendChild(box);
  const text = document.createElement('span');
  text.textContent = labelText;
  label.appendChild(text);
  return box;
}

/** Normalize a filename to end with the right extension for the
 *  chosen format. Strips other known extensions first so swapping
 *  the format radio replaces `.docx` with `.cmir` and vice versa
 *  without piling them up. */
function withExtension(filename: string, format: SaveAsFormat): string {
  let base = filename.trim();
  for (const ext of ['.cmir', '.docx']) {
    if (base.toLowerCase().endsWith(ext)) {
      base = base.slice(0, -ext.length);
      break;
    }
  }
  return `${base}.${format}`;
}
