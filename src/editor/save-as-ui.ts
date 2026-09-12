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
 * Layout: a Name section, a Format section, a Save section — a radio
 * list (As-Is / Send Doc / Read Doc / Marked Doc / Custom Save, the
 * last revealing its five content checkboxes inline when selected) —
 * a "Save in a previously saved location" section (also a radio list:
 * "Choose location when saving" plus one row per remembered folder),
 * then Cancel and a single "Save As" button at the bottom. Choosing a
 * save mode or a location only SELECTS it; nothing writes anything
 * until Save As is clicked (or Enter is pressed in the Name field) —
 * every earlier version of this dialog saved the instant you clicked
 * a preset or a folder, which meant "just look at what Send Doc would
 * exclude" wasn't a safe thing to click. The format radio drives the
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
  /** Set when the user selected a remembered folder instead of "Choose
   *  location when saving": write `filename` straight into this
   *  directory and skip the OS picker. Absent otherwise. */
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

const FORMAT_BLURBS: Record<SaveAsFormat, string> = {
  cmir: 'Lossless. No conversion. Best for docs that stay in CardMirror.',
  docx: 'For sharing with Verbatim users or any Word-based workflow.',
};

/** The content half of a `SaveAsResult` — everything except where the
 *  bytes go. */
type SaveContentOptions = Omit<SaveAsResult, 'filename' | 'format' | 'destinationDir'>;

/** What "save everything" means — the As-Is mode, the Enter-key
 *  submit (nothing else selected), and "Choose location when saving"
 *  paired with no mode change all land here by default. Anything
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

type SaveMode = 'asIs' | 'sendDoc' | 'readDoc' | 'markedDoc' | 'custom';

interface ModeDef {
  id: SaveMode;
  label: string;
  description: string;
  /** Fixed content options for every mode except `custom`, whose
   *  options come from its five inline checkboxes instead. */
  options: SaveContentOptions | null;
  /** Settings key for this mode's filename prefix (subject to
   *  `prefixPresetSaveFilenames`). Omitted for As-Is and Custom Save
   *  — neither has ever taken a prefix. */
  prefixSetting?: 'sendDocPrefix' | 'readDocPrefix' | 'markedDocPrefix';
}

const MODE_DEFS: ModeDef[] = [
  {
    id: 'asIs',
    label: 'As-Is',
    description: 'Includes everything in the document.',
    options: AS_IS_OPTIONS,
  },
  {
    id: 'sendDoc',
    label: 'Send Doc',
    description: 'Excludes analytics, undertags, and comments.',
    options: {
      includeComments: false,
      includeAnalytics: false,
      includeUndertags: false,
      readMode: false,
      includeNotes: false,
      includeAiThreads: false,
      markedCardsOnly: false,
    },
    prefixSetting: 'sendDocPrefix',
  },
  {
    id: 'readDoc',
    label: 'Read Doc',
    description: 'Exports the read-mode view of the document.',
    options: {
      includeComments: false,
      includeAnalytics: false,
      includeUndertags: false,
      readMode: true,
      includeNotes: false,
      includeAiThreads: false,
      markedCardsOnly: false,
    },
    prefixSetting: 'readDocPrefix',
  },
  {
    id: 'markedDoc',
    label: 'Marked Doc',
    description: 'Saves only the cards you marked.',
    options: {
      includeComments: false,
      includeAnalytics: false,
      includeUndertags: true,
      readMode: false,
      includeNotes: false,
      includeAiThreads: false,
      markedCardsOnly: true,
    },
    prefixSetting: 'markedDocPrefix',
  },
  {
    id: 'custom',
    label: 'Custom Save',
    description: 'Choose exactly what to include.',
    options: null,
  },
];

