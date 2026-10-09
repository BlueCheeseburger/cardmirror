// @vitest-environment jsdom
/**
 * Update chip (install-on-confirm, 2026-07-16): the status-bar chip is
 * the ONLY auto-update surface — no dialogs. It renders the staged
 * ('ready') and detected-but-not-stageable ('available') states, pulls
 * the current state at boot (late-opened windows), tracks pushed
 * changes, and forwards clicks to the host's action.
 */
import { describe, expect, it } from 'vitest';
import {
  initUpdateChip,
  renderUpdateChip,
  type UpdateChipHost,
  type UpdateChipState,
} from '../../src/editor/update-chip.js';

function makeEl(): HTMLButtonElement {
  const el = document.createElement('button');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

function makeHost(initial: UpdateChipState | null): UpdateChipHost & {
  actions: number;
  push: (s: UpdateChipState | null) => void;
} {
  let handler: ((s: UpdateChipState | null) => void) | null = null;
  const host = {
    actions: 0,
    push: (s: UpdateChipState | null) => handler?.(s),
    getUpdateChipState: () => Promise.resolve(initial),
    updateChipAction: () => {
      host.actions++;
      return Promise.resolve();
    },
    onUpdateChip: (h: (s: UpdateChipState | null) => void) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
  };
  return host;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r));

describe('update chip', () => {
  it('renders ready and available states; null hides', () => {
    const el = makeEl();
    renderUpdateChip(el, { state: 'ready', version: '0.1.0-beta.15' });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('Update 0.1.0-beta.15 ready — restart to install');
    renderUpdateChip(el, { state: 'available', version: '0.1.0-beta.15' });
    expect(el.textContent).toBe('Update 0.1.0-beta.15 available');
    renderUpdateChip(el, null);
    expect(el.hidden).toBe(true);
  });

  it('renders the downloading state with a percent and a fill custom property', () => {
    const el = makeEl();
    renderUpdateChip(el, { state: 'downloading', version: '1.8.0-bcb.3', pct: 0 });
    expect(el.hidden).toBe(false);
    expect(el.getAttribute('data-state')).toBe('downloading');
    expect(el.textContent).toBe('Downloading update 1.8.0-bcb.3 — 0%');
    expect(el.style.getPropertyValue('--pmd-update-pct')).toBe('0%');

    renderUpdateChip(el, { state: 'downloading', version: '1.8.0-bcb.3', pct: 47.6 });
    expect(el.textContent).toBe('Downloading update 1.8.0-bcb.3 — 48%');
    expect(el.style.getPropertyValue('--pmd-update-pct')).toBe('48%');
    expect(el.title).toContain('48%');
    // The percent lives in its own fixed-width span so the pill's overall
    // width doesn't jitter as the digit count changes (0% → 100%).
    const pctEl = el.querySelector('.pmd-update-chip-pct');
    expect(pctEl?.textContent).toBe('48%');

    // Clamped to [0, 100] — a stray out-of-range tick shouldn't overflow the bar.
    renderUpdateChip(el, { state: 'downloading', version: '1.8.0-bcb.3', pct: 137 });
    expect(el.textContent).toContain('100%');

    // Advancing past downloading clears the data-state/fill property.
    renderUpdateChip(el, { state: 'ready', version: '1.8.0-bcb.3' });
    expect(el.getAttribute('data-state')).toBeNull();
    expect(el.style.getPropertyValue('--pmd-update-pct')).toBe('');
    expect(el.textContent).toBe('Update 1.8.0-bcb.3 ready — restart to install');
  });

  it('pulls the initial state at boot (late-opened window case)', async () => {
    const el = makeEl();
    initUpdateChip(el, makeHost({ state: 'ready', version: '1.2.3' }));
    await tick();
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain('1.2.3');
  });

  it('tracks pushed state changes', async () => {
    const el = makeEl();
    const host = makeHost(null);
    initUpdateChip(el, host);
    await tick();
    expect(el.hidden).toBe(true);
    host.push({ state: 'ready', version: '2.0.0' });
    expect(el.hidden).toBe(false);
    host.push(null);
    expect(el.hidden).toBe(true);
  });

  it('click forwards to the host action', async () => {
    const el = makeEl();
    const host = makeHost({ state: 'ready', version: '1.0.0' });
    initUpdateChip(el, host);
    await tick();
    el.click();
    expect(host.actions).toBe(1);
  });

  it('renders plugin updates (fork)', () => {
    const el = makeEl();
    renderUpdateChip(el, { state: 'plugins', plugins: [{ name: 'Ebb', version: '0.3.0' }] });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('Plugin update: Ebb 0.3.0');
    renderUpdateChip(el, {
      state: 'plugins',
      plugins: [
        { name: 'Ebb', version: '0.3.0' },
        { name: 'Flow', version: '2.0.0' },
      ],
    });
    expect(el.textContent).toBe('2 plugin updates available');
    expect(el.title).toBe('Update Ebb to 0.3.0, Flow to 2.0.0');
    renderUpdateChip(el, { state: 'plugins-updating', count: 2 });
    expect(el.textContent).toBe('Updating plugins…');
    renderUpdateChip(el, { state: 'plugins-ready', count: 1 });
    expect(el.textContent).toBe('Plugin updated — restart to apply');
  });
});

