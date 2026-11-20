/**
 * "Start and pause Auto-Scroll with the timer" (`autoScrollWithTimer`, off by
 * default). One direction starts, both pause:
 *
 *   - pressing the Auto-Scroll button also starts the speech clock;
 *   - the timer's own Start button never starts Auto-Scroll;
 *   - when Auto-Scroll stops, for any reason, the clock pauses; and
 *   - when the clock is paused while Auto-Scroll runs, Auto-Scroll stops.
 *
 * Only the speech countdown is touched: a prep clock is never started or paused
 * from here, and with no speech time loaded (which would start a count-up
 * stopwatch) the clock is left alone.
 */

import { settings } from './settings.js';
import { getTimerState, pauseTimer, startTimer, subscribeTimer } from './timer-state.js';
import { isAutoScrolling, stopAutoScroll } from './auto-scroll.js';

/** Start the speech clock for an Auto-Scroll run that is starting. Returns true
 *  when it was this call that started the clock (so a start that then fails can
 *  undo it). */
export function startClockWithAutoScroll(): boolean {
  if (!settings.get('autoScrollWithTimer')) return false;
  const s = getTimerState();
  if (s.running) return false;
  if (s.mode !== 'speech' || s.stopwatch || s.speechBaseRemainingMs <= 0) return false;
  startTimer();
  return getTimerState().running;
}

/** Pause the speech clock because Auto-Scroll stopped. */
export function pauseClockWithAutoScroll(): void {
  if (!settings.get('autoScrollWithTimer')) return;
  const s = getTimerState();
  if (s.running && s.mode === 'speech') pauseTimer();
}

let mounted = false;

/** Stop Auto-Scroll when the clock goes from running to paused (any window's
 *  pause button, a reset, the clock running out). */
export function mountAutoScrollTimerLink(): void {
  if (mounted) return;
  mounted = true;
  let wasRunning = getTimerState().running;
  subscribeTimer((s) => {
    const paused = wasRunning && !s.running;
    wasRunning = s.running;
    if (paused && settings.get('autoScrollWithTimer') && isAutoScrolling()) stopAutoScroll();
  });
}
