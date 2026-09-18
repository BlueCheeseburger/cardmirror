/**
 * "Compare documents" — home-screen entry point for doc-diff.ts.
 *
 * Two steps in one overlay (content swaps in place, same convention as
 * `web-file-tools.ts`'s progress modal): pick two files, then see a
 * side-by-side diff of their text — added/removed lines colored the way
 * a code diff (GitHub, `git diff --color`) shows them. Neither file
 * becomes the live doc; both are parsed straight from their bytes and
 * thrown away when the dialog closes.
 *
 * Fullscreen, not a bounded popup (field request, 2026-09-18) — the
 * dialog fills the viewport, with a fixed topbar and independently
 * scrolling panes below it. The results step gets an outline rail on
 * each side, built from `collectHeadings` — the SAME doc-only heading
 * walk the real nav panel (`nav-panel.ts`) uses — so clicking a heading
 * scrolls the diff table to the matching line, without needing a live
 * EditorView (there isn't one here; both docs are parsed, never mounted).
 */

import type { Node as PMNode } from 'prosemirror-model';
import { getHost } from './host/index.js';
import type { FileFilter } from './host/types.js';
import { alertDialog } from './text-prompt.js';
import { installModalKeys, captureFocusForDialog, armDialogFocus } from './text-prompt.js';
import { pushOverlay, popOverlay } from './overlay-stack.js';
import { parseNative } from '../native/index.js';
import { fromDocxFull } from '../import/index.js';
import { collectHeadings, TYPE_LABEL, type HeadingEntry } from './headings.js';
import { extractDiffLines, diffLines, toDiffRows, summarize, DiffTooLargeError, type DiffRow } from './doc-diff.js';

const DOC_FILTERS: FileFilter[] = [{ name: 'CardMirror / Word documents', extensions: ['cmir', 'docx'] }];

/** A `.docx` is a zip and starts `PK`; native `.cmir` never does —
 *  the same sniff `index.ts`'s own open path uses, kept local here so
 *  this feature doesn't import from that large, side-effecting module. */
