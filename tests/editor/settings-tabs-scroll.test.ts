// @vitest-environment jsdom

/**
 * Settings tab strip (fork): a vertical mouse wheel over an overflowing
 * strip scrolls it sideways (it used to be arrows-only). Horizontal
 * input (trackpad swipes) is left to native scrolling, and so is every
 * wheel when the strip fits and has nothing to scroll.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';

const hostState = vi.hoisted(() => ({
  proxiedHost: new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'kind') return 'electron';
        if (prop === 'pairingAccountStatus') return async () => ({ enabled: false, connected: false, expiresAt: 0 });
        if (prop.startsWith('on')) return () => () => {};
        return () => Promise.resolve(undefined);
      },
    },
  ),
}));

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../src/editor/benchmark-ui.js', () => ({ launchBenchmarkOverlay: vi.fn() }));
vi.mock('../../src/editor/host/index.js', () => ({
  getElectronHost: () => hostState.proxiedHost,
  getHost: () => hostState.proxiedHost,
  isWindowsHost: () => false,
}));

import { openSettings, closeSettings } from '../../src/editor/settings-ui.js';

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= FakeResizeObserver;

// Close only: the dialog is a singleton that keeps its overlay element,
// so wiping the body between tests would leave it detached.
afterEach(() => {
  closeSettings();
});

/** Open Settings and give the tab strip fake layout (jsdom has none). */
function openStrip(scrollWidth: number, clientWidth: number): {
  strip: HTMLElement;
  scrollBy: ReturnType<typeof vi.fn>;
} {
  openSettings();
  const strip = document.querySelector<HTMLElement>('.pmd-settings-tabs')!;
  Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(strip, 'clientWidth', { configurable: true, value: clientWidth });
  const scrollBy = vi.fn();
  strip.scrollBy = scrollBy as unknown as HTMLElement['scrollBy'];
  return { strip, scrollBy };
}

function wheel(el: HTMLElement, init: WheelEventInit): WheelEvent {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}

describe('settings tab strip scrolling', () => {
  it('turns a vertical wheel sideways when the tabs overflow', () => {
    const { strip, scrollBy } = openStrip(900, 500);
    const e = wheel(strip, { deltaY: 120 });
    expect(scrollBy).toHaveBeenCalledWith({ left: 120, behavior: 'auto' });
    expect(e.defaultPrevented).toBe(true);
  });

  it('converts line-mode wheel deltas to pixels', () => {
    const { strip, scrollBy } = openStrip(900, 500);
    wheel(strip, { deltaY: -3, deltaMode: 1 });
    expect(scrollBy).toHaveBeenCalledWith({ left: -48, behavior: 'auto' });
  });

  it('leaves horizontal swipes to native scrolling', () => {
    const { strip, scrollBy } = openStrip(900, 500);
    const e = wheel(strip, { deltaX: 80, deltaY: 5 });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('does nothing when every tab fits', () => {
    const { strip, scrollBy } = openStrip(500, 500);
    const e = wheel(strip, { deltaY: 120 });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});
