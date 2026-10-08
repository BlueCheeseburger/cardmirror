/**
 * Pace row under the ribbon timer: when "live remaining read time" is on,
 * the speech document's "Left" times show below the timer, with an
 * indicator to their right saying whether the clock and the reading agree:
 * on time, too slow (the time left on the clock is less than the first
 * reader needs for what is still unread), or too fast (you'd finish with
 * time to spare).
 */

import type { EditorView } from 'prosemirror-view';
import { settings } from './settings.js';
import { remainingReadCounts } from './live-read-time.js';
import { readTimeSeconds } from './word-count.js';
import { getTimerState, getVisibleRemainingMs, isStopwatch, subscribeTimer } from './timer-state.js';

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

const VERDICT_LABEL: Record<PaceVerdict, string> = {
  'on-time': 'On time',
  'too-slow': 'Too slow',
  'too-fast': 'Too fast',
};

export interface PaceTarget {
  view: EditorView;
  useLay: boolean;
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
    const state = getTimerState();
    const target = state.visible ? getTarget() : null;
    const counts = target ? remainingReadCounts(target.view.state, target.view) : null;
    if (!target || !counts) {
      row.hidden = true;
      panel!.classList.remove('pmd-timer-has-left');
      return;
    }
    const readers = settings.get('readers').slice(0, 2);
    const secs = readers.map((r) => readTimeSeconds(counts, r, target.useLay));
    if (secs.every((s) => s === null)) {
      row.hidden = true;
      panel!.classList.remove('pmd-timer-has-left');
      return;
    }
    times.textContent = readers
      .map((r, i) => `${r.name} ${secs[i] === null ? '—' : formatSeconds(secs[i]!)}`)
      .join(' · ');
    times.title = 'Read time left in the speech document';
    // Pace follows the first reader and the speech clock (not prep, not
    // the count-up stopwatch).
    const need = secs[0];
    if (need !== null && need !== undefined && state.mode === 'speech' && !isStopwatch(state)) {
      const clock = getVisibleRemainingMs(state) / 1000;
      const { verdict, deltaSec } = paceVerdict(clock, need);
      const off = verdict === 'on-time' ? '' : ` ${deltaSec < 0 ? '−' : '+'}${formatSeconds(Math.abs(deltaSec))}`;
      pace.textContent = VERDICT_LABEL[verdict] + off;
      pace.dataset['verdict'] = verdict;
      pace.title =
        `${readers[0]!.name} needs ${formatSeconds(need)} for what's left; ` +
        `${formatSeconds(clock)} on the clock.`;
    } else {
      pace.textContent = '';
      delete pace.dataset['verdict'];
      pace.title = '';
    }
    row.hidden = false;
    panel!.classList.add('pmd-timer-has-left');
  }

  subscribeTimer(update);
  settings.subscribe(update);
  // The clock ticks and the document scrolls without either notifying us.
  window.setInterval(update, 1000);
  update();
}
