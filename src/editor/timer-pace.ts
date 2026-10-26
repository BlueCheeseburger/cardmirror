/**
 * Pace row under the ribbon timer, for the first reader only:
 *
 *   - the time they have LEFT to read (the speech document's unread words),
 *     when "Show time left under the timer" is on; and
 *   - while the SPEECH clock is actually running, a verdict saying whether
 *     the clock and the reading agree — on time, too slow (the time left on
 *     the clock is less than they need for what is still unread) or too
 *     fast (they'd finish with time to spare).
 *
 * Both need "live read time for what is left to read" on (the unread
 * words come from it). The row's space is reserved whenever it could show
 * (see `reserved`), so starting or stopping the clock never moves the
 * ribbon.
 */

import type { EditorView } from 'prosemirror-view';
import { settings } from './settings.js';
import { remainingReadCounts, wholeReadCounts } from './live-read-time.js';
import { readTimeSeconds, type ReadAloudCounts, type ReaderRates } from './word-count.js';
import {
  getTimerState,
  getVisibleRemainingMs,
  isStopwatch,
  subscribeTimer,
  type TimerState,
} from './timer-state.js';
import { setElementTooltip } from './ribbon-tooltips.js';

/** M:SS. */
export function formatSeconds(total: number): string {
  const t = Math.max(0, Math.round(total));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export type PaceVerdict = 'on-time' | 'too-slow' | 'too-fast';

/** Slack (seconds) either way that still counts as on time: 3 % of the
 *  reading time, but never less than 5 s. */
export function paceTolerance(needSec: number): number {
  return Math.max(5, needSec * 0.03);
}

/** Compare the time left on the clock with the time the reader needs for
 *  the rest. `deltaSec` is clock minus need: negative means short on time. */
export function paceVerdict(
  clockSec: number,
  needSec: number,
): { verdict: PaceVerdict; deltaSec: number } {
  const deltaSec = clockSec - needSec;
  const tol = paceTolerance(needSec);
  if (deltaSec < -tol) return { verdict: 'too-slow', deltaSec };
  if (deltaSec > tol) return { verdict: 'too-fast', deltaSec };
  return { verdict: 'on-time', deltaSec };
}

/** Hue (degrees) of the inline indicator dot: a continuous scale instead of
 *  three steps — red when well behind, green when on pace, blue when well
 *  ahead, shading through orange / yellow-green and teal in between.
 *  `deltaSec` is clock minus need (as in `paceVerdict`); "well" means about
 *  15 % of the reading time, never less than 20 s. Anything inside the
 *  on-time tolerance is pure green. */
export const PACE_HUE_RED = 0;
export const PACE_HUE_GREEN = 130;
export const PACE_HUE_BLUE = 215;
export function paceHue(deltaSec: number, needSec: number): number {
  const tol = paceTolerance(needSec);
  const full = Math.max(20, needSec * 0.15);
  const over = Math.max(0, Math.abs(deltaSec) - tol);
  const x = Math.min(1, over / Math.max(1, full - tol));
  return deltaSec < 0
    ? PACE_HUE_GREEN - x * (PACE_HUE_GREEN - PACE_HUE_RED)
    : PACE_HUE_GREEN + x * (PACE_HUE_BLUE - PACE_HUE_GREEN);
}

const VERDICT_LABEL: Record<PaceVerdict, string> = {
  'on-time': 'On time',
  'too-slow': 'Too slow',
  'too-fast': 'Too fast',
};

/** Is the speech clock counting down right now? Not paused, not a prep
 *  clock, not the count-up stopwatch — the only state the verdict means
 *  anything in. */
export function speechCountdownRunning(s: TimerState): boolean {
  return s.running && s.mode === 'speech' && !isStopwatch(s);
}

/** What the unread part of the doc takes on the clock at the pace that fits
 *  the WHOLE doc into the WHOLE speech: the reader's own time for it, scaled by
 *  speech length over doc length (a doc shorter than the speech is read more
 *  slowly, a longer one faster). With either length unknown, the reader's own
 *  time, unscaled. */
export function pacedNeedSec(needSec: number, totalSec: number | null, speechTotalSec: number): number {
  if (totalSec !== null && totalSec > 0 && speechTotalSec > 0) return (needSec * speechTotalSec) / totalSec;
  return needSec;
}

/** Whether the speech clock has been started and not reset: counting down now,
 *  or paused part-way. Not a prep clock, not the stopwatch, and not a fresh
 *  or reset clock (a reset zeroes the armed speech length; a loaded preset
 *  sits at its full length). The reading-position marker shows in this state,
 *  so pausing leaves it where it is and only a reset takes it away. */
export function speechClockStarted(s: TimerState): boolean {
  if (s.mode !== 'speech' || isStopwatch(s)) return false;
  if (s.running) return true;
  return s.speechTotalMs > 0 && getVisibleRemainingMs(s) < s.speechTotalMs;
}

/** A doc that reads this much longer than the speech is almost certainly a
 *  masterfile, not a speech, so the reading-position marker stays hidden. */
export const MASTERFILE_OVER_SEC = 60;

/** How many seconds of the doc (at the reader's own rate), read from the top,
 *  the speaker should have got through by now if they read the whole doc at a
 *  steady pace across the whole speech: the doc's read time times the share of
 *  the speech already used. It starts at 0 whatever the doc's length and
 *  reaches the end of the doc when the clock does. With the speech length
 *  unknown it falls back to total minus the clock. Null when the marker should
 *  not show: an empty doc, or a doc `MASTERFILE_OVER_SEC` over the speech. */
export function expectedReadSec(input: {
  clockSec: number;
  totalSec: number;
  speechTotalSec: number;
}): number | null {
  const { clockSec, totalSec, speechTotalSec } = input;
  if (!(totalSec > 0)) return null;
  if (speechTotalSec > 0 && totalSec - speechTotalSec > MASTERFILE_OVER_SEC) return null;
  const done =
    speechTotalSec > 0 ? (totalSec * (speechTotalSec - clockSec)) / speechTotalSec : totalSec - clockSec;
  return Math.max(0, Math.min(totalSec, done));
}

export interface PaceRowModel {
  /** "Left 9:50" (or "Left —" with no usable rate); '' when it isn't shown. */
  left: string;
  /** "Too slow −9:50"; '' unless the speech clock is counting down. */
  verdictText: string;
  verdict: PaceVerdict | null;
  /** Indicator dot hue in degrees (`paceHue`); null unless there's a verdict. */
  hue: number | null;
  /** Tooltip for the left time; '' when `left` is. */
  leftTip: string;
  /** Tooltip for the verdict; '' when `verdictText` is. */
  verdictTip: string;
}

export interface PaceRowInput {
  /** The first reader (the only one this row shows), if there is one. */
  reader: (ReaderRates & { name: string }) | undefined;
  /** Unread read-aloud words, or null when they can't be counted. */
  counts: ReadAloudCounts | null;
  useLay: boolean;
  /** "Show time left under the timer". */
  showLeft: boolean;
  speechCountdownRunning: boolean;
  /** Seconds on the speech clock. */
  clockSec: number;
  /** Unread-from-the-top counts for the whole doc, and the length the
   *  speech clock was armed with (seconds; 0 if unknown). */
  totalCounts?: ReadAloudCounts | null;
  speechTotalSec?: number;
}

/** What the pace row says. Pure, so the rules are testable without a DOM. */
export function paceRowModel(input: PaceRowInput): PaceRowModel {
  const { reader, counts } = input;
  const empty: PaceRowModel = { left: '', verdictText: '', verdict: null, hue: null, leftTip: '', verdictTip: '' };
  if (!reader || !counts) return empty;
  const need = readTimeSeconds(counts, reader, input.useLay);
  const out = { ...empty };
  if (input.showLeft) {
    out.left = `Left ${need === null ? '—' : formatSeconds(need)}`;
    out.leftTip = `${reader.name}'s read time for what's left in the speech document`;
  }
  if (input.speechCountdownRunning && need !== null) {
    // Judge the pace that fits the whole doc into the whole speech, not the
    // reader's own wpm: scale what is left by speech length over doc length.
    const total = input.totalCounts ? readTimeSeconds(input.totalCounts, reader, input.useLay) : null;
    const paced = pacedNeedSec(need, total, input.speechTotalSec ?? 0);
    const clockSec = input.clockSec;
    const { verdict, deltaSec } = paceVerdict(clockSec, paced);
    const off = verdict === 'on-time' ? '' : ` ${deltaSec < 0 ? '−' : '+'}${formatSeconds(Math.abs(deltaSec))}`;
    out.verdict = verdict;
    out.hue = paceHue(deltaSec, paced);
    out.verdictText = VERDICT_LABEL[verdict] + off;
    out.verdictTip =
      paced === need
        ? `${reader.name} needs ${formatSeconds(need)} for what's left; ${formatSeconds(clockSec)} on the clock.`
        : `Reading the whole document across the whole speech, what's left takes ${formatSeconds(paced)} ` +
          `(${reader.name}'s own time for it is ${formatSeconds(need)}); ${formatSeconds(clockSec)} on the clock.`;
  }
  return out;
}

/** The timer panel is showing in this window's ribbon and the feature behind
 *  the row ("live read time for what is left") is on. */
function paceAvailable(): boolean {
  const s = getTimerState();
  return s.visible && !s.poppedOut && settings.get('liveRemainingReadTime');
}

/** The time left shows in the timer's own box: the timer panel is in this
 *  window's ribbon, "live read time for what is left" is on, and "Show time
 *  left under the timer" is on. The text sits under the digits and takes no
 *  space of its own, so the ribbon keeps one height. */
export function paceInline(): boolean {
  return paceAvailable() && settings.get('paceGuides');
}

export interface PaceTarget {
  view: EditorView;
  useLay: boolean;
}

let refreshPaceNow: (() => void) | null = null;

/** Re-render the pace row right now. The row also refreshes every second and
 *  on timer / settings changes; a per-document switch (the lay-speaking
 *  toggle) is neither, so whoever flips it calls this. No-op before mount. */
export function refreshTimerPace(): void {
  refreshPaceNow?.();
}

/** Add the pace row to the ribbon timer panel. `getTarget` returns the
 *  speech document's view (or the focused one). */
export function mountTimerPace(getTarget: () => PaceTarget | null): void {
  const panel = document.getElementById('timer-panel');
  if (!panel || panel.querySelector('#timer-left-row')) return;
  const row = document.createElement('div');
  row.id = 'timer-left-row';
  row.className = 'pmd-timer-left-row';
  row.hidden = true;
  const times = document.createElement('span');
  times.className = 'pmd-timer-left-times';
  const pace = document.createElement('span');
  pace.className = 'pmd-timer-pace';
  row.append(times, pace);
  panel.appendChild(row);

  function update(): void {
    const inline = paceInline();
    // The row rides over the timer's own box (CSS), the digits make room for
    // it, and the verdict is its colour instead of text.
    panel!.classList.toggle('pmd-timer-has-left-inline', inline);
    row.classList.toggle('pmd-timer-left-inline', inline);
    row.hidden = !inline;
    if (row.hidden) return;

    const state = getTimerState();
    const target = getTarget();
    const counts = target ? remainingReadCounts(target.view.state, target.view) : null;
    const model = paceRowModel({
      reader: settings.get('readers')[0],
      counts,
      useLay: target?.useLay ?? false,
      showLeft: settings.get('paceGuides'),
      speechCountdownRunning: speechCountdownRunning(state),
      clockSec: getVisibleRemainingMs(state) / 1000,
      totalCounts: target && speechCountdownRunning(state) ? wholeReadCounts(target.view.state) : null,
      speechTotalSec: state.speechTotalMs / 1000,
    });
    times.textContent = model.left;
    pace.textContent = '';
    if (model.verdict) {
      pace.dataset['verdict'] = model.verdict;
      row.dataset['verdict'] = model.verdict;
      row.style.setProperty('--pmd-pace-hue', String(Math.round(model.hue ?? PACE_HUE_GREEN)));
    } else {
      delete pace.dataset['verdict'];
      delete row.dataset['verdict'];
      row.style.removeProperty('--pmd-pace-hue');
    }
    // Custom tooltips only: assigning `title` on every tick (these change
    // each second) would put the native tooltip back beside ours.
    // There's no room for the verdict text, so its words ride along in the
    // left time's tooltip.
    setElementTooltip(
      times,
      model.verdictText ? [model.leftTip, `${model.verdictText}. ${model.verdictTip}`].filter(Boolean).join('\n') : model.leftTip,
    );
    setElementTooltip(pace, '');
  }

  refreshPaceNow = update;
  subscribeTimer(update);
  settings.subscribe(update);
  // The clock ticks and the document scrolls without either notifying us.
  window.setInterval(update, 1000);
  update();
}
