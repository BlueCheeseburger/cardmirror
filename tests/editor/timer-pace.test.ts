// @vitest-environment jsdom

/**
 * The pace row under the ribbon timer: the pure verdict rules, what the row
 * says (first reader only; the verdict only while the speech clock counts
 * down), when its ribbon space is reserved, and the mounted row itself —
 * including that it never puts a native `title` on its elements (the
 * app's custom tooltip would then show a second tooltip beside it).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../../src/schema/index.js';
import { settings } from '../../src/editor/settings.js';
import {
  PACE_ROW_HTML_CLASS,
  formatSeconds,
  mountTimerPace,
  paceRowModel,
  PACE_HUE_BLUE,
  PACE_HUE_GREEN,
  PACE_HUE_RED,
  paceHue,
  paceInline,
  paceRowReserved,
  paceTolerance,
  refreshTimerPace,
  paceVerdict,
  speechCountdownRunning,
  type PaceRowInput,
} from '../../src/editor/timer-pace.js';
import {
  getTimerState,
  loadSpeechPreset,
  pauseTimer,
  resetTimer,
  selectMode,
  setTimerPoppedOut,
  setTimerVisible,
  startTimer,
} from '../../src/editor/timer-state.js';

describe('timer pace', () => {
  it('is on time within a few seconds either way', () => {
    expect(paceVerdict(300, 298).verdict).toBe('on-time');
    expect(paceVerdict(300, 304).verdict).toBe('on-time');
  });
  it('is too slow when the clock has less than the reading needs', () => {
    const r = paceVerdict(240, 300);
    expect(r.verdict).toBe('too-slow');
    expect(r.deltaSec).toBe(-60);
  });
  it('is too fast when the clock has time to spare', () => {
    expect(paceVerdict(360, 300).verdict).toBe('too-fast');
  });
  it('scales the tolerance with the reading time, with a 5 s floor', () => {
    expect(paceTolerance(60)).toBe(5);
    expect(paceTolerance(600)).toBeCloseTo(18);
  });
  it('formats M:SS', () => {
    expect(formatSeconds(65)).toBe('1:05');
    expect(formatSeconds(-3)).toBe('0:00');
  });
});

describe('paceRowModel', () => {
  const reader = { name: 'Amy', wpm: 200, layWpm: 100 };
  // 100 body words at 200 wpm = 30 s; at 100 lay wpm = 60 s.
  const base: PaceRowInput = {
    reader,
    counts: { body: 100, other: 0 },
    useLay: false,
    showLeft: false,
    speechCountdownRunning: false,
    clockSec: 600,
  };

  it('says nothing without a reader or a count', () => {
    for (const input of [{ ...base, reader: undefined }, { ...base, counts: null }]) {
      expect(paceRowModel({ ...input, showLeft: true, speechCountdownRunning: true })).toEqual({
        left: '',
        verdictText: '',
        verdict: null,
        hue: null,
        leftTip: '',
        verdictTip: '',
      });
    }
  });

  it('shows the time left only when asked to, for the one reader', () => {
    expect(paceRowModel(base).left).toBe('');
    expect(paceRowModel({ ...base, showLeft: true }).left).toBe('Left 0:30');
  });

  it('shows the verdict only while the speech clock counts down', () => {
    expect(paceRowModel({ ...base, speechCountdownRunning: false }).verdictText).toBe('');
    const running = paceRowModel({ ...base, speechCountdownRunning: true, clockSec: 10 });
    expect(running.verdict).toBe('too-slow');
    expect(running.verdictText).toBe('Too slow −0:20');
    expect(running.verdictTip).toBe("Amy needs 0:30 for what's left; 0:10 on the clock.");
  });

  it('labels the other verdicts', () => {
    const at = (clockSec: number) => paceRowModel({ ...base, speechCountdownRunning: true, clockSec });
    expect(at(30).verdictText).toBe('On time');
    expect(at(30).verdict).toBe('on-time');
    expect(at(90).verdictText).toBe('Too fast +1:00');
  });

  it('keeps the left time when the verdict is absent, and vice versa', () => {
    const m = paceRowModel({ ...base, showLeft: true, speechCountdownRunning: true, clockSec: 30 });
    expect(m.left).toBe('Left 0:30');
    expect(m.verdictText).toBe('On time');
    expect(paceRowModel({ ...base, showLeft: false, speechCountdownRunning: true }).left).toBe('');
  });

  it('judges a doc much shorter than the speech by its own length, not the clock', () => {
    // Whole doc: 30 s of reading in a 10:00 speech. 30 s read, 30 s left, 9:30 on the clock.
    const short = { ...base, speechCountdownRunning: true, totalCounts: { body: 100, other: 0 }, speechTotalSec: 600 };
    // At the start the whole doc is unread: the clock is full (600), need 30 → on time.
    expect(paceRowModel({ ...short, clockSec: 600 }).verdict).toBe('on-time');
    // 20 s of the 30 s doc read after 20 s elapsed: clock 580, need 10 → on time.
    expect(paceRowModel({ ...short, counts: { body: 33, other: 0 }, clockSec: 580 }).verdict).toBe('on-time');
    // Read faster than the clock: 25 s elapsed, only 10 s of reading left.
    expect(paceRowModel({ ...short, counts: { body: 33, other: 0 }, clockSec: 575 }).verdict).toBe('on-time');
    expect(paceRowModel({ ...short, counts: { body: 33, other: 0 }, clockSec: 560 }).verdict).toBe('too-slow');
    expect(paceRowModel({ ...short, counts: { body: 33, other: 0 }, clockSec: 600 }).verdict).toBe('too-fast');
  });

  it('keeps the plain clock comparison when the doc nearly fills the speech', () => {
    // Doc 30 s in a 60 s speech: only 30 s spare (< 2 min), so no adjustment.
    const m = paceRowModel({ ...base, speechCountdownRunning: true, totalCounts: { body: 100, other: 0 }, speechTotalSec: 60, clockSec: 90 });
    expect(m.verdictText).toBe('Too fast +1:00');
  });

  it('uses the lay rate in lay mode, and shows a dash (no verdict) for a reader without one', () => {
    const lay = paceRowModel({ ...base, useLay: true, showLeft: true, speechCountdownRunning: true, clockSec: 60 });
    expect(lay.left).toBe('Left 1:00');
    expect(lay.verdictText).toBe('On time');
    const noLay = paceRowModel({
      ...base,
      reader: { name: 'Ben', wpm: 200 },
      useLay: true,
      showLeft: true,
      speechCountdownRunning: true,
    });
    expect(noLay.left).toBe('Left —');
    expect(noLay.verdictText).toBe('');
  });
});

describe('timer state rules', () => {
  beforeEach(() => {
    resetTimer();
    setTimerVisible(false);
  });
  afterEach(() => {
    pauseTimer();
    setTimerVisible(false);
    settings.set('liveRemainingReadTime', false);
  });

  it('the verdict needs the speech clock counting down', () => {
    loadSpeechPreset(5);
    expect(speechCountdownRunning(getTimerState())).toBe(false); // loaded, not started
    startTimer();
    expect(speechCountdownRunning(getTimerState())).toBe(true);
    pauseTimer();
    expect(speechCountdownRunning(getTimerState())).toBe(false);
  });

  it('prep clocks never get a verdict', () => {
    selectMode('affPrep');
    startTimer();
    expect(getTimerState().running).toBe(true);
    expect(speechCountdownRunning(getTimerState())).toBe(false);
    pauseTimer();
    selectMode('speech');
  });

  it('the count-up stopwatch never gets one', () => {
    startTimer(); // speech clock at 0:00 counts up
    expect(getTimerState().stopwatch).toBe(true);
    expect(speechCountdownRunning(getTimerState())).toBe(false);
  });

  it('the row’s space is reserved only while the timer is in this ribbon and the feature is on', () => {
    settings.set('liveRemainingReadTime', true);
    expect(paceRowReserved()).toBe(false); // timer hidden
    setTimerVisible(true);
    expect(paceRowReserved()).toBe(true);
    setTimerPoppedOut(true); // floating window: this ribbon's panel is hidden
    expect(paceRowReserved()).toBe(false);
    setTimerPoppedOut(false);
    expect(paceRowReserved()).toBe(true);
    settings.set('liveRemainingReadTime', false);
    expect(paceRowReserved()).toBe(false);
  });
});

describe('mounted pace row', () => {
  let lay = false;
  let view: EditorView;

  function docView(text: string): EditorView {
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Only highlighted body words are read aloud (and so counted).
    const highlight = schema.marks['highlight']!.create({ color: 'yellow' });
    const body = schema.nodes['card_body']!.create(null, schema.text(text, [highlight]));
    const tag = schema.nodes['tag']!.create(null, schema.text('Tag'));
    const doc = schema.nodes['doc']!.create(null, [schema.nodes['card']!.create(null, [tag, body])]);
    return new EditorView(host, { state: EditorState.create({ doc, schema }) });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<section id="timer-panel" hidden></section>';
    document.documentElement.classList.remove(PACE_ROW_HTML_CLASS);
    resetTimer();
    setTimerVisible(false);
    settings.set('readers', [
      { name: 'Amy', wpm: 60 },
      { name: 'Ben', wpm: 100 },
    ]);
    settings.set('liveRemainingReadTime', true);
    settings.set('timerLeftUnderTimer', false);
    view = docView('one two three four five six seven eight nine ten');
    lay = false;
    mountTimerPace(() => ({ view, useLay: lay }));
  });
  afterEach(() => {
    pauseTimer();
    setTimerVisible(false);
    settings.set('liveRemainingReadTime', false);
    settings.set('timerLeftUnderTimer', false);
    settings.set('timerLeftInline', false);
    view.destroy();
    vi.useRealTimers();
  });

  const row = (): HTMLElement => document.getElementById('timer-left-row')!;
  const times = (): HTMLElement => row().querySelector('.pmd-timer-left-times')!;
  const pace = (): HTMLElement => row().querySelector('.pmd-timer-pace')!;

  it('is hidden, with no space reserved, while the timer is hidden', () => {
    expect(row().hidden).toBe(true);
    expect(document.documentElement.classList.contains(PACE_ROW_HTML_CLASS)).toBe(false);
  });

  it('reserves its space once the timer shows, even with nothing to say', () => {
    setTimerVisible(true);
    expect(row().hidden).toBe(false);
    expect(document.documentElement.classList.contains(PACE_ROW_HTML_CLASS)).toBe(true);
    expect(document.getElementById('timer-panel')!.classList.contains('pmd-timer-has-left')).toBe(true);
    expect(times().textContent).toBe('');
    expect(pace().textContent).toBe('');
  });

  it('shows only the first reader’s time left when the setting is on', () => {
    setTimerVisible(true);
    settings.set('timerLeftUnderTimer', true);
    // 10 highlighted words + the 1-word tag at 60 wpm = 11 s (the count
    // starts at the cursor, at the top of the doc); Ben (100 wpm) never appears.
    expect(times().textContent).toBe('Left 0:11');
    expect(row().textContent).not.toContain('Ben');
  });

  it('shows the verdict only while the speech clock runs, and never as a native title', () => {
    setTimerVisible(true);
    loadSpeechPreset(1); // 1:00 on the clock vs 0:10 needed → too fast
    expect(pace().textContent).toBe('');
    startTimer();
    expect(pace().dataset['verdict']).toBe('too-fast');
    expect(pace().textContent).toMatch(/^Too fast \+0:\d\d$/);
    pauseTimer();
    expect(pace().textContent).toBe('');
    expect(pace().dataset['verdict']).toBeUndefined();
    for (const el of [times(), pace(), row()]) expect(el.hasAttribute('title')).toBe(false);
  });

  it('keeps ticking without ever setting a title', () => {
    setTimerVisible(true);
    loadSpeechPreset(1);
    startTimer();
    vi.advanceTimersByTime(5000);
    expect(pace().hasAttribute('title')).toBe(false);
    expect(times().hasAttribute('title')).toBe(false);
  });

  it('releases the space when the feature is turned off', () => {
    setTimerVisible(true);
    settings.set('liveRemainingReadTime', false);
    expect(row().hidden).toBe(true);
    expect(document.documentElement.classList.contains(PACE_ROW_HTML_CLASS)).toBe(false);
  });

  it('follows the lay toggle as soon as refreshTimerPace runs (three-pane keeps lay per pane)', () => {
    settings.set('readers', [{ name: 'Amy', wpm: 60, layWpm: 30 }]);
    setTimerVisible(true);
    settings.set('timerLeftUnderTimer', true);
    expect(times().textContent).toBe('Left 0:11');
    lay = true; // the pane's lay readout was switched on
    refreshTimerPace();
    expect(times().textContent).toBe('Left 0:22'); // same words at the slower lay rate
    lay = false;
    refreshTimerPace();
    expect(times().textContent).toBe('Left 0:11');
  });

  describe('inline placement (Fit time left inside the timer)', () => {
    it('adds no row and no ribbon height, and puts the text in the timer box', () => {
      setTimerVisible(true);
      settings.set('timerLeftUnderTimer', true);
      settings.set('timerLeftInline', true);
      expect(paceInline()).toBe(true);
      expect(paceRowReserved()).toBe(false);
      expect(document.documentElement.classList.contains(PACE_ROW_HTML_CLASS)).toBe(false);
      const panel = document.getElementById('timer-panel')!;
      expect(panel.classList.contains('pmd-timer-has-left')).toBe(false);
      expect(panel.classList.contains('pmd-timer-has-left-inline')).toBe(true);
      expect(row().hidden).toBe(false);
      expect(row().classList.contains('pmd-timer-left-inline')).toBe(true);
      expect(times().textContent).toBe('Left 0:11');
    });

    it('shows the verdict as a colour and a tooltip, not as text', () => {
      setTimerVisible(true);
      settings.set('timerLeftUnderTimer', true);
      settings.set('timerLeftInline', true);
      loadSpeechPreset(1);
      startTimer();
      expect(row().dataset['verdict']).toBe('too-fast');
      expect(pace().textContent).toBe('');
      expect(row().textContent).toBe('Left 0:11');
    });

    it('is ignored unless the time left is shown under the timer', () => {
      setTimerVisible(true);
      settings.set('timerLeftUnderTimer', false);
      settings.set('timerLeftInline', true);
      expect(paceInline()).toBe(false);
      expect(paceRowReserved()).toBe(true);
    });
  });
});

describe('paceHue — the indicator dot is a continuous scale', () => {
  it('is pure green on pace and anywhere inside the on-time tolerance', () => {
    expect(paceHue(0, 600)).toBe(PACE_HUE_GREEN);
    expect(paceHue(paceTolerance(600) - 1, 600)).toBe(PACE_HUE_GREEN);
    expect(paceHue(-(paceTolerance(600) - 1), 600)).toBe(PACE_HUE_GREEN);
  });

  it('runs red when well behind and blue when well ahead, and stops at the ends', () => {
    expect(paceHue(-600, 600)).toBe(PACE_HUE_RED);
    expect(paceHue(600, 600)).toBe(PACE_HUE_BLUE);
  });

  it('shades smoothly in between: more off pace means further along the scale', () => {
    const need = 480;
    const behind = [-10, -30, -60, -90].map((d) => paceHue(d, need));
    for (let i = 1; i < behind.length; i++) expect(behind[i]!).toBeLessThan(behind[i - 1]!);
    const ahead = [10, 30, 60, 90].map((d) => paceHue(d, need));
    for (let i = 1; i < ahead.length; i++) expect(ahead[i]!).toBeGreaterThan(ahead[i - 1]!);
    // Somewhere in the middle, not just one of three colours.
    expect(paceHue(-40, need)).toBeGreaterThan(PACE_HUE_RED);
    expect(paceHue(-40, need)).toBeLessThan(PACE_HUE_GREEN);
  });

  it('is what the model reports with a verdict, and absent without one', () => {
    const base: PaceRowInput = {
      reader: { name: 'Amy', wpm: 200, layWpm: 100 },
      counts: { body: 100, other: 0 },
      useLay: false,
      showLeft: true,
      speechCountdownRunning: false,
      clockSec: 0,
    };
    expect(paceRowModel(base).hue).toBeNull();
    const m = paceRowModel({ ...base, speechCountdownRunning: true, clockSec: 10 });
    expect(m.verdict).toBe('too-slow');
    expect(m.hue).toBe(paceHue(10 - 30, 30));
  });
});
