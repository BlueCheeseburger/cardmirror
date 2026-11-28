import { describe, expect, it } from 'vitest';
import {
  buildPerfReport,
  otherLabel,
  type ProcessSample,
  type WindowSample,
} from '../../apps/desktop/src/perf-stats.js';

const proc = (pid: number, type: string, memKB: number, cpu = 0, serviceName?: string): ProcessSample => ({
  pid,
  type,
  memKB,
  cpu,
  serviceName,
});
const win = (id: number, pid: number, over: Partial<WindowSample> = {}): WindowSample => ({
  id,
  label: `W${id}`,
  pid,
  docs: 1,
  focused: false,
  minimized: false,
  visible: true,
  isOwn: false,
  timer: false,
  ...over,
});

describe('buildPerfReport', () => {
  it('gives each window its own process’s numbers and lists the rest under Other', () => {
    const r = buildPerfReport(
      [
        proc(1, 'Browser', 102400, 1.25),
        proc(2, 'GPU', 51200, 0.5),
        proc(10, 'Tab', 307200, 3),
        proc(11, 'Tab', 204800, 0.04),
        proc(20, 'Utility', 40960, 0, 'cardmirror-file-index'),
        proc(21, 'Utility', 10240, 0, 'network.mojom.NetworkService'),
      ],
      [win(1, 10, { isOwn: true, docs: 4 }), win(2, 11, { docs: 6 })],
      1000,
    );
    expect(r.windows.map((w) => [w.label, w.memMB, w.cpu, w.state, w.docs])).toEqual([
      ['W1', 300, 3, 'this window', 4],
      ['W2', 200, 0, 'behind', 6],
    ]);
    expect(r.others).toEqual([
      { label: 'Main process', cpu: 1.3, memMB: 100 },
      { label: 'Graphics', cpu: 0.5, memMB: 50 },
      { label: 'File search', cpu: 0, memMB: 40 },
      { label: 'Network', cpu: 0, memMB: 10 },
    ]);
    expect(r.total).toEqual({ cpu: 4.8, memMB: 700, docs: 10 });
    expect(r.sampledAt).toBe(1000);
  });

  it('puts this window first, then the heaviest', () => {
    const r = buildPerfReport(
      [proc(10, 'Tab', 1024), proc(11, 'Tab', 9 * 1024), proc(12, 'Tab', 5 * 1024)],
      [win(1, 10), win(2, 11), win(3, 12, { isOwn: true })],
      0,
    );
    expect(r.windows.map((w) => w.id)).toEqual([3, 2, 1]);
  });

  it('names the state of each window', () => {
    const r = buildPerfReport(
      [proc(10, 'Tab', 1), proc(11, 'Tab', 1), proc(12, 'Tab', 1), proc(13, 'Tab', 1)],
      [win(1, 10, { focused: true }), win(2, 11, { minimized: true }), win(3, 12, { visible: false }), win(4, 13)],
      0,
    );
    const state = Object.fromEntries(r.windows.map((w) => [w.id, w.state]));
    expect(state).toEqual({ 1: 'in front', 2: 'minimized', 3: 'hidden', 4: 'behind' });
  });

  it('a window still starting (no process yet) shows zero instead of borrowing another’s numbers', () => {
    const r = buildPerfReport([proc(10, 'Tab', 2048)], [win(1, -1), win(2, 10)], 0);
    expect(r.windows.find((w) => w.id === 1)).toMatchObject({ memMB: 0, cpu: 0 });
    expect(r.others).toEqual([]);
  });

  it('counts a shared process once', () => {
    const r = buildPerfReport([proc(10, 'Tab', 2048)], [win(1, 10), win(2, 10)], 0);
    expect(r.windows.map((w) => w.memMB).sort()).toEqual([0, 2]);
    expect(r.total.memMB).toBe(2);
  });

  it('labels the other processes the way a user would know them', () => {
    expect(otherLabel(proc(1, 'Utility', 0, 0, 'audio.mojom.AudioService'))).toBe('Audio');
    expect(otherLabel(proc(1, 'Utility', 0, 0, 'something'))).toBe('Other services');
    expect(otherLabel(proc(1, 'Tab', 0))).toBe('Other pages');
    expect(otherLabel(proc(1, 'Zygote', 0))).toBe('Other services');
  });
});
