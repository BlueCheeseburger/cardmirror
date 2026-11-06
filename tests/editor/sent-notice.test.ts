// @vitest-environment jsdom
/**
 * The "Sent to speech doc" notice: bottom of the window, an Undo button while the
 * send can be taken back, one slot so a newer send replaces an older one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showSentNotice, undoResultMessage, type SentUndoResult } from '../../src/editor/sent-notice.js';

afterEach(() => {
  document.body.innerHTML = '';
});

const toasts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pmd-toast')];
const undoButton = (): HTMLButtonElement | null => document.querySelector('.pmd-toast-action-btn');
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('showSentNotice', () => {
  it('sits at the bottom and says what was sent, and where in the speech doc', () => {
    showSentNotice('Warming causes extinction', false, async () => 'undone');
    const t = toasts()[0]!;
    expect(t.classList.contains('pmd-toast-action')).toBe(true);
    expect(t.querySelector('.pmd-icon-mic')).not.toBeNull();
    expect(t.querySelector('.pmd-toast-main')?.textContent).toBe('Sent to speech doc');
    expect(t.querySelector('.pmd-toast-detail')?.textContent).toBe('“Warming causes extinction”');
    expect(t.querySelector('.pmd-toast-pill')?.textContent).toBe('at cursor');
  });

  it('says "at end" for a send to the end', () => {
    showSentNotice('Tag', true, async () => 'undone');
    expect(document.querySelector('.pmd-toast-pill')?.textContent).toBe('at end');
  });

  it('offers Undo when the send can be taken back', () => {
    showSentNotice('Tag', false, async () => 'undone');
    expect(undoButton()?.textContent).toBe('Undo');
  });

  it('offers no button, and ignores the pointer, when it can not be taken back', () => {
    showSentNotice('Tag', false, null);
    expect(undoButton()).toBeNull();
    expect(toasts()[0]!.classList.contains('pmd-toast-passive')).toBe(true);
  });

  it('leaves the detail out for a slice with no text', () => {
    showSentNotice(null, false, null);
    expect(document.querySelector('.pmd-toast-detail')).toBeNull();
  });

  it('a newer send replaces the older notice at once', () => {
    showSentNotice('First', false, async () => 'undone');
    showSentNotice('Second', true, async () => 'undone');
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.querySelector('.pmd-toast-detail')?.textContent).toBe('“Second”');
  });

  it('Undo runs the undo, and a notice in the same place says it was removed', async () => {
    const undo = vi.fn(async (): Promise<SentUndoResult> => 'undone');
    showSentNotice('Warming causes extinction', false, undo);
    undoButton()!.click();
    await settle();
    expect(undo).toHaveBeenCalledTimes(1);
    const t = toasts().find((x) => x.textContent?.includes('Removed'))!;
    expect(t.textContent).toBe('Removed “Warming causes extinction” from the speech doc.');
    expect(t.classList.contains('pmd-toast-action')).toBe(true);
  });

  it('says so when the speech doc has moved on', async () => {
    showSentNotice('Tag', false, async () => 'refused');
    undoButton()!.click();
    await settle();
    expect(toasts().some((t) => t.textContent === "Can't undo this send from here. Use Undo in the speech doc.")).toBe(true);
  });

  it('says so when the speech doc is gone, including when asking it failed', async () => {
    showSentNotice('Tag', false, async () => {
      throw new Error('ipc died');
    });
    undoButton()!.click();
    await settle();
    expect(toasts().some((t) => t.textContent === "The speech doc isn't open any more.")).toBe(true);
  });

  it('pressing Undo twice undoes once', async () => {
    const undo = vi.fn(async (): Promise<SentUndoResult> => 'undone');
    showSentNotice('Tag', false, undo);
    const b = undoButton()!;
    b.click();
    b.click();
    await settle();
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

describe('undoResultMessage', () => {
  it('names what was removed, or says "it" when nothing was named', () => {
    expect(undoResultMessage('undone', 'A tag')).toBe('Removed “A tag” from the speech doc.');
    expect(undoResultMessage('undone', null)).toBe('Removed it from the speech doc.');
  });
});
