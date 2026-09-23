/**
 * Editing the timer display in a prep mode writes that side's saved balance, so
 * the edit persists across mode switches (only Reset zeroes prep). Covers
 * `setActiveRemainingMs` — the state half of editable prep time.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  markTimerExpired,
  resetTimer,
  selectMode,
  setActiveRemainingMs,
  getTimerState,
  getPrepRemainingMs,
  getVisibleRemainingMs,
  isStopwatch,
  loadSpeechPreset,
  pauseTimer,
  reconcileTimerPopout,
  setTimerPoppedOut,
  setTimerVisible,
  shownPrepSide,
  startTimer,
  togglePrepShownSide,
} from '../../src/editor/timer-state.js';

const MIN = 60 * 1000;

describe('setActiveRemainingMs', () => {
  it('edits the active prep side, and the edit sticks across mode switches', () => {
    resetTimer(10 * MIN); // mode 'speech', both prep balances at 10:00
    selectMode('affPrep');
    setActiveRemainingMs(7 * MIN); // fix the aff prep clock down to 7:00
    expect(getPrepRemainingMs(getTimerState(), 'aff')).toBe(7 * MIN);
    // Load a speech preset and come back WITHOUT resetting — the edit persists.
    loadSpeechPreset(6);
    selectMode('affPrep');
    expect(getPrepRemainingMs(getTimerState(), 'aff')).toBe(7 * MIN);
    // The other side is untouched.
    expect(getPrepRemainingMs(getTimerState(), 'neg')).toBe(10 * MIN);
  });

  it('edits the neg prep side independently', () => {
    resetTimer(8 * MIN);
    selectMode('negPrep');
    setActiveRemainingMs(2 * MIN);
    expect(getPrepRemainingMs(getTimerState(), 'neg')).toBe(2 * MIN);
    expect(getPrepRemainingMs(getTimerState(), 'aff')).toBe(8 * MIN);
  });

  it('in speech mode it sets the speech clock', () => {
    resetTimer(10 * MIN); // mode 'speech'
    setActiveRemainingMs(3 * MIN);
    expect(getVisibleRemainingMs(getTimerState())).toBe(3 * MIN);
  });
});

/**
 * Pop-out flag semantics: popping out implies visible (no
 * hidden-but-floating state), hiding retracts the pop-out (never
 * both, never neither-with-float), and boot reconciliation clears a
 * stale flag ONLY when no pop-out window actually exists — a
 * mode-switch reload with the float alive must keep the flag, or the
 * in-app panel would resurrect next to the float.
 */
describe('timer pop-out state', () => {
  it('popping out forces visible on', () => {
    setTimerVisible(false);
    setTimerPoppedOut(true);
    expect(getTimerState().poppedOut).toBe(true);
    expect(getTimerState().visible).toBe(true);
  });

  it('hiding the timer also retracts the pop-out', () => {
    setTimerPoppedOut(true);
    setTimerVisible(false);
    expect(getTimerState().visible).toBe(false);
    expect(getTimerState().poppedOut).toBe(false);
  });

  it('popping back in keeps the timer visible', () => {
    setTimerVisible(true);
    setTimerPoppedOut(true);
    setTimerPoppedOut(false);
    expect(getTimerState().poppedOut).toBe(false);
    expect(getTimerState().visible).toBe(true);
  });

  it('popping out does not pause a running clock', () => {
    resetTimer(10 * MIN);
    loadSpeechPreset(6);
    startTimer();
    setTimerPoppedOut(true);
    expect(getTimerState().running).toBe(true);
    pauseTimer();
    setTimerPoppedOut(false);
  });

  it('reconciliation clears a stale flag when no pop-out window exists', () => {
    setTimerPoppedOut(true);
    reconcileTimerPopout(false);
    expect(getTimerState().poppedOut).toBe(false);
  });

  it('reconciliation keeps the flag while the pop-out window is alive (mode-switch reload)', () => {
    setTimerPoppedOut(true);
    reconcileTimerPopout(true);
    expect(getTimerState().poppedOut).toBe(true);
    setTimerPoppedOut(false);
  });

  it('reconciliation never sets the flag on its own', () => {
    setTimerPoppedOut(false);
    reconcileTimerPopout(true);
    expect(getTimerState().poppedOut).toBe(false);
  });
});

