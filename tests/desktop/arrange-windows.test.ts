/**
 * Arrange Windows geometry: the speech doc's rectangle on the chosen
 * side, every other window's rectangle on the other, both full height,
 * in the work area's own coordinates (second monitors, docks).
 */
import { describe, it, expect } from 'vitest';
import { arrangementRects, clampSpeechPct } from '../../apps/desktop/src/arrange-windows';

const area = { x: 100, y: 25, width: 1600, height: 900 };

describe('arrangementRects', () => {
  it('speech on the right at 50%: docs take the left half', () => {
    const r = arrangementRects(area, { side: 'right', speechPct: 50 });
    expect(r.docs).toEqual({ x: 100, y: 25, width: 800, height: 900 });
    expect(r.speech).toEqual({ x: 900, y: 25, width: 800, height: 900 });
  });

  it('speech on the left at 30%: speech first, docs get the remaining 70%', () => {
    const r = arrangementRects(area, { side: 'left', speechPct: 30 });
    expect(r.speech).toEqual({ x: 100, y: 25, width: 480, height: 900 });
    expect(r.docs).toEqual({ x: 580, y: 25, width: 1120, height: 900 });
  });

  it('the two rectangles tile the work area exactly', () => {
    for (const pct of [10, 33, 50, 67, 90]) {
      for (const side of ['left', 'right'] as const) {
        const r = arrangementRects(area, { side, speechPct: pct });
        expect(r.speech.width + r.docs.width).toBe(area.width);
        expect(Math.min(r.speech.x, r.docs.x)).toBe(area.x);
        expect(Math.max(r.speech.x + r.speech.width, r.docs.x + r.docs.width)).toBe(area.x + area.width);
      }
    }
  });

  it('clamps the share to 10–90 and defaults nonsense to 50', () => {
    expect(clampSpeechPct(0)).toBe(10);
    expect(clampSpeechPct(100)).toBe(90);
    expect(clampSpeechPct(42.6)).toBe(43);
    expect(clampSpeechPct(NaN)).toBe(50);
    expect(clampSpeechPct('lots')).toBe(50);
    expect(arrangementRects(area, { side: 'right', speechPct: 0 }).speech.width).toBe(160);
  });
});
