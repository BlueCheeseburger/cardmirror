// @vitest-environment jsdom
/**
 * The timer section of the plugin API: a snapshot of every clock, change
 * notifications, and the same actions as the timer panel's buttons.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi } from '../../src/editor/plugin-api.js';
import { getTimerState, pauseTimer, resetTimer } from '../../src/editor/timer-state.js';

const MIN = 60 * 1000;
const deps = {
  appVersion: '0.1.0-test',
  getView: () => null,
  findViewForDocId: () => null,
  getDocIdentity: () => null,
  ensureDocId: () => null,
};

beforeEach(() => {
  if (getTimerState().running) pauseTimer();
  resetTimer(10 * MIN);
});

describe('plugin api timer', () => {
  it('snapshots every clock and the preset buttons', () => {
    const t = createPluginApi('demo', deps).timer;
    t.loadPreset(6);
    const s = t.get();
    expect(s.mode).toBe('speech');
    expect(s.running).toBe(false);
    expect(s.speechMs).toBe(6 * MIN);
    expect(s.affPrepMs).toBe(10 * MIN);
    expect(s.negPrepMs).toBe(10 * MIN);
    expect(s.presets.length).toBeGreaterThanOrEqual(3);
    expect(typeof s.at).toBe('number');
  });

  it('runs the same actions as the panel', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const t = createPluginApi('demo', deps).timer;
      t.selectMode('negPrep');
      t.start();
      vi.setSystemTime(1_000_000 + 30_000);
      expect(t.get().negPrepMs).toBe(10 * MIN - 30_000);
      t.pause();
      expect(t.get().running).toBe(false);
      t.setActiveMs(4 * MIN);
      expect(t.get().negPrepMs).toBe(4 * MIN);
      t.reset();
      expect(t.get().negPrepMs).toBe(10 * MIN);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stopped speech clock that has a value keeps it while prep is shown', () => {
    const t = createPluginApi('demo', deps).timer;
    t.loadPreset(3);
    t.selectMode('affPrep');
    expect(t.get().speechMs).toBe(3 * MIN);
  });

  it('tells the plugin about every change, until unsubscribed', () => {
    const t = createPluginApi('demo', deps).timer;
    const seen: string[] = [];
    const off = t.onChanged((s) => seen.push(s.mode));
    t.selectMode('affPrep');
    off();
    t.selectMode('negPrep');
    expect(seen).toEqual(['affPrep']);
  });

  it('ignores bad input', () => {
    const t = createPluginApi('demo', deps).timer;
    t.loadPreset(3);
    t.selectMode('bogus' as never);
    t.loadPreset(-1);
    t.loadPreset(Number.NaN);
    t.setActiveMs(-5);
    expect(t.get().mode).toBe('speech');
    expect(t.get().speechMs).toBe(3 * MIN);
  });
});