function bytesLookLikeDocx(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function parseDiffDoc(bytes: Uint8Array): Promise<PMNode> {
  if (bytesLookLikeDocx(bytes)) return (await fromDocxFull(bytes)).doc;
  return parseNative(bytes).doc;
}

interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

class DocDiffModal {
  private readonly overlay: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly overlayToken = pushOverlay();
  private readonly restoreFocus: () => void;
  private readonly removeKeys: () => void;
  private a: PickedFile | null = null;
  private b: PickedFile | null = null;
  private closed = false;
  /** Rows keyed by their (trimmed) text, one array per occurrence — a
   *  heading title (e.g. a short tag) can repeat, so the Nth outline
   *  entry with that text jumps to the Nth row with that text, not
   *  always the first. Rebuilt on every `renderResults`. */
  private leftRowsByText = new Map<string, HTMLElement[]>();
  private rightRowsByText = new Map<string, HTMLElement[]>();

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'pmd-doc-diff-overlay';
    this.dialog = document.createElement('div');
    this.dialog.className = 'pmd-doc-diff-dialog';
    this.overlay.appendChild(this.dialog);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.restoreFocus = captureFocusForDialog();
    this.removeKeys = installModalKeys(this.dialog, this.overlayToken, (e) => {
      if (e.key === 'Escape') {
        this.close();
        return true;
      }
      return false;
    });

    this.renderPicker();
    document.body.appendChild(this.overlay);
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.removeKeys();
    popOverlay(this.overlayToken);
    this.overlay.remove();
    this.restoreFocus();
  }

  private async pick(side: 'a' | 'b'): Promise<void> {
    let opened;
    try {
      opened = await getHost().openFile({ filters: DOC_FILTERS });
    } catch (err) {
      void alertDialog(`Couldn't open the file: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (!opened) return;
    const picked: PickedFile = { name: opened.name, bytes: opened.bytes };
    if (side === 'a') this.a = picked;
    else this.b = picked;
    this.renderPicker();
  }

  private topbar(infoEl: HTMLElement, actions: HTMLElement[]): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pmd-doc-diff-topbar';
    const info = document.createElement('div');
    info.className = 'pmd-doc-diff-topbar-info';
    info.appendChild(infoEl);
    bar.appendChild(info);
    const actionsEl = document.createElement('div');
    actionsEl.className = 'pmd-doc-diff-topbar-actions';
    actionsEl.append(...actions);
    bar.appendChild(actionsEl);
    return bar;
  }

  private button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = primary ? 'pmd-doc-diff-btn pmd-doc-diff-btn-primary' : 'pmd-doc-diff-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private renderPicker(): void {
    this.dialog.replaceChildren();
    armDialogFocus(this.dialog, 'dialog', 'Compare documents');

    const titleWrap = document.createElement('div');
    const heading = document.createElement('h2');
    heading.className = 'pmd-doc-diff-heading';
    heading.textContent = 'Compare documents';
    titleWrap.appendChild(heading);
    const cancel = this.button('Cancel', false, () => this.close());
    const compare = this.button('Compare', true, () => void this.runCompare());
    compare.disabled = !this.a || !this.b;
    this.dialog.appendChild(this.topbar(titleWrap, [cancel, compare]));

    const body = document.createElement('div');
    body.className = 'pmd-doc-diff-picker-body';
    const blurb = document.createElement('p');
    blurb.className = 'pmd-doc-diff-blurb';
    blurb.textContent = 'Choose two .cmir or .docx files to see a line-by-line diff of their text.';
    body.appendChild(blurb);

    const rows = document.createElement('div');
    rows.className = 'pmd-doc-diff-picker-rows';
    rows.appendChild(this.pickerRow('First document', this.a, () => void this.pick('a')));
    rows.appendChild(this.pickerRow('Second document', this.b, () => void this.pick('b')));
    body.appendChild(rows);
    this.dialog.appendChild(body);
  }

  private pickerRow(label: string, picked: PickedFile | null, onPick: () => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pmd-doc-diff-picker-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'pmd-doc-diff-picker-label';
    labelEl.textContent = label;
    const nameEl = document.createElement('span');
    nameEl.className = 'pmd-doc-diff-picker-name';
    nameEl.textContent = picked ? picked.name : 'No file chosen';
    if (!picked) nameEl.classList.add('pmd-doc-diff-picker-name-empty');
    const btn = this.button(picked ? 'Change…' : 'Choose…', false, onPick);
    row.append(labelEl, nameEl, btn);
    return row;
  }

  private async runCompare(): Promise<void> {
    if (!this.a || !this.b) return;
    const { a, b } = this;
    this.renderWorking();
    let docA: PMNode;
    let docB: PMNode;
    try {
      [docA, docB] = await Promise.all([parseDiffDoc(a.bytes), parseDiffDoc(b.bytes)]);
    } catch (err) {
      this.renderPicker();
      void alertDialog(`Couldn't read one of the documents: ${err instanceof Error ? err.message : err}`);
      return;
    }
    let lines;
    try {
      lines = diffLines(extractDiffLines(docA), extractDiffLines(docB));
    } catch (err) {
      this.renderPicker();
      if (err instanceof DiffTooLargeError) {
        void alertDialog(err.message);
      } else {
        void alertDialog(`Couldn't compare these documents: ${err instanceof Error ? err.message : err}`);
      }
      return;
    }
    this.renderResults(a.name, b.name, docA, docB, lines);
  }

  private renderWorking(): void {
    this.dialog.replaceChildren();
    armDialogFocus(this.dialog, 'dialog', 'Compare documents');
    const label = document.createElement('div');
    label.className = 'pmd-doc-diff-working';
    label.setAttribute('role', 'status');
    label.textContent = 'Comparing…';
    this.dialog.appendChild(label);
  }

  private renderResults(
    nameA: string,
    nameB: string,
    docA: PMNode,
    docB: PMNode,
    lines: ReturnType<typeof diffLines>,
  ): void {
    this.dialog.replaceChildren();
    armDialogFocus(this.dialog, 'dialog', `Comparing ${nameA} and ${nameB}`);
    this.leftRowsByText = new Map();
    this.rightRowsByText = new Map();

    const info = document.createElement('div');
    const names = document.createElement('div');
    names.className = 'pmd-doc-diff-names';
    const nameAEl = document.createElement('span');
    nameAEl.className = 'pmd-doc-diff-name-remove';
    nameAEl.textContent = nameA;
    const vs = document.createElement('span');
    vs.className = 'pmd-doc-diff-vs';
    vs.textContent = '→';
    const nameBEl = document.createElement('span');
    nameBEl.className = 'pmd-doc-diff-name-add';
    nameBEl.textContent = nameB;
    names.append(nameAEl, vs, nameBEl);
    info.appendChild(names);

    const { added, removed, unchanged } = summarize(lines);
    const summary = document.createElement('div');
    summary.className = 'pmd-doc-diff-summary';
    if (added === 0 && removed === 0) {
      summary.textContent = unchanged === 0 ? 'Both documents are empty.' : 'No differences.';
    } else {
      const addEl = document.createElement('span');
      addEl.className = 'pmd-doc-diff-summary-add';
      addEl.textContent = `+${added}`;
      const removeEl = document.createElement('span');
      removeEl.className = 'pmd-doc-diff-summary-remove';
      removeEl.textContent = `−${removed}`;
      summary.append(
        addEl,
        document.createTextNode(' '),
        removeEl,
        document.createTextNode(' line' + (added + removed === 1 ? '' : 's') + ' changed'),
      );
    }
    info.appendChild(summary);

    const back = this.button('Compare different files', false, () => this.renderPicker());
    const close = this.button('Close', true, () => this.close());
    this.dialog.appendChild(this.topbar(info, [back, close]));

    const body = document.createElement('div');
    body.className = 'pmd-doc-diff-results-body';

    const table = document.createElement('div');
    table.className = 'pmd-doc-diff-table';
    table.setAttribute('role', 'table');
    if (added === 0 && removed === 0 && unchanged === 0) {
      const empty = document.createElement('p');
      empty.className = 'pmd-doc-diff-empty';
      empty.textContent = 'Neither document has any readable text.';
      table.appendChild(empty);
    } else {
      for (const row of toDiffRows(lines)) table.appendChild(this.buildRow(row));
    }

    body.appendChild(this.buildOutline(nameA, docA, 'left'));
    body.appendChild(table);
    body.appendChild(this.buildOutline(nameB, docB, 'right'));
    this.dialog.appendChild(body);
  }

  /** A read-only outline rail for one side, built from the SAME doc-only
   *  heading walk the real nav panel uses (`collectHeadings` —
   *  `headings.ts`, shared with `nav-panel.ts`). `skipCite: true`: this
   *  view has no use for cite text, and it's the bulk of that function's
   *  cost on a long doc. Clicking an entry scrolls the diff table to the
   *  matching row (matched by text, since these docs were never mounted
   *  into an EditorView — there's no live position to jump to). */
  private buildOutline(name: string, doc: PMNode, side: 'left' | 'right'): HTMLElement {
    const rail = document.createElement('div');
    rail.className = `pmd-doc-diff-outline pmd-doc-diff-outline-${side}`;
    const title = document.createElement('div');
    title.className = 'pmd-doc-diff-outline-title';
    title.textContent = name;
    rail.appendChild(title);

    const entries = collectHeadings(doc, { skipCite: true });
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'pmd-doc-diff-outline-empty';
      empty.textContent = 'No headings.';
      rail.appendChild(empty);
      return rail;
    }

    const rowsByText = side === 'left' ? this.leftRowsByText : this.rightRowsByText;
    const claimed = new Map<string, number>();
    for (const entry of entries) {
      rail.appendChild(this.outlineEntry(entry, rowsByText, claimed));
    }
    return rail;
  }

  private outlineEntry(
    entry: HeadingEntry,
    rowsByText: Map<string, HTMLElement[]>,
    claimed: Map<string, number>,
  ): HTMLElement {
    const text = entry.text.trim();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-doc-diff-outline-entry';
    btn.style.paddingLeft = `${0.75 + (entry.level - 1) * 0.85}rem`;
    btn.textContent = text || `(untitled ${TYPE_LABEL[entry.type] ?? entry.type})`;
    btn.title = `${TYPE_LABEL[entry.type] ?? entry.type}${text ? `: ${text}` : ''}`;

    const occurrence = claimed.get(text) ?? 0;
    claimed.set(text, occurrence + 1);
    const target = rowsByText.get(text)?.[occurrence];
    if (!target) {
      // No matching diff line — an empty-titled heading, or text this
      // side's flattened line list otherwise never produced. Nothing to
      // jump to; leave it visible but inert rather than hiding it (the
      // outline should still reflect the document's real structure).
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        target.scrollIntoView({ block: 'center' });
        target.classList.add('pmd-doc-diff-cell-highlight');
        window.setTimeout(() => target.classList.remove('pmd-doc-diff-cell-highlight'), 900);
      });
    }
    return btn;
  }

  private buildRow(row: DiffRow): HTMLElement {
    const rowEl = document.createElement('div');
    rowEl.className = 'pmd-doc-diff-row';
    rowEl.setAttribute('role', 'row');
    rowEl.appendChild(this.buildCell(row.left, 'left'));
    rowEl.appendChild(this.buildCell(row.right, 'right'));
    return rowEl;
  }

  private buildCell(cell: DiffRow['left'], side: 'left' | 'right'): HTMLElement {
    const el = document.createElement('div');
    el.className = `pmd-doc-diff-cell pmd-doc-diff-cell-${side} pmd-doc-diff-cell-${cell.type}`;
    el.setAttribute('role', 'cell');
    if (cell.type !== 'blank') {
      const marker = document.createElement('span');
      marker.className = 'pmd-doc-diff-marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = cell.type === 'add' ? '+' : cell.type === 'remove' ? '−' : ' ';
      const text = document.createElement('span');
      text.className = 'pmd-doc-diff-text';
      text.textContent = cell.text;
      el.append(marker, text);

      const rowsByText = side === 'left' ? this.leftRowsByText : this.rightRowsByText;
      const key = cell.text.trim();
      const list = rowsByText.get(key);
      if (list) list.push(el);
      else rowsByText.set(key, [el]);
    }
    return el;
  }
}

/** Open the "Compare documents" dialog. Home-screen action; also
 *  reachable while a doc is open (neither file it compares becomes the
 *  live document). */
export function openDocDiff(): void {
  new DocDiffModal();
}
