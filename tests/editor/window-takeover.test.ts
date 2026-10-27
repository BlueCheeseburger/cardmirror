// @vitest-environment jsdom
/**
 * Window takeover: a full-window tool (Compare documents) names the window
 * and keeps documents from opening into it, and gives both back when it
 * closes.
 */
import { describe, it, expect, vi } from 'vitest';
import { enterTakeover, currentTakeoverTitle, isTakenOver, onTakeoverChange } from '../../src/editor/window-takeover.js';

describe('window takeover', () => {
  it('is off until a tool enters, and off again once it leaves', () => {
    expect(isTakenOver()).toBe(false);
    expect(currentTakeoverTitle()).toBeNull();
    const release = enterTakeover('Compare documents');
    expect(isTakenOver()).toBe(true);
    expect(currentTakeoverTitle()).toBe('Compare documents');
    release();
    expect(isTakenOver()).toBe(false);
    expect(currentTakeoverTitle()).toBeNull();
  });

  it('releasing twice, or out of order, never clears someone else\'s takeover', () => {
    const a = enterTakeover('A');
    const b = enterTakeover('B');
    expect(currentTakeoverTitle()).toBe('B');
    a(); // the older one leaves first
    expect(currentTakeoverTitle()).toBe('B');
    a(); // and again: nothing
    expect(isTakenOver()).toBe(true);
    b();
    expect(isTakenOver()).toBe(false);
  });

  it('tells listeners on every enter and leave, and stops after unsubscribe', () => {
    const fn = vi.fn();
    const off = onTakeoverChange(fn);
    const release = enterTakeover('X');
    release();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    enterTakeover('Y')();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
