import { describe, it, expect } from 'vitest';
import { paceVerdict, paceTolerance, formatSeconds } from '../../src/editor/timer-pace.js';

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
