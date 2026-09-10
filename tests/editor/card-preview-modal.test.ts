// @vitest-environment jsdom
/**
 * Card preview (field request 2026-09-09): a Dropzone or Receive row's
 * Preview button opens the cards full-size, read-only, with the nav pane,
 * and offers Copy to clipboard / Close — without inserting anything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Slice, Fragment } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';

const writeClipboardHtml = vi.fn(async (_html: string, _text: string) => true);
vi.mock('../../src/editor/clipboard-write.js', () => ({
  writeClipboardHtml: (html: string, text: string) => writeClipboardHtml(html, text),
  CLIPBOARD_BUSY_MESSAGE: 'busy',
}));
const toasts: string[] = [];
vi.mock('../../src/editor/toast.js', () => ({
  showToast: (msg: string) => {
    toasts.push(msg);
  },
}));

import { openCardPreview, docFromSliceJson, copiedLabel, previewReadModeOn, setPreviewReadMode } from '../../src/editor/card-preview-modal.js';
import { isAnyOverlayOpen } from '../../src/editor/overlay-stack.js';
import { DropzoneController } from '../../src/editor/dropzone-ui.js';
import { dropzoneStore } from '../../src/editor/dropzone-store.js';
import { ReceivePillController, previewMostRecentReceived, NOTHING_RECEIVED_MESSAGE } from '../../src/editor/pairing/receive-pill-ui.js';
import { inboxStore } from '../../src/editor/pairing/inbox-store.js';
import { settings } from '../../src/editor/settings.js';

function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
const sliceJson = (...nodes: PMNode[]): unknown => new Slice(Fragment.fromArray(nodes), 0, 0).toJSON();
const dialog = (): HTMLElement | null => document.querySelector('.pmd-card-preview-dialog');
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  toasts.length = 0;
  writeClipboardHtml.mockClear();
  writeClipboardHtml.mockImplementation(async () => true);
});
afterEach(() => {
  document.querySelector<HTMLButtonElement>('.pmd-card-preview-close')?.click();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('docFromSliceJson', () => {
  it('fits a stored slice into a document', () => {
    const doc = docFromSliceJson(sliceJson(card('Alpha tag', 'alpha body'), card('Beta tag', 'beta body')));
    expect(doc.childCount).toBe(2);
    expect(doc.textContent).toContain('alpha body');
    expect(() => doc.check()).not.toThrow();
  });
  it('closes an open-edged slice (a copy that started mid-card)', () => {
    const c = card('Alpha tag', 'alpha body');
    const open = new Slice(Fragment.fromArray([c]), 1, 0).toJSON(); // tag cut open on the left
    const doc = docFromSliceJson(open);
    expect(() => doc.check()).not.toThrow();
    expect(doc.textContent).toContain('alpha body');
  });
  it('copiedLabel counts cards', () => {
    expect(copiedLabel(0)).toBe('Copied to the clipboard');
    expect(copiedLabel(1)).toBe('Copied 1 card to the clipboard');
    expect(copiedLabel(3)).toBe('Copied 3 cards to the clipboard');
  });
});

describe('openCardPreview', () => {
  it('shows the cards read-only with the nav pane, and Close removes everything', () => {
    expect(openCardPreview({ title: 'Alpha tag', sliceJson: sliceJson(card('Alpha tag', 'alpha body'), card('Beta tag', 'beta body')) })).toBe(true);
    const d = dialog()!;
    expect(d).toBeTruthy();
    expect(isAnyOverlayOpen()).toBe(true);
    expect(d.querySelector('.pmd-bulk-header h2')!.textContent).toBe('Alpha tag');
    const pm = d.querySelector('.ProseMirror') as HTMLElement;
    expect(pm.textContent).toContain('alpha body');
    expect(pm.textContent).toContain('beta body');
    expect(pm.getAttribute('contenteditable')).toBe('false');
    expect(d.querySelector('.pmd-nav-panel'), 'the real nav pane is mounted beside the cards').toBeTruthy();
    expect(d.querySelector('.pmd-nav-panel')!.textContent).toContain('Beta tag');
    (d.querySelector('.pmd-card-preview-close') as HTMLButtonElement).click();
    expect(dialog()).toBeNull();
    expect(isAnyOverlayOpen()).toBe(false);
  });

  it('the stylesheet lets the title truncate and never the sender · time line', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/editor/style.css'), 'utf8');
    const rule = (sel: string): string => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    expect(rule('.pmd-card-preview-title')).toMatch(/flex: 1 1 auto/);
    expect(rule('.pmd-card-preview-title')).toMatch(/text-overflow: ellipsis/);
    expect(rule('.pmd-card-preview-subtitle')).toMatch(/flex: 0 0 auto/);
    expect(rule('.pmd-card-preview-subtitle')).toMatch(/white-space: nowrap/);
    expect(rule('.pmd-card-preview-subtitle')).not.toMatch(/overflow: hidden/);
  });

  it('shows the subtitle (sender · time) when given', () => {
    openCardPreview({ title: 'Alpha tag', subtitle: 'Cora · 2 min ago', sliceJson: sliceJson(card('Alpha tag', 'alpha body')) });
    expect(dialog()!.querySelector('.pmd-card-preview-subtitle')!.textContent).toBe('Cora · 2 min ago');
  });

  it('Copy to clipboard writes the cards as HTML + text, toasts the count, and closes', async () => {
    openCardPreview({ title: 'Alpha tag', sliceJson: sliceJson(card('Alpha tag', 'alpha body'), card('Beta tag', 'beta body')) });
    (dialog()!.querySelector('.pmd-card-preview-copy') as HTMLButtonElement).click();
    await flush();
    expect(writeClipboardHtml).toHaveBeenCalledTimes(1);
    const [html, text] = writeClipboardHtml.mock.calls[0]! as [string, string];
    expect(html).toContain('alpha body');
    expect(html).toContain('Beta tag');
    expect(text).toContain('alpha body');
    expect(toasts).toEqual(['Copied 2 cards to the clipboard']);
    expect(dialog()).toBeNull();
    expect(isAnyOverlayOpen()).toBe(false);
  });

  it('a busy clipboard toasts and keeps the preview open', async () => {
    writeClipboardHtml.mockImplementation(async () => false);
    openCardPreview({ title: 'Alpha tag', sliceJson: sliceJson(card('Alpha tag', 'alpha body')) });
    const copy = dialog()!.querySelector('.pmd-card-preview-copy') as HTMLButtonElement;
    copy.click();
    await flush();
    expect(toasts).toEqual(['busy']);
    expect(dialog()).not.toBeNull();
    expect(copy.disabled).toBe(false); // can retry
  });

  it('Escape closes it and does not reach the document', () => {
    openCardPreview({ title: 'Alpha tag', sliceJson: sliceJson(card('Alpha tag', 'alpha body')) });
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(isAnyOverlayOpen()).toBe(false);
  });

  it('a payload that cannot be rebuilt toasts instead of opening', () => {
    expect(openCardPreview({ title: 'Broken', sliceJson: { content: [{ type: 'card', content: [] }] } })).toBe(false);
    expect(dialog()).toBeNull();
    expect(toasts.length).toBe(1);
    expect(isAnyOverlayOpen()).toBe(false);
  });
});

describe('the Preview button on the rows', () => {
  it('a Dropzone shelf row opens the preview and the click never starts a drag-out', async () => {
    vi.spyOn(dropzoneStore, 'init').mockResolvedValue();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const dz = new DropzoneController();
    dz.mount({ parent, getFocusedView: () => null });
    const store = dropzoneStore as unknown as { items: unknown[]; fire: () => void };
    store.items = [{ id: 'i1', label: 'Alpha tag', type: 'card', sliceJson: sliceJson(card('Alpha tag', 'alpha body')), createdAt: Date.now() }];
    store.fire();
    const btn = parent.querySelector('.pmd-dropzone-row .pmd-row-preview') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Preview');
    (parent.querySelector('.pmd-dropzone-bar') as HTMLElement).click(); // open the shelf
    const root = parent.querySelector('.pmd-dropzone-root') as HTMLElement;
    expect(root.dataset['open']).toBe('true');
    btn.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }));
    btn.click();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('.ProseMirror')!.textContent).toContain('alpha body');
    // Clicking inside the preview (its Close button, say) is a pointerdown
    // outside the shelf — it must not collapse the list being browsed.
    document.querySelector('.pmd-card-preview-close')!.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    expect(root.dataset['open']).toBe('true');
    (document.querySelector('.pmd-card-preview-close') as HTMLButtonElement).click();
    expect(dialog()).toBeNull();
    // With the preview gone, an outside pointerdown closes the shelf as before.
    document.body.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    expect(root.dataset['open']).toBe('false');
    store.items = [];
    store.fire();
  });

  it('a Receive row opens the preview with the sender line as its subtitle', async () => {
    settings.set('pairingEnabled', true);
    try {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const pill = new ReceivePillController();
      pill.mount({ parent, getFocusedView: () => null });
      await flush(); // the store's init (local storage here) has loaded its empty list
      const store = inboxStore as unknown as { items: unknown[]; fire: () => void };
      store.items = [{ id: 'r1', label: 'Beta tag', type: 'card', sliceJson: sliceJson(card('Beta tag', 'beta body')), senderName: 'Cora', senderCode: 'AB12', receivedAt: Date.now(), read: true }];
      store.fire();
      (parent.querySelector('.pmd-receive-bar') as HTMLElement).click();
      const btn = parent.querySelector('.pmd-receive-row .pmd-row-preview') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      btn.click();
      expect(dialog()).not.toBeNull();
      expect(dialog()!.querySelector('.pmd-bulk-header h2')!.textContent).toBe('Beta tag');
      expect(dialog()!.querySelector('.pmd-card-preview-subtitle')!.textContent).toContain('Cora');
      expect(dialog()!.querySelector('.ProseMirror')!.textContent).toContain('beta body');
      store.items = [];
    } finally {
      settings.set('pairingEnabled', false);
    }
  });
});

describe('read mode in the preview', () => {
  afterEach(() => setPreviewReadMode(false));
  const host = (): HTMLElement => dialog()!.querySelector<HTMLElement>('.pmd-recover-preview-editor')!;
  const readBtn = (): HTMLButtonElement => dialog()!.querySelector<HTMLButtonElement>('.pmd-card-preview-readmode')!;
  const closePreview = (): void => document.querySelector<HTMLButtonElement>('.pmd-card-preview-close')!.click();

  it('is off by default, flips the pane into read mode, and stays on for the next preview until turned off', () => {
    openCardPreview({ title: 'One', sliceJson: sliceJson(card('Tag', 'body')) });
    expect(host().classList.contains('pmd-read-mode')).toBe(false);
    expect(readBtn().getAttribute('aria-pressed')).toBe('false');
    readBtn().click();
    expect(host().classList.contains('pmd-read-mode')).toBe(true);
    expect(readBtn().getAttribute('aria-pressed')).toBe('true');
    expect(previewReadModeOn()).toBe(true);
    closePreview();

    openCardPreview({ title: 'Two', sliceJson: sliceJson(card('Tag', 'body')) });
    expect(host().classList.contains('pmd-read-mode'), 'a later preview opens in read mode').toBe(true);
    readBtn().click();
    expect(previewReadModeOn()).toBe(false);
    closePreview();

    openCardPreview({ title: 'Three', sliceJson: sliceJson(card('Tag', 'body')) });
    expect(host().classList.contains('pmd-read-mode'), 'turned off: back to the full view').toBe(false);
  });
});

describe('previewMostRecentReceived (the Preview Received Card command)', () => {
  const store = inboxStore as unknown as { items: unknown[] };
  afterEach(() => {
    store.items = [];
  });

  it('toasts when nothing has been received and opens nothing', () => {
    store.items = [];
    expect(previewMostRecentReceived()).toBe(false);
    expect(toasts).toContain(NOTHING_RECEIVED_MESSAGE);
    expect(dialog()).toBeNull();
  });

  it('opens the newest received card in the preview, with the sender in the subtitle', () => {
    const item = (id: string, tag: string, when: number) => ({
      id, label: tag, type: 'card', sliceJson: sliceJson(card(tag, `${tag} body`)), senderName: 'Cora', senderCode: 'AB12', receivedAt: when, read: true,
    });
    store.items = [item('r1', 'Older tag', Date.now() - 60_000), item('r2', 'Newer tag', Date.now())]; // newest last
    expect(previewMostRecentReceived()).toBe(true);
    expect(dialog()!.querySelector('.pmd-bulk-header h2')!.textContent).toBe('Newer tag');
    expect(dialog()!.querySelector('.pmd-card-preview-subtitle')!.textContent).toContain('Cora');
    expect(dialog()!.querySelector('.ProseMirror')!.textContent).toContain('Newer tag body');
  });
});