class SaveAsModal {
  private readonly overlay: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private filenameInput!: HTMLInputElement;
  /** Radio inputs keyed by format id. */
  private formatRadios!: Record<SaveAsFormat, HTMLInputElement>;
  /** Radio inputs keyed by save mode. */
  private modeRadios!: Record<SaveMode, HTMLInputElement>;
  /** Custom Save's five checkboxes, shown inline under its row only
   *  while that mode is selected. */
  private customComments!: HTMLInputElement;
  private customAnalytics!: HTMLInputElement;
  private customUndertags!: HTMLInputElement;
  private customNotes!: HTMLInputElement;
  private customAiThreads!: HTMLInputElement;
  private customOptionsEl!: HTMLElement;
  /** The location radio group (present only when `allowSaveLocations`). */
  private locationList: HTMLElement | null = null;
  private settled = false;
  private currentFormat: SaveAsFormat;
  private currentMode: SaveMode = 'asIs';
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
      // through natively (Enter in the filename field, or on any
      // radio, submits the form via the Save As button); keys aimed
      // anywhere else are swallowed by the helper.
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
    // Enter anywhere in the form (the Name field, or a focused radio)
    // is the keyboard equivalent of clicking Save As — commits with
    // whatever's currently selected, same as the button.
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.commit();
    });

    // FILE NAME and FORMAT — the what/where, each under its heading.
    form.appendChild(this.buildFileNameSection());
    form.appendChild(this.buildFormatSection());
    form.appendChild(this.buildModeSection());

    // Previously saved folders — collapsed by default, and the user's
    // choice sticks (see save-locations-store). Omitted entirely on
    // hosts that can't write to a bare directory path.
    if (this.opts.allowSaveLocations) form.appendChild(this.buildLocationsSection());

    const footer = document.createElement('footer');
    footer.className = 'pmd-save-as-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pmd-save-as-btn pmd-save-as-btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.cancel());
    footer.appendChild(cancel);
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'pmd-save-as-btn pmd-save-as-btn-primary';
    save.textContent = 'Save As';
    footer.appendChild(save);
    form.appendChild(footer);

    this.dialog.appendChild(form);
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
    wrap.className = 'pmd-save-as-radio-list';
    const heading = document.createElement('div');
    heading.className = 'pmd-save-as-options-heading';
    heading.textContent = 'Format';
    wrap.appendChild(heading);

    const groupName = `pmd-save-as-format-${Math.random().toString(36).slice(2, 8)}`;
    this.formatRadios = { cmir: null!, docx: null! };
    for (const id of ['cmir', 'docx'] as const) {
      const row = buildRadioRow(groupName, id === this.currentFormat, FORMAT_LABELS[id], FORMAT_BLURBS[id]);
      row.input.value = id;
      row.input.addEventListener('change', () => {
        if (row.input.checked) this.setFormat(id);
      });
      this.formatRadios[id] = row.input;
      wrap.appendChild(row.el);
    }
    return wrap;
  }

  /** Update the format and swap the filename's extension to match. */
  private setFormat(format: SaveAsFormat): void {
    this.currentFormat = format;
    this.filenameInput.value = withExtension(this.filenameInput.value, format);
  }

  /** SAVE section: a heading + a radio row per mode. Custom Save's
   *  row carries the five content checkboxes right after it, shown
   *  only while that mode is the selected one. Selecting a mode never
   *  saves anything by itself — see the module doc comment. */
  private buildModeSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'pmd-save-as-radio-list';
    const heading = document.createElement('div');
    heading.className = 'pmd-save-as-options-heading';
    heading.textContent = 'Save';
    wrap.appendChild(heading);

    const groupName = `pmd-save-as-mode-${Math.random().toString(36).slice(2, 8)}`;
    this.modeRadios = { asIs: null!, sendDoc: null!, readDoc: null!, markedDoc: null!, custom: null! };
    for (const def of MODE_DEFS) {
      const row = buildRadioRow(groupName, def.id === this.currentMode, def.label, def.description);
      row.input.value = def.id;
      row.input.addEventListener('change', () => {
        if (row.input.checked) this.setMode(def.id);
      });
      this.modeRadios[def.id] = row.input;
      wrap.appendChild(row.el);
      if (def.id === 'custom') {
        wrap.appendChild(this.buildCustomOptions());
      }
    }
    this.applyModeVisibility();
    return wrap;
  }

  /** The five Custom Save checkboxes, indented under its radio row.
   *  Built once; `applyModeVisibility` toggles `hidden`. */
  private buildCustomOptions(): HTMLElement {
    const options = document.createElement('div');
    options.className = 'pmd-save-as-custom-options';
    this.customComments = this.appendCheckbox(options, 'Include comments', true);
    this.customAnalytics = this.appendCheckbox(options, 'Include analytics', true);
    this.customUndertags = this.appendCheckbox(options, 'Include undertags', true);
    // Private annotation layers — off by default (they normally never
    // leave CardMirror). Checking them bakes the notes / AI threads
    // into the saved file as real Word-style comments.
    this.customNotes = this.appendCheckbox(options, 'Include private notes (as comments)', false);
    this.customAiThreads = this.appendCheckbox(options, 'Include AI comments (as comments)', false);
    this.customOptionsEl = options;
    return options;
  }

  private appendCheckbox(parent: HTMLElement, labelText: string, defaultChecked: boolean): HTMLInputElement {
    const box = buildCheckbox(labelText, defaultChecked);
    parent.appendChild(box.parentElement!);
    return box;
  }

  private setMode(mode: SaveMode): void {
    this.currentMode = mode;
    this.applyModeVisibility();
  }

  private applyModeVisibility(): void {
    this.customOptionsEl.hidden = this.currentMode !== 'custom';
  }

  /** The currently-selected mode's content options — the fixed set for
   *  every mode except Custom Save, whose checkboxes decide live. */
  private currentContentOptions(): SaveContentOptions {
    if (this.currentMode === 'custom') {
      return {
        includeComments: this.customComments.checked,
        includeAnalytics: this.customAnalytics.checked,
        includeUndertags: this.customUndertags.checked,
        readMode: false,
        includeNotes: this.customNotes.checked,
        includeAiThreads: this.customAiThreads.checked,
        markedCardsOnly: false,
      };
    }
    return MODE_DEFS.find((d) => d.id === this.currentMode)!.options!;
  }

  /** "Save in a previously saved location": a disclosure whose open /
   *  closed state persists. Its FIRST row is always "Choose location
   *  when saving" (the OS picker, selected by default); each
   *  remembered folder is a peer radio row below it, so picking one
   *  is a normal selection — like every other choice in this dialog,
   *  it takes effect on Save As, not on click. The pin still keeps a
   *  folder at the top of the list. */
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
    this.locationList = list;

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
   *  the row jumps to its new position immediately. Preserves the
   *  current selection when the selected folder is still in the list
   *  (a pin/unpin never changes what happens on Save As). */
  private renderLocations(list: HTMLElement): void {
    const selected = list.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value;
    list.textContent = '';
    const groupName = `pmd-save-as-location-${Math.random().toString(36).slice(2, 8)}`;

    // Empty-string value: nothing selected in this group ever reads
    // as "pick a remembered folder" — an empty `selectedDir` at commit
    // time already means "use the OS dialog", so this row needs no
    // special sentinel to compare against.
    const dialogRow = buildRadioRow(
      groupName,
      !selected,
      'Choose location when saving',
      'Opens the file dialog, like Save As always has.',
    );
    // An <input type="radio"> with no explicit value defaults to
    // "on", not "" — set it explicitly so "nothing selected" and
    // "this row selected" read the same way at commit time.
    dialogRow.input.value = '';
    dialogRow.el.classList.add('pmd-save-as-location-dialog-row');
    list.appendChild(dialogRow.el);

    const locations = listSaveLocations();
    for (const loc of locations) {
      const row = document.createElement('label');
      row.className = 'pmd-save-as-location';
      if (loc.pinnedAt !== null) row.classList.add('pmd-save-as-location-pinned');

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = groupName;
      input.value = loc.dir;
      input.checked = selected === loc.dir;
      row.appendChild(input);

      const path = document.createElement('span');
      path.className = 'pmd-save-as-location-path';
      path.title = loc.dir;
      // Truncates on the LEFT (CSS `direction: rtl`) so the tail — the
      // folder that actually identifies it — stays readable. The LRM
      // guards stop bidi floating the leading separator to the end.
      path.textContent = `\u{200e}${loc.dir}\u{200e}`;
      row.appendChild(path);

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pmd-save-as-location-pin';
      const pinned = loc.pinnedAt !== null;
      pin.textContent = pinned ? '★' : '☆';
      pin.title = pinned ? 'Unpin this location' : 'Pin this location to the top';
      pin.setAttribute('aria-label', pin.title);
      pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      pin.addEventListener('click', (e) => {
        // Stop this from ALSO activating the row's radio (its native
        // <label> behavior) — pinning is not selecting.
        e.preventDefault();
        e.stopPropagation();
        toggleSaveLocationPin(loc.dir);
        this.renderLocations(list);
      });
      row.appendChild(pin);

      list.appendChild(row);
    }
    if (locations.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'pmd-save-as-locations-empty';
      empty.textContent = 'No saved locations yet — they appear here after you save somewhere.';
      list.appendChild(empty);
    }
  }

  /** Commit with the currently-selected mode, format, and location.
   *  Shared by the Save As button and Enter in the form. No-op on an
   *  empty filename. */
  private commit(): void {
    const trimmed = this.filenameInput.value.trim();
    if (!trimmed) return;
    const named = withExtension(trimmed, this.currentFormat);
    const def = MODE_DEFS.find((d) => d.id === this.currentMode)!;
    const prefix = def.prefixSetting ? settings.get(def.prefixSetting) : '';
    const usePrefix = !!prefix && settings.get('prefixPresetSaveFilenames');
    const destinationDir =
      this.locationList?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ||
      undefined;
    this.finish({
      filename: usePrefix ? prefix + named : named,
      format: this.currentFormat,
      ...this.currentContentOptions(),
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

/** One radio-row build shared by Format, Save mode, and the location
 *  list — a labelled radio with a bold title line and a muted blurb
 *  line below it. Returns both the row element and its input so the
 *  caller can wire `change` and track it by key. */
function buildRadioRow(
  groupName: string,
  checked: boolean,
  label: string,
  blurb: string,
): { el: HTMLLabelElement; input: HTMLInputElement } {
  const row = document.createElement('label');
  row.className = 'pmd-save-as-radio-row';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = groupName;
  input.checked = checked;
  row.appendChild(input);
  const text = document.createElement('span');
  text.className = 'pmd-save-as-radio-row-text';
  const labelEl = document.createElement('span');
  labelEl.className = 'pmd-save-as-radio-row-label';
  labelEl.textContent = label;
  text.appendChild(labelEl);
  const blurbEl = document.createElement('span');
  blurbEl.className = 'pmd-save-as-radio-row-blurb';
  blurbEl.textContent = blurb;
  text.appendChild(blurbEl);
  row.appendChild(text);
  return { el: row, input };
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