describe('update chip dismiss ×', () => {
  it('hides the chip on ×, says where updates still live, and leaves the text alone', async () => {
    const { initUpdateChip, DISMISS_NOTE } = await import('../../src/editor/update-chip.js');
    const toast = await import('../../src/editor/toast.js');
    const spy = vi.spyOn(toast, 'showToast').mockImplementation(() => {});
    let push: ((s: import('../../src/editor/update-chip.js').UpdateChipState | null) => void) | null = null;
    const action = vi.fn(() => Promise.resolve());
    const el = document.createElement('button');
    initUpdateChip(el, {
      getUpdateChipState: () => Promise.resolve(null),
      updateChipAction: action,
      onUpdateChip: (h) => {
        push = h;
        return () => {};
      },
    });
    push!({ state: 'available', version: '9.9.9' });
    expect(el.textContent).toBe('Update 9.9.9 available');
    const x = el.querySelector<HTMLElement>('.pmd-update-chip-x')!;
    expect(x).not.toBeNull();
    x.click();
    expect(el.hidden).toBe(true);
    expect(action).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(DISMISS_NOTE);
    // Same state stays hidden; a newer state shows again.
    push!({ state: 'available', version: '9.9.9' });
    expect(el.hidden).toBe(true);
    push!({ state: 'ready', version: '9.9.9' });
    expect(el.hidden).toBe(false);
    spy.mockRestore();
  });
});

describe('bringing a dismissed chip back', () => {
  it('a manual check (reveal) un-hides it in every chip, whether pushed or from the host event', async () => {
    const { vi } = await import('vitest');
    const { initUpdateChip, revealDismissedUpdateChips } = await import('../../src/editor/update-chip.js');
    const toast = await import('../../src/editor/toast.js');
    const spy = vi.spyOn(toast, 'showToast').mockImplementation(() => {});
    let push: ((s: UpdateChipState | null) => void) | null = null;
    let reveal: (() => void) | null = null;
    const mk = (): HTMLButtonElement => document.createElement('button');
    const a = mk();
    const b = mk();
    const state: UpdateChipState = { state: 'ready', version: '8.8.8' };
    initUpdateChip(a, {
      getUpdateChipState: () => Promise.resolve(null),
      updateChipAction: () => Promise.resolve(),
      onUpdateChip: (h) => {
        push = h;
        return () => {};
      },
      onUpdateChipReveal: (h) => {
        reveal = h;
        return () => {};
      },
    });
    initUpdateChip(b, {
      getUpdateChipState: () => Promise.resolve(null),
      updateChipAction: () => Promise.resolve(),
      onUpdateChip: () => () => {},
    });
    push!(state);
    a.querySelector<HTMLElement>('.pmd-update-chip-x')!.click();
    expect(a.hidden).toBe(true);
    // The same state arriving again stays hidden (that is the point of ×)...
    push!(state);
    expect(a.hidden).toBe(true);
    // ...but the Help-menu check reveals it.
    reveal!();
    expect(a.hidden).toBe(false);
    expect(a.textContent).toContain('Update 8.8.8 ready');
    // Settings → Check for updates calls the exported function directly.
    a.querySelector<HTMLElement>('.pmd-update-chip-x')!.click();
    expect(a.hidden).toBe(true);
    revealDismissedUpdateChips();
    expect(a.hidden).toBe(false);
    spy.mockRestore();
  });
});
