// @vitest-environment jsdom
/**
 * Hold-to-dictate key: the chord begins once on keydown, auto-repeat is
 * swallowed, release of the main key or a needed modifier ends it, a
 * window blur ends it, and other keys pass through.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { installHoldToDictate, releaseEndsHold } from '../../src/editor/voice/hold-key.js';

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
});

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(e);
  return e;
}

describe('hold-to-dictate', () => {
  it('begins on the chord, swallows repeats, ends on release of the main key', () => {
    const log: string[] = [];
    uninstall = installHoldToDictate({ getKey: () => 'Mod-Shift-Space', begin: () => log.push('begin'), end: () => log.push('end') });
    const down = key('keydown', { key: ' ', code: 'Space', metaKey: true, shiftKey: true });
    expect(down.defaultPrevented).toBe(true);
    const rep = key('keydown', { key: ' ', code: 'Space', metaKey: true, shiftKey: true, repeat: true });
    expect(rep.defaultPrevented).toBe(true);
    expect(log).toEqual(['begin']);
    key('keyup', { key: ' ', code: 'Space', metaKey: true, shiftKey: true });
    expect(log).toEqual(['begin', 'end']);
  });

  it('releasing a modifier the chord needs also ends the hold', () => {
    const log: string[] = [];
    uninstall = installHoldToDictate({ getKey: () => 'Mod-Shift-Space', begin: () => log.push('begin'), end: () => log.push('end') });
    key('keydown', { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    key('keyup', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true });
    expect(log).toEqual(['begin', 'end']);
  });

  it('other keys pass through untouched; a blur ends a hold', () => {
    const log: string[] = [];
    uninstall = installHoldToDictate({ getKey: () => 'F9', begin: () => log.push('begin'), end: () => log.push('end') });
    const a = key('keydown', { key: 'a', code: 'KeyA' });
    expect(a.defaultPrevented).toBe(false);
    key('keydown', { key: 'F9', code: 'F9' });
    window.dispatchEvent(new Event('blur'));
    expect(log).toEqual(['begin', 'end']);
    key('keyup', { key: 'F9', code: 'F9' }); // already ended
    expect(log).toEqual(['begin', 'end']);
  });

  it('toggle mode: a press starts, the next press ends, keyup and other keys are ignored', () => {
    const log: string[] = [];
    let dictating = false;
    uninstall = installHoldToDictate({
      getKey: () => 'F9',
      getMode: () => 'toggle',
      isDictating: () => dictating,
      begin: () => { dictating = true; log.push('begin'); },
      end: () => { dictating = false; log.push('end'); },
    });
    const down = key('keydown', { key: 'F9', code: 'F9' });
    expect(down.defaultPrevented).toBe(true);
    key('keyup', { key: 'F9', code: 'F9' });
    expect(log).toEqual(['begin']);
    const other = key('keydown', { key: 'a', code: 'KeyA' });
    expect(other.defaultPrevented, 'hands are free in toggle mode').toBe(false);
    key('keydown', { key: 'F9', code: 'F9', repeat: true });
    expect(log).toEqual(['begin']);
    key('keydown', { key: 'F9', code: 'F9' });
    expect(log).toEqual(['begin', 'end']);
  });

  it('toggle mode: after the service ended the session, the next press starts fresh; a blur ends an open one', () => {
    const log: string[] = [];
    let dictating = false;
    uninstall = installHoldToDictate({
      getKey: () => 'F9',
      getMode: () => 'toggle',
      isDictating: () => dictating,
      begin: () => { dictating = true; log.push('begin'); },
      end: () => { dictating = false; log.push('end'); },
    });
    key('keydown', { key: 'F9', code: 'F9' });
    dictating = false; // the silence limit ended it from the service side
    key('keydown', { key: 'F9', code: 'F9' });
    expect(log).toEqual(['begin', 'begin']);
    window.dispatchEvent(new Event('blur'));
    expect(log).toEqual(['begin', 'begin', 'end']);
  });

  it('with voice off, the chord passes through untouched (a shared binding still fires)', () => {
    const log: string[] = [];
    uninstall = installHoldToDictate({ getKey: () => 'Mod-Shift-Space', isActive: () => false, begin: () => log.push('begin'), end: () => log.push('end') });
    const down = key('keydown', { key: ' ', code: 'Space', metaKey: true, shiftKey: true });
    expect(down.defaultPrevented).toBe(false);
    key('keyup', { key: ' ', code: 'Space', metaKey: true, shiftKey: true });
    expect(log).toEqual([]);
  });

  it('releaseEndsHold reads the chord', () => {
    expect(releaseEndsHold(new KeyboardEvent('keyup', { key: 'Meta' }), 'Mod-Shift-Space')).toBe(true);
    expect(releaseEndsHold(new KeyboardEvent('keyup', { key: 'Alt' }), 'Mod-Shift-Space')).toBe(false);
    expect(releaseEndsHold(new KeyboardEvent('keyup', { key: 'F9', code: 'F9' }), 'F9')).toBe(true);
    expect(releaseEndsHold(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA' }), 'F9')).toBe(false);
  });
});
