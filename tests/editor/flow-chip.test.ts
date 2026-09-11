// @vitest-environment jsdom

/**
 * PolicyDebateFlow status-bar chip: hidden until a token is paired,
 * reads "Flow · Connected" / "Flow · Off" from
 * (policyDebateFlowEnabled, policyDebateFlowToken). Clicking toggles
 * policyDebateFlowEnabled ONLY — a purely local pause/resume that never
 * touches the token or the network (the real disconnect, revoking the
 * token, lives only in Settings). The one exception: with no token at
 * all, clicking opens Settings instead, since there's nothing local to
 * toggle. A 401 from the background pf-presence poll (which only runs
 * while "Connected") clears the token and flips the chip without the
 * user clicking anything.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

import { initFlowChip } from '../../src/editor/flow-chip.js';
import { settings } from '../../src/editor/settings.js';
import { showToast } from '../../src/editor/toast.js';

function makeEl(): HTMLButtonElement {
  const el = document.createElement('button');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  settings.set('policyDebateFlowEnabled', false);
  settings.set('policyDebateFlowToken', '');
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('flow chip', () => {
  it('stays hidden when never paired (disabled, no token)', () => {
    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});
    expect(el.hidden).toBe(true);
    cleanup();
  });

  it('shows "Flow · Off" when enabled with no token, "Flow · Connected" once a token is set', () => {
    settings.set('policyDebateFlowEnabled', true);
    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('Flow · Off');
    expect(el.getAttribute('data-pf-state')).toBe('off');

    settings.set('policyDebateFlowToken', 'tok123');
    expect(el.textContent).toBe('Flow · Connected');
    expect(el.getAttribute('data-pf-state')).toBe('connected');
    cleanup();
  });

  it('shows "Flow · Off" (paused) — not hidden — when a token exists but enabled is false', () => {
    settings.set('policyDebateFlowToken', 'tok123');
    settings.set('policyDebateFlowEnabled', false);
    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('Flow · Off');
    expect(el.getAttribute('data-pf-state')).toBe('off');
    cleanup();
  });

  it('clicking while never paired (no token) calls openSettings, sets nothing', () => {
    settings.set('policyDebateFlowEnabled', true);
    const el = makeEl();
    const openSettings = vi.fn();
    const cleanup = initFlowChip(el, openSettings);
    el.click();
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(settings.get('policyDebateFlowEnabled')).toBe(true);
    cleanup();
  });

  it('clicking while connected pauses locally — enabled flips false, token is untouched', () => {
    settings.set('policyDebateFlowEnabled', true);
    settings.set('policyDebateFlowToken', 'tok123');
    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});
    el.click();
    expect(settings.get('policyDebateFlowEnabled')).toBe(false);
    expect(settings.get('policyDebateFlowToken')).toBe('tok123');
    expect(showToast).toHaveBeenCalledWith('PolicyDebateFlow paused');
    expect(el.textContent).toBe('Flow · Off');
    cleanup();
  });

  it('clicking while paused resumes locally — enabled flips true, token is untouched', () => {
    settings.set('policyDebateFlowToken', 'tok123');
    settings.set('policyDebateFlowEnabled', false);
    const el = makeEl();
    const openSettings = vi.fn();
    const cleanup = initFlowChip(el, openSettings);
    el.click();
    expect(settings.get('policyDebateFlowEnabled')).toBe(true);
    expect(settings.get('policyDebateFlowToken')).toBe('tok123');
    expect(showToast).toHaveBeenCalledWith('PolicyDebateFlow resumed');
    expect(openSettings).not.toHaveBeenCalled();
    expect(el.textContent).toBe('Flow · Connected');
    cleanup();
  });

  it('a 401 on the background presence poll clears the token and falls back to the bootstrap "Off" state', async () => {
    vi.useFakeTimers();
    settings.set('policyDebateFlowEnabled', true);
    settings.set('policyDebateFlowToken', 'tok123');
    const fetchMock = vi.fn(() => Promise.resolve({ status: 401 } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});
    expect(el.textContent).toBe('Flow · Connected');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/pf-presence'),
      expect.objectContaining({ headers: { Authorization: 'Bearer tok123' } }),
    );
    expect(settings.get('policyDebateFlowToken')).toBe('');
    // enabled is untouched by the 401 handler; with no token left this
    // is the same "never paired" state as before ever connecting —
    // still visible (not hidden), showing Off with click-to-reconnect
    // via Settings, same as the bootstrap case.
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('Flow · Off');

    cleanup();
    vi.unstubAllGlobals();
  });

  it('an OK presence poll leaves the connection intact and keeps polling', async () => {
    vi.useFakeTimers();
    settings.set('policyDebateFlowEnabled', true);
    settings.set('policyDebateFlowToken', 'tok123');
    const fetchMock = vi.fn(() => Promise.resolve({ status: 200 } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});

    await vi.advanceTimersByTimeAsync(30_000);
    expect(settings.get('policyDebateFlowToken')).toBe('tok123');
    expect(el.textContent).toBe('Flow · Connected');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not poll while paused', async () => {
    vi.useFakeTimers();
    settings.set('policyDebateFlowToken', 'tok123');
    settings.set('policyDebateFlowEnabled', false);
    const fetchMock = vi.fn(() => Promise.resolve({ status: 200 } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();

    cleanup();
    vi.unstubAllGlobals();
  });

  it('cleanup stops the poll timer', async () => {
    vi.useFakeTimers();
    settings.set('policyDebateFlowEnabled', true);
    settings.set('policyDebateFlowToken', 'tok123');
    const fetchMock = vi.fn(() => Promise.resolve({ status: 200 } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});
    cleanup();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
