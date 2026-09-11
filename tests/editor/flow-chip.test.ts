// @vitest-environment jsdom

/**
 * PolicyDebateFlow status-bar chip: hidden unless the integration is
 * enabled, reads "Flow · Connected" / "Flow · Off" from the stored
 * token, clicking Connected revokes + clears, clicking Off opens
 * Settings, and a 401 from a background pf-presence poll clears the
 * token and flips the chip without the user clicking anything.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

const { revokeFlowToken } = vi.hoisted(() => ({ revokeFlowToken: vi.fn(() => Promise.resolve()) }));
vi.mock('../../src/editor/flow-send.js', () => ({ revokeFlowToken }));

import { initFlowChip } from '../../src/editor/flow-chip.js';
import { settings } from '../../src/editor/settings.js';
import { showToast } from '../../src/editor/toast.js';

function makeEl(): HTMLButtonElement {
  const el = document.createElement('button');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r));

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
  it('stays hidden when PolicyDebateFlow is disabled', () => {
    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});
    expect(el.hidden).toBe(true);
    cleanup();
  });

  it('shows "Flow · Off" when enabled with no token, "Flow · Connected" with one', () => {
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

  it('clicking while off calls openSettings, not revoke', () => {
    settings.set('policyDebateFlowEnabled', true);
    const el = makeEl();
    const openSettings = vi.fn();
    const cleanup = initFlowChip(el, openSettings);
    el.click();
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(revokeFlowToken).not.toHaveBeenCalled();
    cleanup();
  });

  it('clicking while connected revokes the token and clears it locally', () => {
    settings.set('policyDebateFlowEnabled', true);
    settings.set('policyDebateFlowToken', 'tok123');
    const el = makeEl();
    const cleanup = initFlowChip(el, () => {});
    el.click();
    expect(revokeFlowToken).toHaveBeenCalledWith('tok123');
    expect(settings.get('policyDebateFlowToken')).toBe('');
    expect(showToast).toHaveBeenCalledWith('Disconnected from PolicyDebateFlow');
    expect(el.textContent).toBe('Flow · Off');
    cleanup();
  });

  it('a 401 on the background presence poll clears the token and flips to Off', async () => {
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
