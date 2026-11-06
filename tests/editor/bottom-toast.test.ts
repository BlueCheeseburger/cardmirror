// @vitest-environment jsdom
/**
 * The bottom toast: fixed at the bottom centre instead of at the pointer, with
 * an optional button. `showActionToast` (the older, button-only form) is built
 * on it and keeps its shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showActionToast, showBottomToast } from '../../src/editor/toast.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const toasts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pmd-toast')];
const button = (): HTMLButtonElement | null => document.querySelector('.pmd-toast-action-btn');

describe('showBottomToast', () => {
  it('leaves its position to the stylesheet (it is not placed at the pointer)', () => {
    showBottomToast('Hello');
    const t = toasts()[0]!;
    expect(t.classList.contains('pmd-toast-action')).toBe(true);
    expect(t.style.left).toBe('');
    expect(t.style.top).toBe('');
  });

  it('carries an icon, the message, a quoted detail and a pill, then the button', () => {
    showBottomToast('Sent to speech doc', {
      icon: 'mic',
      detail: '“A tag”',
      pill: 'at end',
      action: { label: 'Undo', onClick: () => {} },
    });
    const t = toasts()[0]!;
    expect(t.classList.contains('pmd-toast-rich')).toBe(true);
    expect(t.querySelector('.pmd-icon-mic')).not.toBeNull();
    expect(t.querySelector('.pmd-toast-main')?.textContent).toBe('Sent to speech doc');
    expect(t.querySelector('.pmd-toast-detail')?.textContent).toBe('“A tag”');
    expect(t.querySelector('.pmd-toast-pill')?.textContent).toBe('at end');
    expect(t.lastElementChild).toBe(button());
    expect(button()?.textContent).toBe('Undo');
  });

  it('has no button, and ignores the pointer, when it offers nothing to press', () => {
    showBottomToast('Just so you know');
    const t = toasts()[0]!;
    expect(button()).toBeNull();
    expect(t.classList.contains('pmd-toast-passive')).toBe(true);
    expect(t.textContent).toBe('Just so you know');
  });

  it('a button toast is not passive', () => {
    showBottomToast('Do it?', { action: { label: 'Yes', onClick: () => {} } });
    expect(toasts()[0]!.classList.contains('pmd-toast-passive')).toBe(false);
  });

  it('closes itself after its duration, with a fade first', () => {
    showBottomToast('Brief', { durationMs: 1000 });
    vi.advanceTimersByTime(999);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts()[0]!.classList.contains('pmd-toast-fade')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(toasts()).toHaveLength(0);
  });

  it('waits longer when it carries a button', () => {
    showBottomToast('Press me', { action: { label: 'Go', onClick: () => {} } });
    vi.advanceTimersByTime(7999);
    expect(toasts()[0]!.classList.contains('pmd-toast-fade')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toasts()[0]!.classList.contains('pmd-toast-fade')).toBe(true);
  });

  it('the button closes the toast first, then runs its action', () => {
    const seen: boolean[] = [];
    showBottomToast('Go?', {
      action: {
        label: 'Go',
        onClick: () => seen.push(toasts()[0]!.classList.contains('pmd-toast-fade')),
      },
    });
    button()!.click();
    expect(seen).toEqual([true]);
  });

  it('a second press while it fades does nothing', () => {
    const onClick = vi.fn();
    showBottomToast('Go?', { action: { label: 'Go', onClick } });
    const b = button()!;
    b.click();
    b.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not take the keyboard focus out of the editor when pressed', () => {
    showBottomToast('Go?', { action: { label: 'Go', onClick: () => {} } });
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button()!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('closing with `immediate` removes it at once, and closing twice is harmless', () => {
    const close = showBottomToast('Quick');
    close(true);
    expect(toasts()).toHaveLength(0);
    expect(() => close()).not.toThrow();
    expect(() => close(true)).not.toThrow();
  });
});

describe('showActionToast', () => {
  it('keeps its plain shape: the message, then one button', () => {
    const onAction = vi.fn();
    showActionToast('Moved here', { actionLabel: 'Go back', onAction });
    const t = toasts()[0]!;
    expect(t.classList.contains('pmd-toast-action')).toBe(true);
    expect(t.classList.contains('pmd-toast-rich')).toBe(false);
    expect(t.querySelector('.pmd-toast-action-text')?.textContent).toBe('Moved here');
    button()!.click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('stays up 8 s unless told otherwise', () => {
    showActionToast('Moved here', { actionLabel: 'Go back', onAction: () => {} });
    vi.advanceTimersByTime(7999);
    expect(toasts()[0]!.classList.contains('pmd-toast-fade')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toasts()[0]!.classList.contains('pmd-toast-fade')).toBe(true);
  });
});