/**
 * Compact panel's single-prep display side: an active prep mode
 * always wins; otherwise the sticky preference, updated by explicit
 * side choices anywhere. The switch is a pure display flip in
 * speech mode but a real mode switch (with pause) while a prep is
 * selected — a switch that only changed a hidden preference would
 * read as broken.
 */
describe('shownPrepSide / togglePrepShownSide', () => {
  it('follows the active prep mode', () => {
    resetTimer(10 * MIN);
    selectMode('negPrep');
    expect(shownPrepSide(getTimerState())).toBe('neg');
    expect(getTimerState().prepShownSide).toBe('neg'); // sticky side updated too
  });

  it('falls back to the sticky side in speech mode', () => {
    resetTimer(10 * MIN);
    selectMode('affPrep');
    loadSpeechPreset(6); // back to speech
    expect(getTimerState().mode).toBe('speech');
    expect(shownPrepSide(getTimerState())).toBe('aff');
  });

  it('toggling in speech mode flips the display side only', () => {
    resetTimer(10 * MIN); // speech, sticky side aff
    togglePrepShownSide();
    expect(getTimerState().mode).toBe('speech');
    expect(shownPrepSide(getTimerState())).toBe('neg');
  });

  it('toggling while a prep runs pauses and switches to the other side', () => {
    resetTimer(10 * MIN);
    selectMode('affPrep');
    startTimer();
    togglePrepShownSide();
    const s = getTimerState();
    expect(s.running).toBe(false);
    expect(s.mode).toBe('negPrep');
    expect(shownPrepSide(s)).toBe('neg');
    // Aff's balance survived the pause snapshot (still ≈ 10:00).
    expect(getPrepRemainingMs(s, 'aff')).toBeGreaterThan(9 * MIN);
  });
});

