// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/editor/toast.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/editor/toast.js')>('../../src/editor/toast.js');
  return { ...actual, showToast: vi.fn() };
});

import { showAlsoInCompareNotice } from '../../src/editor/compare-also-open-notice.js';
import { showToast } from '../../src/editor/toast.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

const toastEl = (): HTMLElement | null => document.querySelector('.pmd-toast-action');

describe('showAlsoInCompareNotice', () => {
  it('names the file and offers Go to Compare', () => {
    showAlsoInCompareNotice('/Users/me/Round 3/2NC.docx', 5, async () => true, () => {});
    expect(toastEl()?.textContent).toContain('“2NC.docx” is also open in Compare documents in another window.');
    expect(toastEl()?.querySelector('button')?.textContent).toBe('Go to Compare');
  });
  it('reads the name from a Windows path too', () => {
    showAlsoInCompareNotice('C:\\debate\\1NC.docx', 5, async () => true, () => {});
    expect(toastEl()?.textContent).toContain('“1NC.docx”');
  });
  it('the button focuses the Compare window', async () => {
    const focus = vi.fn(async () => true);
    showAlsoInCompareNotice('/a/b.docx', 5, focus, () => {});
    toastEl()!.querySelector('button')!.click();
    expect(focus).toHaveBeenCalledWith(5);
  });
  it('says so when that window has since closed', async () => {
    const closed = vi.fn();
    showAlsoInCompareNotice('/a/b.docx', 5, async () => false, closed);
    toastEl()!.querySelector('button')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toHaveBeenCalledWith('That Compare window has closed.');
  });
  it('falls back to a plain notice when the host cannot focus a window', () => {
    showAlsoInCompareNotice('/a/b.docx', 5, undefined, () => {});
    expect(toastEl()).toBeNull();
    expect(showToast).toHaveBeenCalledWith('“b.docx” is also open in Compare documents in another window.');
  });
});
