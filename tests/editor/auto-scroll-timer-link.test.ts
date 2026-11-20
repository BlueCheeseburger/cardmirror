// @vitest-environment jsdom

/**
 * "Start and pause Auto-Scroll with the timer": the Auto-Scroll button starts
 * the speech clock, the clock's own Start never starts Auto-Scroll, and a stop
 * on either side pauses the other. Off by default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { settings } from '../../src/editor/settings.js';
import {
  getTimerState,
  loadSpeechPreset,
  pauseTimer,
  resetTimer,
  selectMode,
  startTimer,
} from '../../src/editor/timer-state.js';
import {
  isAutoScrolling,
  startAutoScroll,
  stopAutoScroll,
  __resetAutoScrollForTests,
} from '../../src/editor/auto-scroll.js';
import {
  mountAutoScrollTimerLink,
  pauseClockWithAutoScroll,
  startClockWithAutoScroll,
} from '../../src/editor/auto-scroll-timer-link.js';

function scrollableView(): EditorView {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  const dom = document.createElement('div');
  scroller.appendChild(dom);
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, 'scrollHeight', { value: 3000, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
  return { dom, state: { doc: {} }, isDestroyed: false, posAtCoords: () => null } as unknown as EditorView;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  resetTimer();
  settings.set('autoScrollWithTimer', false);
  mountAutoScrollTimerLink();
});
afterEach(() => {
  __resetAutoScrollForTests();
  pauseTimer();
  resetTimer();
  settings.set('autoScrollWithTimer', false);
  vi.unstubAllGlobals();
});

describe('Auto-Scroll and the timer', () => {
  it('is off by default and then touches nothing', () => {
    expect(settings.get('autoScrollWithTimer')).toBe(false);
    loadSpeechPreset(8);
    expect(startClockWithAutoScroll()).toBe(false);
    expect(getTimerState().running).toBe(false);
    startTimer();
    pauseClockWithAutoScroll();
    expect(getTimerState().running).toBe(true);
  });

  it('starting Auto-Scroll starts a loaded speech clock', () => {
    settings.set('autoScrollWithTimer', true);
    loadSpeechPreset(8);
    expect(startClockWithAutoScroll()).toBe(true);
    expect(getTimerState().running).toBe(true);
  });

  it('leaves the clock alone when no speech time is loaded (it would start a count-up) or a prep clock is showing', () => {
    settings.set('autoScrollWithTimer', true);
    expect(startClockWithAutoScroll()).toBe(false);
    expect(getTimerState().running).toBe(false);
    selectMode('affPrep');
    expect(startClockWithAutoScroll()).toBe(false);
    expect(getTimerState().running).toBe(false);
  });

  it('does not report starting a clock that was already running', () => {
    settings.set('autoScrollWithTimer', true);
    loadSpeechPreset(8);
    startTimer();
    expect(startClockWithAutoScroll()).toBe(false);
    expect(getTimerState().running).toBe(true);
  });

  it('the timer’s own Start does not start Auto-Scroll', () => {
    settings.set('autoScrollWithTimer', true);
    loadSpeechPreset(8);
    startTimer();
    expect(isAutoScrolling()).toBe(false);
  });

  it('pausing the clock stops Auto-Scroll', () => {
    settings.set('autoScrollWithTimer', true);
    loadSpeechPreset(8);
    startClockWithAutoScroll();
    const onStop = vi.fn();
    expect(startAutoScroll(scrollableView(), { wpm: 200 }, onStop)).toBe(true);
    pauseTimer();
    expect(isAutoScrolling()).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('stopping Auto-Scroll pauses the clock', () => {
    settings.set('autoScrollWithTimer', true);
    loadSpeechPreset(8);
    startClockWithAutoScroll();
    startAutoScroll(scrollableView(), { wpm: 200 }, pauseClockWithAutoScroll);
    stopAutoScroll();
    expect(getTimerState().running).toBe(false);
  });

  it('with the setting off, pausing the clock leaves Auto-Scroll running', () => {
    loadSpeechPreset(8);
    startTimer();
    startAutoScroll(scrollableView(), { wpm: 200 }, vi.fn());
    pauseTimer();
    expect(isAutoScrolling()).toBe(true);
  });

  it('never pauses a prep clock', () => {
    settings.set('autoScrollWithTimer', true);
    selectMode('affPrep');
    startTimer();
    pauseClockWithAutoScroll();
    expect(getTimerState().running).toBe(true);
  });
});
