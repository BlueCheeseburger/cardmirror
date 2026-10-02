// @vitest-environment jsdom
/**
 * Palette result paging over a large file corpus (perf batch,
 * 2026-07-27): file matches are ranked in full but materialized and
 * rendered 50 at a time — the per-keystroke DOM rebuild and result-
 * object churn must stay bounded no matter how big the search folders
 * are. Drives the real singleton with a mocked Electron host.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostState = vi.hoisted(() => ({
  files: [] as Array<{ path: string; relPath: string; mtimeMs: number; size: number }>,
}));

vi.mock('../../src/editor/host/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/host/index.js')>();
  return {
    ...mod,
    // Only the Electron host is faked (file listing); everything else —
    // notably getHost(), which ribbon-commands reads at import — stays real.
    getElectronHost: () => ({
      readFileAtPath: async () => null,
    }),
  };
});

// The palette talks to the file-index service via this client — the
// fake runs the REAL matcher over hostState.files (see _fake-file-index).
vi.mock('../../src/editor/file-search-client.js', async () => {
  const { makeFakeFileIndexClient } = await import('./_fake-file-index.js');
  return {
    getFileIndexClient: async () => makeFakeFileIndexClient(hostState),
    setFileIndexClientForTests: () => {},
  };
});

import { quickCardSearchUI } from '../../src/editor/quick-card-search-ui.js';
import { settings } from '../../src/editor/settings.js';

function openPalette(): void {
  quickCardSearchUI.open({
    view: null,
   
    runCommand: () => {},
    openFilePath: () => {},
  });
}

function type(q: string): void {
  const input = document.querySelector<HTMLInputElement>('.pmd-qcs-input')!;
  input.value = q;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const rowCount = (): number => document.querySelectorAll('.pmd-qcs-row').length;
const moreEl = (): HTMLElement | null => document.querySelector('.pmd-qcs-more');

/** Let the open-time listCmirFiles round-trip + re-search settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  hostState.files = Array.from({ length: 120 }, (_, i) => ({
    path: `/root/Warming ${i}.cmir`,
    relPath: `Neg/Warming ${i}.cmir`,
    mtimeMs: i,
    size: 1,
  }));
  settings.set('fileSearchRoots', ['/root']);
});

afterEach(() => {
  if (quickCardSearchUI.isOpen()) quickCardSearchUI.close();
  document.body.innerHTML = '';
});

describe('palette file paging', () => {
  it('file browse renders 50 rows per page with an accurate overflow count', async () => {
    openPalette();
    await settle(); // open() kicks the file-list load immediately
    type('f '); // file prefix, empty query = browse everything
    await settle(); // ranked rows arrive async from the (fake) service
    expect(rowCount()).toBe(50);
    expect(moreEl()?.textContent).toContain('Showing 50 of 120');

    const firstRowText = document.querySelector('.pmd-qcs-row')?.textContent;
    moreEl()!.click();
    await settle(); // show-more refetches a bigger window from the service
    expect(rowCount()).toBe(100);
    // Earlier rows keep their identity/order as the window grows.
    expect(document.querySelector('.pmd-qcs-row')?.textContent).toBe(firstRowText);

    moreEl()!.click();
    await settle();
    expect(rowCount()).toBe(120);
    expect(moreEl()).toBeNull(); // everything shown — no overflow row
  });

  it('everything search folds file matches in behind other sources, same paging', async () => {
    openPalette();
    await settle();
    type('warming'); // no prefix — matches all 120 files by name
    await settle();
    expect(rowCount()).toBe(50);
    const more = moreEl();
    expect(more?.textContent).toMatch(/Showing 50 of \d+ — show more/);
  });

  it('clicks in the results list never steal keyboard focus (mousedown prevented)', async () => {
    // Chromium makes scrollable containers click-focusable: without the
    // mousedown preventDefault, a right-click (expand/collapse) moved
    // focus to the scroller and arrows scrolled instead of selecting.
    openPalette();
    await settle();
    type('f ');
    await settle();
    const row = document.querySelector('.pmd-qcs-row')!;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 });
    row.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('the first keystroke gets file rows within one service round-trip', async () => {
    openPalette();
    await settle(); // the service connection is warmed at open
    type('warming 7'); // first "keystroke"
    await settle(); // one query round-trip — no full-corpus transfer anywhere
    expect(rowCount()).toBeGreaterThan(0);
    expect(
      [...document.querySelectorAll('.pmd-qcs-row-name')].some(
        (el) => el.textContent === 'Warming 7',
      ),
    ).toBe(true);
  });
});
