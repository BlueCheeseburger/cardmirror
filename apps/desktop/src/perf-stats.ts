/**
 * "Memory and CPU use": a snapshot of what each CardMirror window and the
 * app's other processes are using, for deciding where the multi-window cost
 * actually goes before changing anything (throttling background windows,
 * putting hidden stacked documents to sleep).
 *
 * Every CardMirror window is its own renderer process, so a window's numbers
 * are its process's numbers. The rest (the main process, graphics, file
 * search, Chromium's network and audio services) are listed under "Other".
 *
 * Pure: main.ts feeds it `app.getAppMetrics()` and the window list.
 */

/** One process, from Electron's `app.getAppMetrics()`. */
export interface ProcessSample {
  pid: number;
  /** Electron's process type: Browser, Tab, GPU, Utility, … */
  type: string;
  /** Utility processes name their service (`cardmirror-file-index`, …). */
  serviceName?: string;
  name?: string;
  /** Percent of one CPU core, averaged over Chromium's last sample. */
  cpu: number;
  /** Working set, in kilobytes. */
  memKB: number;
}

/** One window, as main knows it. */
export interface WindowSample {
  id: number;
  label: string;
  /** Its renderer's OS process id (0 or -1 while it is starting). */
  pid: number;
  /** Documents open in it, stacked ones included. */
  docs: number;
  focused: boolean;
  minimized: boolean;
  visible: boolean;
  /** The window that asked for the report. */
  isOwn: boolean;
  /** A pop-out timer rather than a document window. */
  timer: boolean;
}

export interface WindowRow {
  id: number;
  label: string;
  docs: number;
  state: 'this window' | 'in front' | 'behind' | 'minimized' | 'hidden';
  timer: boolean;
  cpu: number;
  memMB: number;
}

export interface OtherRow {
  label: string;
  cpu: number;
  memMB: number;
}

export interface PerfReport {
  windows: WindowRow[];
  others: OtherRow[];
  total: { cpu: number; memMB: number; docs: number };
  sampledAt: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const toMB = (kb: number): number => round1(kb / 1024);

/** What the user calls a process that isn't a window. */
export function otherLabel(p: ProcessSample): string {
  switch (p.type) {
    case 'Browser':
      return 'Main process';
    case 'GPU':
      return 'Graphics';
    case 'Utility':
      if (p.serviceName === 'cardmirror-file-index') return 'File search';
      if (/network/i.test(p.serviceName ?? p.name ?? '')) return 'Network';
      if (/audio/i.test(p.serviceName ?? p.name ?? '')) return 'Audio';
      return 'Other services';
    case 'Tab':
      // A renderer with no window of ours: a dialog page, a closing window.
      return 'Other pages';
    default:
      return 'Other services';
  }
}

function windowState(w: WindowSample): WindowRow['state'] {
  if (w.isOwn) return 'this window';
  if (w.minimized) return 'minimized';
  if (!w.visible) return 'hidden';
  return w.focused ? 'in front' : 'behind';
}

export function buildPerfReport(
  processes: readonly ProcessSample[],
  windows: readonly WindowSample[],
  now: number,
): PerfReport {
  const byPid = new Map<number, ProcessSample>();
  for (const p of processes) byPid.set(p.pid, p);
  const windowPids = new Set<number>();
  const rows: WindowRow[] = [];
  for (const w of windows) {
    const p = w.pid > 0 ? byPid.get(w.pid) : undefined;
    // Two windows never share a renderer here, but if they ever did the
    // process would be counted once, against the first.
    const counted = p !== undefined && !windowPids.has(p.pid);
    if (p) windowPids.add(p.pid);
    rows.push({
      id: w.id,
      label: w.label || 'Untitled',
      docs: w.docs,
      state: windowState(w),
      timer: w.timer,
      cpu: counted ? round1(p.cpu) : 0,
      memMB: counted ? toMB(p.memKB) : 0,
    });
  }
  // This window first, then the heaviest.
  rows.sort((a, b) => {
    if (a.state === 'this window' && b.state !== 'this window') return -1;
    if (b.state === 'this window' && a.state !== 'this window') return 1;
    return b.memMB - a.memMB;
  });

  const others = new Map<string, OtherRow>();
  for (const p of processes) {
    if (windowPids.has(p.pid)) continue;
    const label = otherLabel(p);
    const row = others.get(label) ?? { label, cpu: 0, memMB: 0 };
    row.cpu += p.cpu;
    row.memMB += p.memKB / 1024;
    others.set(label, row);
  }
  const otherRows = [...others.values()]
    .map((r) => ({ label: r.label, cpu: round1(r.cpu), memMB: round1(r.memMB) }))
    .sort((a, b) => b.memMB - a.memMB);

  let cpu = 0;
  let memKB = 0;
  for (const p of processes) {
    cpu += p.cpu;
    memKB += p.memKB;
  }
  return {
    windows: rows,
    others: otherRows,
    total: { cpu: round1(cpu), memMB: toMB(memKB), docs: rows.reduce((n, r) => n + r.docs, 0) },
    sampledAt: now,
  };
}
