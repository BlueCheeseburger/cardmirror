/**
 * Memory and CPU Use: a dialog listing what each CardMirror window and the
 * app's other processes are using right now, refreshed every two seconds
 * while it is open, with a Copy button that puts the numbers on the
 * clipboard as plain text (to paste into a bug report).
 *
 * The numbers come from the desktop app's main process (perf-stats.ts in
 * apps/desktop): each window is its own process, so its row is that
 * process's memory and CPU.
 */

import { getElectronHost } from './host/index.js';
import { popOverlay, pushOverlay } from './overlay-stack.js';
import { armDialogFocus, captureFocusForDialog, installModalKeys } from './text-prompt.js';
import { isBackdropClick } from './backdrop-click.js';
import { showToast } from './toast.js';
import { writeClipboardText } from './clipboard-write.js';

/** Mirrors `PerfReport` in apps/desktop/src/perf-stats.ts. */
export interface PerfWindowRow {
  id: number;
  label: string;
  docs: number;
  state: 'this window' | 'in front' | 'behind' | 'minimized' | 'hidden';
  timer: boolean;
  cpu: number;
  memMB: number;
}
export interface PerfOtherRow {
  label: string;
  cpu: number;
  memMB: number;
}
export interface PerfReport {
  windows: PerfWindowRow[];
  others: PerfOtherRow[];
  total: { cpu: number; memMB: number; docs: number };
  sampledAt: number;
}

export const PERF_REFRESH_MS = 2000;
export const PERF_DESKTOP_ONLY = 'Memory and CPU Use is only in the desktop app.';

export function isPerfReport(x: unknown): x is PerfReport {
  if (!x || typeof x !== 'object') return false;
  const r = x as Partial<PerfReport>;
  return Array.isArray(r.windows) && Array.isArray(r.others) && !!r.total && typeof r.total.memMB === 'number';
}

