// @vitest-environment jsdom

/**
 * Printing (`src/editor/print-doc.ts`).
 *
 * jsdom can't paginate, so the `@media print` rules in style.css are checked
 * by hand (Chromium's PDF output). What's tested here is the contract around
 * them: the print copy is built from the live editor DOM, stripped of editing
 * state, present while the print call runs, and gone (theme restored) after.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import {
  buildPrintContent,
  cleanup,
  installPrintListeners,
  isPrintContentEmpty,
  printDocument,
} from '../../src/editor/print-doc.js';
import { DEFAULT_RIBBON_KEYS } from '../../src/editor/ribbon-commands.js';

/** A stand-in view: `.pmd-pane-editor > .ProseMirror` with the given inner HTML. */
function fakeView(inner: string, hostClass = 'pmd-pane-editor'): { view: EditorView; host: HTMLElement } {
  const host = document.createElement('div');
  host.className = hostClass;
  const pm = document.createElement('div');
  pm.className = 'ProseMirror ProseMirror-focused';
  pm.setAttribute('contenteditable', 'true');
  pm.id = 'live-editor';
  pm.innerHTML = inner;
  host.appendChild(pm);
  document.body.appendChild(host);
  return { view: { dom: pm } as unknown as EditorView, host };
}

const CARD = '<div class="pmd-card"><p class="pmd-tag" id="t1">Tag</p><p>Body words</p></div>';