describe('expiry latch (ran-out red)', () => {
  /** Run the speech clock past its end under fake time. */
  function expireSpeech(minutes = 1): void {
    loadSpeechPreset(minutes);
    startTimer();
    vi.setSystemTime(Date.now() + minutes * MIN + 1000);
    markTimerExpired(); // what each window's render tick does at 0:00
  }

  it('latches the active mode at 0:00 — and pause does NOT clear it', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      expireSpeech();
      expect(getTimerState().expiredMode).toBe('speech');
      // Pause is not a re-arm: the alert must survive it.
      pauseTimer();
      expect(getTimerState().expiredMode).toBe('speech');
    } finally {
      vi.useRealTimers();
    }
  });

  it('no-ops while time remains, and on duplicate ticks', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      loadSpeechPreset(1);
      startTimer();
      markTimerExpired(); // clock just started — must not latch
      expect(getTimerState().expiredMode).toBeNull();
      vi.setSystemTime(Date.now() + 2 * MIN);
      markTimerExpired();
      markTimerExpired(); // concurrent-window duplicate converges
      expect(getTimerState().expiredMode).toBe('speech');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a mode switch hides but does not clear — the latch survives coming back', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      expireSpeech();
      selectMode('affPrep');
      // Still latched for speech: the UI keys red on mode === expiredMode.
      expect(getTimerState().expiredMode).toBe('speech');
      selectMode('speech');
      expect(getTimerState().expiredMode).toBe('speech');
    } finally {
      vi.useRealTimers();
    }
  });

  it('each re-arm gesture clears it: preset, Reset, typed time', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      expireSpeech();
      loadSpeechPreset(6);
      expect(getTimerState().expiredMode).toBeNull();

      expireSpeech();
      resetTimer(10 * MIN);
      expect(getTimerState().expiredMode).toBeNull();

      expireSpeech();
      pauseTimer(); // typing requires a paused display
      setActiveRemainingMs(3 * MIN);
      expect(getTimerState().expiredMode).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('latches a prep clock too', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      selectMode('affPrep');
      startTimer();
      vi.setSystemTime(Date.now() + 11 * MIN);
      markTimerExpired();
      expect(getTimerState().expiredMode).toBe('affPrep');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('stopwatch: Start with 0:00 loaded counts up (2026-09-19)', () => {
  const SEC = 1000;
  const advance = (ms: number): void => {
    vi.setSystemTime(Date.now() + ms);
  };

  it('counts up from a reset speech clock, pauses, and resumes where it left off', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      expect(getVisibleRemainingMs(getTimerState())).toBe(0);
      startTimer();
      const s = getTimerState();
      expect(s.running).toBe(true);
      expect(isStopwatch(s)).toBe(true);
      advance(65 * SEC);
      expect(getVisibleRemainingMs(getTimerState())).toBe(65 * SEC);
      pauseTimer();
      expect(getTimerState().running).toBe(false);
      expect(getVisibleRemainingMs(getTimerState()), 'paused value holds').toBe(65 * SEC);
      advance(30 * SEC);
      expect(getVisibleRemainingMs(getTimerState()), 'not counting while paused').toBe(65 * SEC);
      startTimer();
      advance(5 * SEC);
      expect(getVisibleRemainingMs(getTimerState())).toBe(70 * SEC);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never latches expiry — not at the first 0:00 tick, not later', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      startTimer();
      markTimerExpired(); // the render tick at 0:00
      expect(getTimerState().expiredMode).toBeNull();
      advance(3 * MIN);
      markTimerExpired();
      expect(getTimerState().expiredMode).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a preset, a typed time or Reset arms a countdown again', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      startTimer();
      advance(20 * SEC);
      loadSpeechPreset(1);
      expect(isStopwatch(getTimerState())).toBe(false);
      expect(getVisibleRemainingMs(getTimerState())).toBe(1 * MIN);
      startTimer();
      advance(10 * SEC);
      expect(getVisibleRemainingMs(getTimerState()), 'counting down again').toBe(50 * SEC);
      pauseTimer();
      // Back to a stopwatch, then a typed time replaces it.
      setActiveRemainingMs(0);
      startTimer();
      advance(5 * SEC);
      expect(isStopwatch(getTimerState())).toBe(true);
      pauseTimer();
      setActiveRemainingMs(30 * SEC);
      expect(isStopwatch(getTimerState())).toBe(false);
      expect(getVisibleRemainingMs(getTimerState())).toBe(30 * SEC);
      // Typing 0:00 arms a fresh stopwatch, not a resume.
      setActiveRemainingMs(0);
      startTimer();
      expect(getVisibleRemainingMs(getTimerState()), 'fresh count from zero').toBe(0);
      resetTimer(10 * MIN);
      expect(isStopwatch(getTimerState())).toBe(false);
      expect(getTimerState().speechStopwatchBaseMs).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after a countdown runs out: pause, then Start counts overtime up and stays red', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      loadSpeechPreset(1);
      startTimer();
      advance(1 * MIN + 500);
      markTimerExpired();
      expect(getTimerState().expiredMode).toBe('speech');
      pauseTimer();
      expect(getVisibleRemainingMs(getTimerState())).toBe(0);
      startTimer();
      expect(isStopwatch(getTimerState())).toBe(true);
      advance(12 * SEC);
      expect(getVisibleRemainingMs(getTimerState())).toBe(12 * SEC);
      expect(getTimerState().expiredMode, 'overtime keeps the ran-out red').toBe('speech');
      markTimerExpired();
      expect(getTimerState().expiredMode).toBe('speech');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a prep clock at 0:00 is spent: Start stays a no-op', () => {
    resetTimer(0);
    selectMode('affPrep');
    startTimer();
    expect(getTimerState().running).toBe(false);
    expect(isStopwatch(getTimerState())).toBe(false);
    resetTimer(10 * MIN);
  });

  it('switching to a prep clock pauses the stopwatch; coming back resumes it', () => {
    vi.useFakeTimers();
    try {
      resetTimer(10 * MIN);
      startTimer();
      advance(20 * SEC);
      selectMode('affPrep');
      expect(getTimerState().running).toBe(false);
      expect(getTimerState().speechStopwatchBaseMs).toBe(20 * SEC);
      expect(isStopwatch(getTimerState()), 'a prep clock is never a stopwatch').toBe(false);
      selectMode('speech');
      expect(getVisibleRemainingMs(getTimerState())).toBe(20 * SEC);
      startTimer();
      advance(4 * SEC);
      expect(getVisibleRemainingMs(getTimerState())).toBe(24 * SEC);
      pauseTimer();
    } finally {
      vi.useRealTimers();
    }
  });
});