export function formatMemory(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${Math.round(mb)} MB`;
}

export function formatCpu(pct: number): string {
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

export function docsLabel(row: PerfWindowRow): string {
  if (row.timer) return 'Timer';
  return row.docs === 1 ? '1 document' : `${row.docs} documents`;
}

/** The plain-text version the Copy button puts on the clipboard. */
export function formatPerfReport(r: PerfReport): string {
  const lines: string[] = [];
  lines.push(`CardMirror memory and CPU use (${new Date(r.sampledAt).toISOString()})`);
  lines.push(
    `Total: ${formatMemory(r.total.memMB)}, ${formatCpu(r.total.cpu)} CPU, ` +
      `${r.windows.length} window${r.windows.length === 1 ? '' : 's'}, ${r.total.docs} document${r.total.docs === 1 ? '' : 's'}`,
  );
  lines.push('');
  lines.push('Windows:');
  for (const w of r.windows) {
    lines.push(`- ${w.label} (${docsLabel(w)}, ${w.state}): ${formatMemory(w.memMB)}, ${formatCpu(w.cpu)} CPU`);
  }
  if (r.others.length) {
    lines.push('');
    lines.push('Other:');
    for (const o of r.others) lines.push(`- ${o.label}: ${formatMemory(o.memMB)}, ${formatCpu(o.cpu)} CPU`);
  }
  return lines.join('\n');
}

function cell(tag: 'td' | 'th', text: string, cls?: string): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

/** Fill `table` with `r`'s rows. Exported for tests. */
export function renderPerfTable(table: HTMLTableElement, r: PerfReport): void {
  table.replaceChildren();
  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.append(
    cell('th', 'Window'),
    cell('th', 'Contents'),
    cell('th', 'State'),
    cell('th', 'Memory', 'pmd-perf-num'),
    cell('th', 'CPU', 'pmd-perf-num'),
  );
  head.appendChild(hr);
  const body = document.createElement('tbody');
  for (const w of r.windows) {
    const tr = document.createElement('tr');
    if (w.state === 'this window') tr.className = 'pmd-perf-own';
    const name = cell('td', w.label, 'pmd-perf-name');
    name.title = w.label;
    tr.append(
      name,
      cell('td', docsLabel(w)),
      cell('td', w.state),
      cell('td', formatMemory(w.memMB), 'pmd-perf-num'),
      cell('td', formatCpu(w.cpu), 'pmd-perf-num'),
    );
    body.appendChild(tr);
  }
  if (r.others.length) {
    const sep = document.createElement('tr');
    sep.className = 'pmd-perf-section';
    const th = cell('th', 'Other parts of the app');
    th.setAttribute('colspan', '5');
    sep.appendChild(th);
    body.appendChild(sep);
    for (const o of r.others) {
      const tr = document.createElement('tr');
      tr.append(
        cell('td', o.label, 'pmd-perf-name'),
        cell('td', ''),
        cell('td', ''),
        cell('td', formatMemory(o.memMB), 'pmd-perf-num'),
        cell('td', formatCpu(o.cpu), 'pmd-perf-num'),
      );
      body.appendChild(tr);
    }
  }
  const foot = document.createElement('tfoot');
  const fr = document.createElement('tr');
  fr.append(
    cell('th', 'Total'),
    cell('td', `${r.total.docs} document${r.total.docs === 1 ? '' : 's'}`),
    cell('td', ''),
    cell('td', formatMemory(r.total.memMB), 'pmd-perf-num'),
    cell('td', formatCpu(r.total.cpu), 'pmd-perf-num'),
  );
  foot.appendChild(fr);
  table.append(head, body, foot);
}

let openClose: (() => void) | null = null;

/** Open the dialog (or bring the open one's numbers up to date). */
export function openPerfStats(): void {
  const host = getElectronHost();
  if (!host?.perfStats) {
    showToast(PERF_DESKTOP_ONLY);
    return;
  }
  if (openClose) return;

  const overlay = document.createElement('div');
  overlay.className = 'pmd-bulk-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'pmd-bulk-dialog pmd-perf-dialog';
  overlay.appendChild(dialog);

  const header = document.createElement('header');
  header.className = 'pmd-bulk-header';
  const h = document.createElement('h2');
  h.textContent = 'Memory and CPU Use';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'pmd-bulk-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  header.append(h, closeBtn);

  const body = document.createElement('div');
  body.className = 'pmd-bulk-body';
  const note = document.createElement('p');
  note.className = 'pmd-perf-note';
  note.textContent =
    'Each window runs as its own process. CPU is a share of one core; memory is what each part holds now. Updates every 2 seconds.';
  const scroll = document.createElement('div');
  scroll.className = 'pmd-perf-scroll';
  const table = document.createElement('table');
  table.className = 'pmd-perf-table';
  table.appendChild(cell('td', 'Measuring…'));
  scroll.appendChild(table);
  const actions = document.createElement('div');
  actions.className = 'pmd-perf-actions';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'pmd-bulk-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy these numbers as text';
  copyBtn.disabled = true;
  actions.appendChild(copyBtn);
  body.append(note, scroll, actions);
  dialog.append(header, body);

  const token = pushOverlay();
  const restoreFocus = captureFocusForDialog();
  let last: PerfReport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    removeKeys();
    popOverlay(token);
    overlay.remove();
    openClose = null;
    restoreFocus();
  };
  const removeKeys = installModalKeys(dialog, token, (e) => {
    if (e.key === 'Escape') {
      close();
      return true;
    }
    return false;
  });
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (isBackdropClick(e, overlay)) close();
  });
  copyBtn.addEventListener('click', () => {
    if (!last) return;
    void writeClipboardText(formatPerfReport(last)).then((ok) =>
      showToast(ok ? 'Copied memory and CPU use' : 'Couldn’t copy. Try again.'),
    );
  });

  const refresh = async (): Promise<void> => {
    let r: unknown = null;
    try {
      r = await host.perfStats!();
    } catch {
      r = null;
    }
    if (closed) return;
    if (isPerfReport(r)) {
      last = r;
      renderPerfTable(table, r);
      copyBtn.disabled = false;
    } else if (!last) {
      table.replaceChildren(cell('td', 'This version of the desktop app can’t report memory use.'));
    }
    timer = setTimeout(() => void refresh(), PERF_REFRESH_MS);
  };

  document.body.appendChild(overlay);
  armDialogFocus(dialog, 'dialog', 'Memory and CPU Use');
  openClose = close;
  void refresh();
}

/** Test seam. */
export function __closePerfStatsForTests(): void {
  openClose?.();
}
