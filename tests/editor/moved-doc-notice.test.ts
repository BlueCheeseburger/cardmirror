// @vitest-environment jsdom

/**
 * The notice a window shows when a document is moved into it: the move
 * brings this window to the front, so it says where the document came from
 * and offers a way back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { showMovedDocNotice } from '../../src/editor/moved-doc-notice.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const notice = (): HTMLElement | null => document.querySelector('.pmd-toast-action');
const button = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.pmd-toast-action-btn')!;

describe('showMovedDocNotice', () => {
  it('names the document and the window it came from, with a Go back button', () => {
    showMovedDocNotice('Case.cmir', { id: 4, label: 'Round 3' }, async () => true, () => {});
    expect(notice()?.textContent).toContain('Moved “Case.cmir” here from Round 3.');
    expect(button().textContent).toBe('Go back');
  });

  it('brings the source window to the front and closes itself when pressed', async () => {
    const focus = vi.fn(async () => true);
    showMovedDocNotice('Case.cmir', { id: 4, label: 'Round 3' }, focus, () => {});
    button().click();
    expect(focus).toHaveBeenCalledWith(4);
    expect(notice()?.classList.contains('pmd-toast-fade')).toBe(true);
  });

  it('says so when the source window has since closed', async () => {
    const said = vi.fn();
    showMovedDocNotice('Case.cmir', { id: 4, label: 'Round 3' }, async () => false, said);
    button().click();
    await Promise.resolve();
    await Promise.resolve();
    expect(said).toHaveBeenCalledWith('Round 3 has closed.');
  });

  it('shows nothing when the source is unknown or the host cannot focus a window', () => {
    expect(showMovedDocNotice('A.cmir', null, async () => true, () => {})).toBeNull();
    expect(showMovedDocNotice('A.cmir', { id: 1, label: 'x' }, undefined, () => {})).toBeNull();
    expect(notice()).toBeNull();
  });

  it('goes away on its own after a while', () => {
    vi.useFakeTimers();
    showMovedDocNotice('A.cmir', { id: 1, label: 'x' }, async () => true, () => {});
    vi.advanceTimersByTime(8000);
    vi.advanceTimersByTime(250);
    expect(notice()).toBeNull();
  });
});
