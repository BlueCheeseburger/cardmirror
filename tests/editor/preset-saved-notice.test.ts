// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/editor/toast.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/editor/toast.js')>('../../src/editor/toast.js');
  return { ...actual, showToast: vi.fn() };
});

import { presetSavedMessage, showPresetSavedNotice, showExportUndoNotice } from '../../src/editor/preset-saved-notice.js';
import { showToast } from '../../src/editor/toast.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

const toastEl = (): HTMLElement | null => document.querySelector('.pmd-toast-action');

describe('presetSavedMessage', () => {
  it('names the preset, the file and the folder it landed in', () => {
    expect(presetSavedMessage('Send doc', 'SEND_1AC.docx', '/Users/me/Round 3/SEND_1AC.docx')).toBe(
      'Send doc saved: SEND_1AC.docx in Round 3',
    );
  });
  it('reads a Windows path', () => {
    expect(presetSavedMessage('Marked doc', 'MARKED_2NC.docx', 'C:\\debate\\Round 4\\MARKED_2NC.docx')).toBe(
      'Marked doc saved: MARKED_2NC.docx in Round 4',
    );
  });
  it('leaves the folder out when the host gave no path', () => {
    expect(presetSavedMessage('Starred doc', 'STARRED_x.docx', undefined)).toBe('Starred doc saved: STARRED_x.docx');
    expect(presetSavedMessage('Starred doc', 'STARRED_x.docx', 'x.docx')).toBe('Starred doc saved: STARRED_x.docx');
  });
});

describe('showPresetSavedNotice', () => {
  it('offers Show in folder and reveals the saved file', () => {
    const reveal = vi.fn();
    showPresetSavedNotice('Read doc', 'READ_1NC.docx', '/a/b/READ_1NC.docx', reveal);
    expect(toastEl()?.textContent).toContain('Read doc saved: READ_1NC.docx in b');
    const button = toastEl()!.querySelector('button')!;
    expect(button.textContent).toBe('Show in folder');
    button.click();
    expect(reveal).toHaveBeenCalledWith('/a/b/READ_1NC.docx');
  });
  it('is a plain toast when the host cannot reveal a file', () => {
    showPresetSavedNotice('Send doc', 'SEND_x.docx', '/a/b/SEND_x.docx', undefined);
    expect(toastEl()).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Send doc saved: SEND_x.docx in b');
  });
  it('is a plain toast when there is no path to reveal', () => {
    showPresetSavedNotice('Send doc', 'SEND_x.docx', null, () => {});
    expect(toastEl()).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Send doc saved: SEND_x.docx');
  });
});

describe('showExportUndoNotice', () => {
  const undoBtn = (): HTMLButtonElement => toastEl()!.querySelector('button')!;

  it('says which folder it went to, with the file name and an Undo button', () => {
    showExportUndoNotice({ label: 'Send doc', fileName: 'SEND_1AC.docx', handle: '/Users/me/Round 3/SEND_1AC.docx', undo: async () => true });
    expect(toastEl()?.textContent).toContain('Send doc saved to Round 3');
    expect(toastEl()?.textContent).toContain('SEND_1AC.docx');
    expect(undoBtn().textContent).toBe('Undo');
  });

  it("names the file's own folder, not Downloads, wherever it was saved", () => {
    showExportUndoNotice({ label: 'Marked doc', fileName: 'MARKED_2NC.docx', handle: '/a/Round 4/MARKED_2NC.docx', undo: async () => true });
    expect(toastEl()?.textContent).toContain('Marked doc saved to Round 4');
  });

  it('Undo runs the undo and confirms it', async () => {
    const undo = vi.fn(async () => true);
    showExportUndoNotice({ label: 'Read doc', fileName: 'READ_1NC.docx', handle: '/d/READ_1NC.docx', undo });
    undoBtn().click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('Moved READ_1NC.docx to the trash.'));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('says so when the undo could not move the file', async () => {
    showExportUndoNotice({ label: 'Read doc', fileName: 'READ_1NC.docx', handle: '/d/READ_1NC.docx', undo: async () => false });
    undoBtn().click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('Couldn’t undo: READ_1NC.docx is still saved.'));
  });

  it('a second press does not undo twice', async () => {
    const undo = vi.fn(async () => true);
    showExportUndoNotice({ label: 'Send doc', fileName: 'a.docx', handle: '/d/a.docx', undo });
    const b = undoBtn();
    b.click();
    b.click();
    await vi.waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
  });
});
