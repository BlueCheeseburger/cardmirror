// @vitest-environment jsdom

/**
 * Flow / lay speaking speeds: the readers editor's two sections (flow
 * list, divider, lay list) and the bottom-bar Flow / Lay button helpers.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';

const hostState = vi.hoisted(() => ({
  proxiedHost: new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'kind') return 'electron';
        // Rows unrelated to readers read fields off these results
        // (e.g. `.enabled`), so resolve to an empty object, not undefined.
        return () => Promise.resolve({});
      },
    },
  ),
}));

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));
// benchmark-ui transitively imports editor/index.ts (wires the real DOM).
vi.mock('../../src/editor/benchmark-ui.js', () => ({ launchBenchmarkOverlay: vi.fn() }));
vi.mock('../../src/editor/host/index.js', () => ({
  getElectronHost: () => hostState.proxiedHost,
  getHost: () => hostState.proxiedHost,
  isWindowsHost: () => false,
}));

import { openSettings, closeSettings } from '../../src/editor/settings-ui.js';
import { settings } from '../../src/editor/settings.js';
import { showToast } from '../../src/editor/toast.js';
import { canSwitchSpeedMode, renderSpeedModeButton } from '../../src/editor/live-read-time.js';
import { readTimeSeconds } from '../../src/editor/word-count.js';

const settled = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= FakeResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView(): void {};

afterEach(() => {
  // Not clearing document.body: the settings modal is a reused singleton,
  // and wiping the body would detach it for the next test.
  closeSettings();
  settings.set('readers', [{ name: 'Reader 1', wpm: 200 }]);
  vi.clearAllMocks();
});

describe('readers editor: flow and lay sections', () => {
  it('shows a Flow speaking list, a divider, then a Lay speaking list in the same order', async () => {
    settings.set('readers', [
      { name: 'Amy', wpm: 300, tagWpm: 350, layWpm: 160 },
      { name: 'Ben', wpm: 280 },
    ]);
    openSettings({ category: 'general' });
    await settled();
    const editor = document.querySelector<HTMLElement>('.pmd-readers-editor')!;
    expect(editor).not.toBeNull();
    const titles = [...editor.querySelectorAll('.pmd-readers-section-title')].map((t) => t.textContent);
    expect(titles).toEqual(['Flow speaking', 'Lay speaking']);
    // Divider sits between the two sections.
    const kids = [...editor.children];
    const divider = editor.querySelector('.pmd-readers-divider')!;
    expect(kids.indexOf(divider)).toBeGreaterThan(kids.indexOf(editor.querySelector('.pmd-readers-add')!));
    const layTitle = editor.querySelectorAll('.pmd-readers-section-title')[1]!;
    expect(kids.indexOf(divider)).toBeLessThan(kids.indexOf(layTitle));
    // No per-reader Flow/Lay dropdown anymore; flow rows carry no lay field.
    expect(editor.querySelector('.pmd-reader-lay-mode')).toBeNull();
    const flowRows = editor.querySelectorAll('.pmd-readers-list:not(.pmd-readers-lay-list) .pmd-reader-row');
    expect(flowRows).toHaveLength(2);
    expect(flowRows[0]!.querySelector('.pmd-reader-laywpm')).toBeNull();
    // Lay rows: same readers, same order, current lay rates (blank = none).
    const layRows = [...editor.querySelectorAll('.pmd-reader-lay-row')];
    expect(layRows.map((r) => r.querySelector('.pmd-reader-lay-name')!.textContent)).toEqual(['Amy', 'Ben']);
    const layInputs = layRows.map((r) => r.querySelector<HTMLInputElement>('.pmd-reader-laywpm')!);
    expect(layInputs.map((i) => i.value)).toEqual(['160', '']);
  });

  it('setting, clearing and rejecting a lay rate', async () => {
    settings.set('readers', [
      { name: 'Amy', wpm: 300 },
      { name: 'Ben', wpm: 280, layWpm: 150 },
    ]);
    openSettings({ category: 'general' });
    await settled();
    const layInput = (i: number): HTMLInputElement =>
      document.querySelectorAll<HTMLInputElement>('.pmd-reader-lay-row .pmd-reader-laywpm')[i]!;

    layInput(0).value = '170';
    layInput(0).dispatchEvent(new Event('change'));
    expect(settings.get('readers')[0]).toEqual({ name: 'Amy', wpm: 300, layWpm: 170 });

    layInput(1).value = '';
    layInput(1).dispatchEvent(new Event('change'));
    expect(settings.get('readers')[1]).toEqual({ name: 'Ben', wpm: 280 });

    layInput(0).value = '-5';
    layInput(0).dispatchEvent(new Event('change'));
    expect(settings.get('readers')[0]!.layWpm).toBe(170);
  });
});

describe('Flow / Lay button', () => {
  it('labels the mode and marks lay as pressed', () => {
    const btn = document.createElement('button');
    renderSpeedModeButton(btn, false);
    expect(btn.textContent).toBe('Flow');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.classList.contains('pmd-active')).toBe(false);
    renderSpeedModeButton(btn, true);
    expect(btn.textContent).toBe('Lay');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.classList.contains('pmd-active')).toBe(true);
  });

  it('won’t switch to lay when neither shown reader has a lay rate, and says where to add one', () => {
    settings.set('readers', [
      { name: 'Amy', wpm: 300 },
      { name: 'Ben', wpm: 280 },
      { name: 'Cal', wpm: 250, layWpm: 150 }, // third reader isn't shown in the bar
    ]);
    expect(canSwitchSpeedMode(false)).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Settings → General → Word counts'));
    // Switching back to flow is always allowed.
    expect(canSwitchSpeedMode(true)).toBe(true);
  });

  it('switches to lay once a shown reader has a lay rate', () => {
    settings.set('readers', [
      { name: 'Amy', wpm: 300 },
      { name: 'Ben', wpm: 280, layWpm: 150 },
    ]);
    expect(canSwitchSpeedMode(false)).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('lay tags/cites rate', () => {
  it('splits lay time between the lay rate and the lay tags/cites rate', () => {
    const counts = { body: 150, other: 60 };
    // 150/150 + 60/120 = 1.5 min
    expect(readTimeSeconds(counts, { wpm: 300, layWpm: 150, layTagWpm: 120 }, true)).toBe(90);
    // Blank tags/cites rate: lay rate covers everything, 210/150 min.
    expect(readTimeSeconds(counts, { wpm: 300, layWpm: 150 }, true)).toBeCloseTo(84);
    // No lay rate: no lay time, even with a lay tags rate.
    expect(readTimeSeconds(counts, { wpm: 300, layTagWpm: 120 }, true)).toBeNull();
  });

  it('the lay rows have a tags/cites field that sets and clears layTagWpm', async () => {
    settings.set('readers', [{ name: 'Amy', wpm: 300, layWpm: 150 }]);
    openSettings({ category: 'general' });
    await settled();
    const input = (): HTMLInputElement =>
      document.querySelector<HTMLInputElement>('.pmd-reader-lay-row .pmd-reader-laytagwpm')!;
    expect(input().value).toBe('');
    input().value = '130';
    input().dispatchEvent(new Event('change'));
    expect(settings.get('readers')[0]).toEqual({ name: 'Amy', wpm: 300, layWpm: 150, layTagWpm: 130 });
    input().value = '';
    input().dispatchEvent(new Event('change'));
    expect(settings.get('readers')[0]).toEqual({ name: 'Amy', wpm: 300, layWpm: 150 });
  });
});
