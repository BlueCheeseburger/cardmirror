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
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { NavigationPanel } from './nav-panel.js';
import { extractDiffLines, diffLines, toDiffRows, summarize, wordDiff, DiffTooLargeError, type DiffRow } from './doc-diff.js';
import { planMerge, buildMerged, type MergePlan, type MergeChoice } from './doc-merge.js';
import { serializeNative } from '../native/index.js';
import { toDocx } from '../export/index.js';
import { settings } from './settings.js';

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
  /** The parsed pair behind the current results, kept for "Merge into new file". */
  private parsed: { docA: PMNode; docB: PMNode } | null = null;
  private closed = false;
  /** Hidden read-only views behind each side's real navigation panel. */
  private navViews: EditorView[] = [];
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
    this.destroyNavViews();
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
    this.destroyNavViews();
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
    blurb.textContent = 'Choose two .cmir or .docx files to see a line-by-line diff of their text, or merge them into one new file.';
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
    this.parsed = { docA, docB };
    this.renderResults(a.name, b.name, docA, docB, lines);
  }

  private renderMerge(): void {
    if (!this.a || !this.b || !this.parsed) return;
    const { a, b } = this;
    const { docA, docB } = this.parsed;
    let plan: MergePlan;
    try {
      plan = planMerge(docA, docB);
    } catch (err) {
      void alertDialog(
        err instanceof DiffTooLargeError
          ? err.message
          : `Couldn't merge these documents: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }
    this.destroyNavViews();
    this.dialog.replaceChildren();
    armDialogFocus(this.dialog, 'dialog', `Merging ${a.name} and ${b.name}`);

    const titleWrap = document.createElement('div');
    const heading = document.createElement('h2');
    heading.className = 'pmd-doc-diff-heading';
    heading.textContent = 'Merge into new file';
    const summary = document.createElement('div');
    summary.className = 'pmd-doc-diff-summary';
    summary.textContent =
      `${a.name} + ${b.name}: ${plan.onlyA} line${plan.onlyA === 1 ? '' : 's'} only in the first and ` +
      `${plan.onlyB} only in the second are kept; ${plan.conflicts} conflict${plan.conflicts === 1 ? '' : 's'}.`;
    titleWrap.append(heading, summary);
    const back = this.button('Back', false, () => void this.runCompare());
    const format = document.createElement('select');
    format.className = 'pmd-doc-merge-format';
    format.setAttribute('aria-label', 'File format');
    for (const [value, label] of [
      ['docx', 'Word (.docx)'],
      ['cmir', 'CardMirror (.cmir)'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      format.appendChild(opt);
    }
    const save = this.button('Save merged file…', true, () => void this.saveMerged(plan, format.value === 'cmir'));
    this.dialog.appendChild(this.topbar(titleWrap, [back, format, save]));

    const body = document.createElement('div');
    body.className = 'pmd-doc-diff-picker-body pmd-doc-merge-body';
    const blurb = document.createElement('p');
    blurb.className = 'pmd-doc-diff-blurb';
    blurb.textContent =
      plan.conflicts === 0
        ? 'The two documents don\u2019t conflict anywhere. Saving combines them into a new file.'
        : 'These lines were edited differently in each document. Pick which version goes in the merged file; everything else is combined automatically.';
    body.appendChild(blurb);

    for (const item of plan.items) {
      if (item.kind !== 'conflict') continue;
      const box = document.createElement('div');
      box.className = 'pmd-doc-merge-conflict';
      const { left, right } = wordDiff(item.a.text, item.b.text);
      const side = (label: string, segs: typeof left, tag: 'del' | 'ins'): HTMLElement => {
        const el = document.createElement('div');
        el.className = 'pmd-doc-merge-version';
        const lab = document.createElement('span');
        lab.className = 'pmd-doc-merge-label';
        lab.textContent = label;
        const txt = document.createElement('span');
        for (const seg of segs) {
          if (!seg.changed) {
            txt.append(seg.text);
            continue;
          }
          const w = document.createElement(tag);
          w.className = 'pmd-doc-diff-word';
          w.textContent = seg.text;
          txt.appendChild(w);
        }
        el.append(lab, txt);
        return el;
      };
      box.append(side(a.name, left, 'del'), side(b.name, right, 'ins'));
      const choices = document.createElement('div');
      choices.className = 'pmd-doc-merge-choices';
      const options: Array<[MergeChoice, string]> = [
        ['a', 'Keep first'],
        ['b', 'Keep second'],
        ['both', 'Keep both'],
      ];
      for (const [value, text] of options) {
        const lab = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `merge-conflict-${plan.items.indexOf(item)}`;
        radio.checked = item.choice === value;
        radio.addEventListener('change', () => {
          item.choice = value;
        });
        lab.append(radio, document.createTextNode(` ${text}`));
        choices.appendChild(lab);
      }
      box.appendChild(choices);
      body.appendChild(box);
    }
    this.dialog.appendChild(body);
  }

  private async saveMerged(plan: MergePlan, asCmir: boolean): Promise<void> {
    if (!this.parsed) return;
    try {
      const merged = buildMerged(plan, this.parsed.docA);
      const bytes = asCmir ? serializeNative(merged) : await toDocx(merged, { defaultFont: settings.get('bodyFont') });
      const saved = await getHost().saveAs(asCmir ? 'Merged.cmir' : 'Merged.docx', bytes, {
        filters: asCmir
          ? [{ name: 'CardMirror document', extensions: ['cmir'] }]
          : [{ name: 'Word document', extensions: ['docx'] }],
      });
      if (saved) this.close();
    } catch (err) {
      void alertDialog(`Couldn't save the merged file: ${err instanceof Error ? err.message : err}`);
    }
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
    this.destroyNavViews();
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
    const merge = this.button('Merge into new file…', false, () => this.renderMerge());
    const close = this.button('Close', true, () => this.close());
    this.dialog.appendChild(this.topbar(info, [back, merge, close]));

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

  private destroyNavViews(): void {
    for (const v of this.navViews) v.destroy();
    this.navViews = [];
  }

  /** One side's outline: the app's REAL navigation panel (level buttons,
   *  chevron / double-click collapse, search, per-type styling), run
   *  read-only against a hidden view of the parsed document. Clicking an
   *  entry makes the panel move that view's selection; we catch the
   *  selection and scroll the diff table to the matching row (matched by
   *  text, Nth occurrence, since the diff rows aren't tied to doc
   *  positions). */
  private buildOutline(name: string, doc: PMNode, side: 'left' | 'right'): HTMLElement {
    const rail = document.createElement('div');
    rail.className = `pmd-doc-diff-outline pmd-doc-diff-outline-${side}`;
    const title = document.createElement('div');
    title.className = 'pmd-doc-diff-outline-title';
    title.textContent = name;
    rail.appendChild(title);
    const navHost = document.createElement('div');
    navHost.className = 'pmd-doc-diff-nav';
    const mount = document.createElement('div');
    mount.className = 'pmd-doc-diff-hidden-view';
    rail.append(navHost, mount);

    const rowsByText = side === 'left' ? this.leftRowsByText : this.rightRowsByText;
    const view: EditorView = new EditorView(mount, {
      state: EditorState.create({ doc }),
      editable: () => false,
      dispatchTransaction: (tr) => {
        if (tr.docChanged) return;
        view.updateState(view.state.apply(tr));
        if (tr.selectionSet) this.jumpToSelection(tr.doc, tr.selection.from, rowsByText);
      },
    });
    this.navViews.push(view);
    const nav = new NavigationPanel(navHost, { readOnly: true, onClose: () => {} });
    nav.attach(view);
    const baseDestroy = view.destroy.bind(view);
    view.destroy = () => {
      nav.destroy();
      baseDestroy();
    };
    return rail;
  }

  /** Scroll the diff table to the row for the textblock at `pos`. */
  private jumpToSelection(doc: PMNode, pos: number, rowsByText: Map<string, HTMLElement[]>): void {
    const $pos = doc.resolve(Math.min(pos, doc.content.size));
    let block: PMNode | null = $pos.parent.isTextblock ? $pos.parent : null;
    let blockPos = $pos.parent.isTextblock ? $pos.start() - 1 : -1;
    if (!block) {
      const after = $pos.nodeAfter;
      if (after) {
        const start = $pos.pos;
        after.descendants((n, off) => {
          if (block) return false;
          if (n.isTextblock) {
            block = n;
            blockPos = start + off;
            return false;
          }
          return true;
        });
        if (!block && after.isTextblock) {
          block = after;
          blockPos = start;
        }
      }
    }
    if (!block) return;
    const text = (block as PMNode).textContent.trim();
    let occurrence = 0;
    doc.descendants((n, p) => {
      if (p >= blockPos) return false;
      if (n.isTextblock && n.textContent.trim() === text) occurrence++;
      return !n.isTextblock;
    });
    const target = rowsByText.get(text)?.[occurrence];
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.classList.add('pmd-doc-diff-cell-highlight');
    window.setTimeout(() => target.classList.remove('pmd-doc-diff-cell-highlight'), 900);
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
      if (cell.segments) {
        for (const seg of cell.segments) {
          if (!seg.changed) {
            text.append(seg.text);
            continue;
          }
          const word = document.createElement(cell.type === 'add' ? 'ins' : 'del');
          word.className = 'pmd-doc-diff-word';
          word.textContent = seg.text;
          text.appendChild(word);
        }
      } else {
        text.textContent = cell.text;
      }
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
