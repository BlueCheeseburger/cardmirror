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

/** A speech doc that reads at least this much faster than the clock is
 *  judged against its own length rather than the clock (see `paceRowModel`). */
export const SHORT_DOC_SLACK_SEC = 120;

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
    // A doc far shorter than the speech would read "Too fast" the whole way.
    // When it is at least SHORT_DOC_SLACK_SEC shorter, compare the pace
    // instead: take the spare time off the clock, as if the speech were
    // exactly as long as the doc.
    let clockSec = input.clockSec;
    const total = input.totalCounts ? readTimeSeconds(input.totalCounts, reader, input.useLay) : null;
    const speechTotal = input.speechTotalSec ?? 0;
    if (total !== null && speechTotal > 0 && speechTotal - total >= SHORT_DOC_SLACK_SEC) {
      clockSec -= speechTotal - total;
    }
    const { verdict, deltaSec } = paceVerdict(clockSec, need);
    const off = verdict === 'on-time' ? '' : ` ${deltaSec < 0 ? '−' : '+'}${formatSeconds(Math.abs(deltaSec))}`;
    out.verdict = verdict;
    out.hue = paceHue(deltaSec, need);
    out.verdictText = VERDICT_LABEL[verdict] + off;
    out.verdictTip =
      `${reader.name} needs ${formatSeconds(need)} for what's left; ` +
      `${formatSeconds(clockSec)} on the clock` +
      (clockSec !== input.clockSec ? ' (not counting the time the speech has to spare).' : '.');
  }
  return out;
}

/** The timer panel is showing in this window's ribbon and the feature behind
 *  the row ("live read time for what is left") is on. */
function paceAvailable(): boolean {
  const s = getTimerState();
  return s.visible && !s.poppedOut && settings.get('liveRemainingReadTime');
}

/** "Fit time left inside the timer" is in effect: the text sits in the timer's
 *  own box, so the row takes no space of its own. Only meaningful while the
 *  time left is shown under the timer. */
export function paceInline(): boolean {
  return paceAvailable() && settings.get('timerLeftUnderTimer') && settings.get('timerLeftInline');
}

/** Whether the pace row's space is reserved in the ribbon: the timer
 *  panel is showing in this window's ribbon and the feature behind the row
 *  ("live read time for what is left") is on. Deliberately NOT tied to the
 *  clock running or a document being open, so the ribbon holds one height
 *  while the feature is available. Not reserved at all in the inline
 *  placement, which adds no row. */
export function paceRowReserved(): boolean {
  return paceAvailable() && !paceInline();
}

/** Class on <html> while the row's space is reserved: the ribbon grows by
 *  the row's height and its contents align to the top (see style.css). */
export const PACE_ROW_HTML_CLASS = 'pmd-ribbon-pace-row';

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
    const reserved = paceRowReserved();
    document.documentElement.classList.toggle(PACE_ROW_HTML_CLASS, reserved);
    panel!.classList.toggle('pmd-timer-has-left', reserved);
    // Inline: the same element rides over the timer's own box (CSS), the
    // digits make room for it, and the verdict is its colour instead of text.
    panel!.classList.toggle('pmd-timer-has-left-inline', inline);
    row.classList.toggle('pmd-timer-left-inline', inline);
    row.hidden = !(reserved || inline);
    if (row.hidden) return;

    const state = getTimerState();
    const target = getTarget();
    const counts = target ? remainingReadCounts(target.view.state, target.view) : null;
    const model = paceRowModel({
      reader: settings.get('readers')[0],
      counts,
      useLay: target?.useLay ?? false,
      showLeft: settings.get('timerLeftUnderTimer'),
      speechCountdownRunning: speechCountdownRunning(state),
      clockSec: getVisibleRemainingMs(state) / 1000,
      totalCounts: target && speechCountdownRunning(state) ? wholeReadCounts(target.view.state) : null,
      speechTotalSec: state.speechTotalMs / 1000,
    });
    times.textContent = model.left;
    pace.textContent = inline ? '' : model.verdictText;
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
    // Inline there's no room for the verdict text, so its words ride along
    // in the left time's tooltip.
    setElementTooltip(
      times,
      inline && model.verdictText ? [model.leftTip, `${model.verdictText}. ${model.verdictTip}`].filter(Boolean).join('\n') : model.leftTip,
    );
    setElementTooltip(pace, inline ? '' : model.verdictTip);
  }

  refreshPaceNow = update;
  subscribeTimer(update);
  settings.subscribe(update);
  // The clock ticks and the document scrolls without either notifying us.
  window.setInterval(update, 1000);
  update();
}