beforeEach(() => {
  (window as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame = (cb) => {
    cb(0);
    return 0;
  };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-doc');
  vi.restoreAllMocks();
});

describe('buildPrintContent', () => {
  it('copies the rendered content without editing state or duplicate ids', () => {
    const { view } = fakeView(CARD);
    const wrap = buildPrintContent(view);
    const pm = wrap.querySelector('.ProseMirror') as HTMLElement;
    expect(pm.textContent).toContain('Body words');
    expect(pm.hasAttribute('contenteditable')).toBe(false);
    expect(pm.classList.contains('ProseMirror-focused')).toBe(false);
    expect(wrap.querySelector('[id]')).toBeNull();
    // The live editor is untouched.
    expect(view.dom.getAttribute('contenteditable')).toBe('true');
    expect(view.dom.id).toBe('live-editor');
  });

  it('drops cursor widgets and trailing breaks', () => {
    const { view } = fakeView(`${CARD}<img class="ProseMirror-separator"><br class="ProseMirror-trailingBreak">`);
    const wrap = buildPrintContent(view);
    expect(wrap.querySelector('.ProseMirror-separator, .ProseMirror-trailingBreak')).toBeNull();
  });

  it('carries read mode so hidden text stays hidden, and nothing else from the host', () => {
    const { view } = fakeView(CARD, 'pmd-pane-editor pmd-read-mode pmd-reader-overlay-host');
    const wrap = buildPrintContent(view);
    expect(wrap.classList.contains('pmd-read-mode')).toBe(true);
    expect(wrap.classList.contains('pmd-pane-editor')).toBe(true);
    expect(wrap.classList.contains('pmd-reader-overlay-host')).toBe(false);
  });
});

describe('isPrintContentEmpty', () => {
  it('is true for a blank document and for read mode with everything hidden', () => {
    expect(isPrintContentEmpty(buildPrintContent(fakeView('<p> </p>').view))).toBe(true);
    const hidden = fakeView('<p><span class="pmd-rm-hide">unhighlighted</span></p>', 'pmd-pane-editor pmd-read-mode');
    expect(isPrintContentEmpty(buildPrintContent(hidden.view))).toBe(true);
  });

  it('is false when there is text, a table or an image', () => {
    expect(isPrintContentEmpty(buildPrintContent(fakeView(CARD).view))).toBe(false);
    expect(isPrintContentEmpty(buildPrintContent(fakeView('<table><tr><td></td></tr></table>').view))).toBe(false);
    expect(isPrintContentEmpty(buildPrintContent(fakeView('<img src="x.png">').view))).toBe(false);
  });
});

describe('printDocument', () => {
  it('shows the print copy while printing, then removes it', async () => {
    const { view } = fakeView(CARD);
    let seen: { root: boolean; printing: boolean } | null = null;
    vi.spyOn(window, 'print').mockImplementation(() => {
      seen = {
        root: document.getElementById('pmd-print-root') !== null,
        printing: document.documentElement.classList.contains('pmd-printing'),
      };
    });
    expect(await printDocument(view)).toBe('printed');
    expect(seen).toEqual({ root: true, printing: true });
    expect(document.getElementById('pmd-print-root')).toBeNull();
    expect(document.documentElement.classList.contains('pmd-printing')).toBe(false);
  });

  it('prints on the light palette and restores the theme afterwards', async () => {
    const { view } = fakeView(CARD);
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-theme-doc', 'dark');
    let during: [string | null, string | null] = ['unset', 'unset'];
    vi.spyOn(window, 'print').mockImplementation(() => {
      during = [
        document.documentElement.getAttribute('data-theme'),
        document.documentElement.getAttribute('data-theme-doc'),
      ];
    });
    await printDocument(view);
    expect(during).toEqual([null, null]);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme-doc')).toBe('dark');
  });

  it('uses the native print call when given one, not window.print', async () => {
    const { view } = fakeView(CARD);
    const webPrint = vi.spyOn(window, 'print').mockImplementation(() => {});
    const nativePrint = vi.fn(async () => {
      expect(document.getElementById('pmd-print-root')).not.toBeNull();
      return true;
    });
    expect(await printDocument(view, { nativePrint })).toBe('printed');
    expect(nativePrint).toHaveBeenCalledOnce();
    expect(webPrint).not.toHaveBeenCalled();
    expect(document.getElementById('pmd-print-root')).toBeNull();
  });

  it('opens no dialog for an empty document', async () => {
    const { view } = fakeView('<p></p>');
    const webPrint = vi.spyOn(window, 'print').mockImplementation(() => {});
    expect(await printDocument(view)).toBe('empty');
    expect(webPrint).not.toHaveBeenCalled();
    expect(document.getElementById('pmd-print-root')).toBeNull();
    expect(document.documentElement.classList.contains('pmd-printing')).toBe(false);
  });

  it('cleans up even when the print call throws', async () => {
    const { view } = fakeView(CARD);
    document.documentElement.setAttribute('data-theme', 'dark');
    vi.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('no printer');
    });
    await expect(printDocument(view)).rejects.toThrow('no printer');
    expect(document.getElementById('pmd-print-root')).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('replaces a stale copy instead of stacking two', async () => {
    const { view } = fakeView(CARD);
    window.dispatchEvent(new Event('beforeprint')); // no listener yet: no-op
    vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.querySelectorAll('#pmd-print-root')).toHaveLength(1);
    });
    await printDocument(view);
    await printDocument(view);
  });
});

describe('browser File → Print', () => {
  it('builds the copy on beforeprint and removes it on afterprint', () => {
    const { view } = fakeView(CARD);
    installPrintListeners(() => view);
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.getElementById('pmd-print-root')?.textContent).toContain('Body words');
    expect(document.documentElement.classList.contains('pmd-printing')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('pmd-print-root')).toBeNull();
    expect(document.documentElement.classList.contains('pmd-printing')).toBe(false);
  });
});

describe('keybinding', () => {
  it('Print is Mod-Shift-p, and no other command shares it (Mod-p is Insert Received Card)', () => {
    expect(DEFAULT_RIBBON_KEYS.printDocument).toBe('Mod-Shift-p');
    const taken = Object.entries(DEFAULT_RIBBON_KEYS).filter(([, k]) =>
      (Array.isArray(k) ? k : [k]).some((key) => key.toLowerCase() === 'mod-shift-p'),
    );
    expect(taken.map(([id]) => id)).toEqual(['printDocument']);
  });
});
