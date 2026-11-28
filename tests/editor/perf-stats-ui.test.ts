// @vitest-environment jsdom

/** The Memory and CPU Use dialog's formatting and table. */
import { describe, expect, it } from 'vitest';
import {
  docsLabel,
  formatCpu,
  formatMemory,
  formatPerfReport,
  isPerfReport,
  renderPerfTable,
  type PerfReport,
} from '../../src/editor/perf-stats-ui.js';

const report: PerfReport = {
  windows: [
    { id: 1, label: 'Round 3', docs: 4, state: 'this window', timer: false, cpu: 2.5, memMB: 312.4 },
    { id: 2, label: 'Aff · Neg', docs: 1, state: 'behind', timer: false, cpu: 0.04, memMB: 180 },
    { id: 3, label: 'Timer', docs: 0, state: 'in front', timer: true, cpu: 0, memMB: 60 },
  ],
  others: [{ label: 'Main process', cpu: 1, memMB: 1100 }],
  total: { cpu: 3.5, memMB: 1652.4, docs: 5 },
  sampledAt: Date.UTC(2026, 10, 28, 12, 0, 0),
};

describe('Memory and CPU Use', () => {
  it('formats memory and CPU the way people read them', () => {
    expect(formatMemory(312.4)).toBe('312 MB');
    expect(formatMemory(1652.4)).toBe('1.61 GB');
    expect(formatCpu(2.5)).toBe('2.5%');
    expect(formatCpu(0.04)).toBe('<0.1%');
    expect(formatCpu(0)).toBe('0.0%');
    expect(docsLabel(report.windows[0]!)).toBe('4 documents');
    expect(docsLabel(report.windows[1]!)).toBe('1 document');
    expect(docsLabel(report.windows[2]!)).toBe('Timer');
  });

  it('copies as plain text', () => {
    expect(formatPerfReport(report)).toBe(
      [
        'CardMirror memory and CPU use (2026-11-28T12:00:00.000Z)',
        'Total: 1.61 GB, 3.5% CPU, 3 windows, 5 documents',
        '',
        'Windows:',
        '- Round 3 (4 documents, this window): 312 MB, 2.5% CPU',
        '- Aff · Neg (1 document, behind): 180 MB, <0.1% CPU',
        '- Timer (Timer, in front): 60 MB, 0.0% CPU',
        '',
        'Other:',
        '- Main process: 1.07 GB, 1.0% CPU',
      ].join('\n'),
    );
  });

  it('draws a row per window, the other parts, and a total', () => {
    const t = document.createElement('table');
    renderPerfTable(t, report);
    const rows = [...t.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
    expect(rows[0]).toContain('Round 3');
    expect(t.querySelector('.pmd-perf-own')?.textContent).toContain('Round 3');
    expect(rows).toContain('Other parts of the app');
    expect(t.querySelector('tfoot')?.textContent).toContain('1.61 GB');
  });

  it('checks the shape it was handed', () => {
    expect(isPerfReport(report)).toBe(true);
    expect(isPerfReport(null)).toBe(false);
    expect(isPerfReport({ windows: [] })).toBe(false);
  });
});
