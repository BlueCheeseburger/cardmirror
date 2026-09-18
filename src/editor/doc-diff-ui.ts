/**
 * "Compare documents" — home-screen entry point for doc-diff.ts.
 *
 * Two steps in one overlay (content swaps in place, same convention as
 * `web-file-tools.ts`'s progress modal): pick two files, then see a
 * side-by-side diff of their text — added/removed lines colored the way
 * a code diff (GitHub, `git diff --color`) shows them. Neither file
 * becomes the live doc; both are parsed straight from their bytes and
 * thrown away when the dialog closes.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { getHost } from './host/index.js';
import type { FileFilter } from './host/types.js';
import { alertDialog } from './text-prompt.js';
import { installModalKeys, captureFocusForDialog, armDialogFocus } from './text-prompt.js';
import { pushOverlay, popOverlay } from './overlay-stack.js';
import { parseNative } from '../native/index.js';
import { fromDocxFull } from '../import/index.js';
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

  private renderPicker(): void {
    this.dialog.replaceChildren();
    armDialogFocus(this.dialog, 'dialog', 'Compare documents');
    this.dialog.classList.remove('pmd-doc-diff-dialog-wide');

    const heading = document.createElement('h2');
    heading.className = 'pmd-doc-diff-heading';
    heading.textContent = 'Compare documents';
    this.dialog.appendChild(heading);

    const blurb = document.createElement('p');
    blurb.className = 'pmd-doc-diff-blurb';
    blurb.textContent = 'Choose two .cmir or .docx files to see a line-by-line diff of their text.';
    this.dialog.appendChild(blurb);

    const rows = document.createElement('div');
    rows.className = 'pmd-doc-diff-picker-rows';
    rows.appendChild(this.pickerRow('First document', this.a, () => void this.pick('a')));
    rows.appendChild(this.pickerRow('Second document', this.b, () => void this.pick('b')));
    this.dialog.appendChild(rows);

    const footer = document.createElement('div');
    footer.className = 'pmd-doc-diff-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pmd-doc-diff-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.close());
    const compare = document.createElement('button');
    compare.type = 'button';
    compare.className = 'pmd-doc-diff-btn pmd-doc-diff-btn-primary';
    compare.textContent = 'Compare';
    compare.disabled = !this.a || !this.b;
    compare.addEventListener('click', () => void this.runCompare());
    footer.append(cancel, compare);
    this.dialog.appendChild(footer);
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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-doc-diff-btn';
    btn.textContent = picked ? 'Change…' : 'Choose…';
    btn.addEventListener('click', onPick);
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
    this.renderResults(a.name, b.name, lines);
  }

  private renderWorking(): void {
    this.dialog.replaceChildren();
    const label = document.createElement('div');
    label.className = 'pmd-doc-diff-working';
    label.setAttribute('role', 'status');
    label.textContent = 'Comparing…';
    this.dialog.appendChild(label);
  }

  private renderResults(nameA: string, nameB: string, lines: ReturnType<typeof diffLines>): void {
    this.dialog.replaceChildren();
    armDialogFocus(this.dialog, 'dialog', `Comparing ${nameA} and ${nameB}`);
    this.dialog.classList.add('pmd-doc-diff-dialog-wide');

    const header = document.createElement('div');
    header.className = 'pmd-doc-diff-results-header';
    const names = document.createElement('div');
    names.className = 'pmd-doc-diff-names';
    const nameAEl = document.createElement('span');
    nameAEl.className = 'pmd-doc-diff-name pmd-doc-diff-name-remove';
    nameAEl.textContent = nameA;
    const vs = document.createElement('span');
    vs.className = 'pmd-doc-diff-vs';
    vs.textContent = '→';
    const nameBEl = document.createElement('span');
    nameBEl.className = 'pmd-doc-diff-name pmd-doc-diff-name-add';
    nameBEl.textContent = nameB;
    names.append(nameAEl, vs, nameBEl);
    header.appendChild(names);

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
      summary.append(addEl, document.createTextNode(' '), removeEl, document.createTextNode(' line' + (added + removed === 1 ? '' : 's') + ' changed'));
    }
    header.appendChild(summary);
    this.dialog.appendChild(header);

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
    this.dialog.appendChild(table);

    const footer = document.createElement('div');
    footer.className = 'pmd-doc-diff-footer';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'pmd-doc-diff-btn';
    back.textContent = 'Compare different files';
    back.addEventListener('click', () => this.renderPicker());
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pmd-doc-diff-btn pmd-doc-diff-btn-primary';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    footer.append(back, close);
    this.dialog.appendChild(footer);
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
