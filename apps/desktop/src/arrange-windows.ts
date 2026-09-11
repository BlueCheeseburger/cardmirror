/**
 * Arrange Windows geometry (Verbatim's Window Arranger, ported): the
 * speech doc takes one side of the work area, every other window the
 * other side, all full height. Pure — main.ts applies the rectangles
 * with Electron, tests check the arithmetic. Coordinates are the work
 * area's own (a second monitor's origin is not 0,0; a dock or taskbar
 * shrinks the area), so the rects are usable as-is by `setBounds`.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrangeOptions {
  /** Which side of the screen the speech doc takes. */
  side: 'left' | 'right';
  /** The speech doc's share of the width, in percent (clamped 10–90). */
  speechPct: number;
}

export const MIN_SPEECH_PCT = 10;
export const MAX_SPEECH_PCT = 90;
export const DEFAULT_SPEECH_PCT = 50;

export function clampSpeechPct(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : DEFAULT_SPEECH_PCT;
  return Math.min(MAX_SPEECH_PCT, Math.max(MIN_SPEECH_PCT, v));
}

/** The two rectangles: `speech` for the speech doc's window, `docs` for
 *  every other window (they all share it, stacked, like Verbatim). */
export function arrangementRects(workArea: Rect, opts: ArrangeOptions): { speech: Rect; docs: Rect } {
  const speechWidth = Math.round((workArea.width * clampSpeechPct(opts.speechPct)) / 100);
  const docsWidth = workArea.width - speechWidth;
  const speechX = opts.side === 'right' ? workArea.x + docsWidth : workArea.x;
  const docsX = opts.side === 'right' ? workArea.x : workArea.x + speechWidth;
  return {
    speech: { x: speechX, y: workArea.y, width: speechWidth, height: workArea.height },
    docs: { x: docsX, y: workArea.y, width: docsWidth, height: workArea.height },
  };
}
