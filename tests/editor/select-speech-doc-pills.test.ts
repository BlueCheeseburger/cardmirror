// @vitest-environment jsdom

/**
 * Select Speech Document: each row names its window, and the window's pills
 * (This window, Minimized, Speech doc) sit at the right.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const hostState = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('../../src/editor/host/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/host/index.js')>();
  return { ...mod, getElectronHost: () => ({ listDocs: async () => hostState.rows, speechSet: async () => {} }) };
});
vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

import { openSelectSpeechDocModal, windowCaption } from '../../src/editor/select-speech-doc-ui.js';

function row(uid: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid,
    filename: `${uid}.cmir`,
    windowId: 1,
    windowTitle: `${uid}.cmir — CardMirror`,
    windowName: null,
    isSpeech: false,
    isOwnWindow: false,
    isFocusedWindow: false,
    isMinimized: false,
    ...over,
  };
}

afterEach(() => {
  // Closing through the dialog's own ✕ clears its module state too.
  document.querySelector<HTMLButtonElement>('.pmd-select-speech-close')?.click();
  document.body.innerHTML = '';
});

const rowFor = (name: string): Element | undefined =>
  [...document.querySelectorAll('.pmd-select-speech-row')].find(
    (r) => r.querySelector('.pmd-select-speech-row-name')?.textContent === name,
  );
const pillsIn = (el: Element | undefined): string[] =>
  [...(el?.querySelectorAll('.pmd-win-pill') ?? [])].map((p) => p.textContent ?? '');

describe('windowCaption', () => {
  it('prefers the name the user gave the window', () => {
    expect(windowCaption({ windowName: 'AFF', windowTitle: 'A.cmir · B.cmir — CardMirror' })).toBe('AFF');
  });
  it('falls back to the title minus the app suffix', () => {
    expect(windowCaption({ windowName: null, windowTitle: 'Case.cmir — CardMirror' })).toBe('Case.cmir');
  });
  it('calls a home-screen window an untitled window, never "Window 7"', () => {
    expect(windowCaption({ windowName: null, windowTitle: 'CardMirror' })).toBe('Untitled window');
    expect(windowCaption({ windowName: null, windowTitle: '' })).toBe('Untitled window');
  });
});

describe('Select Speech Document pills', () => {
  it('marks this window, a minimized one and the speech doc', async () => {
    hostState.rows = [
      row('Own', { windowId: 1, isOwnWindow: true }),
      row('Hidden', { windowId: 3, isMinimized: true }),
      row('Speech', { windowId: 4, isSpeech: true }),
      row('Plain', { windowId: 5 }),
    ];
    await openSelectSpeechDocModal();
    expect(pillsIn(rowFor('Own.cmir'))).toEqual(['This window']);
    expect(pillsIn(rowFor('Hidden.cmir'))).toEqual(['Minimized']);
    expect(pillsIn(rowFor('Speech.cmir'))).toEqual(['Speech doc']);
    expect(pillsIn(rowFor('Plain.cmir'))).toEqual([]);
  });
  it('leaves out a caption that only repeats the document name', async () => {
    hostState.rows = [row('Solo', { windowTitle: 'Solo.cmir — CardMirror' })];
    await openSelectSpeechDocModal();
    expect(rowFor('Solo.cmir')?.querySelector('.pmd-select-speech-row-sub')).toBeNull();
  });
  it('shows the window name under the document', async () => {
    hostState.rows = [row('Case', { windowName: 'Round 3', isOwnWindow: true })];
    await openSelectSpeechDocModal();
    expect(rowFor('Case.cmir')?.querySelector('.pmd-select-speech-row-sub')?.textContent).toBe('Round 3');
  });
});
