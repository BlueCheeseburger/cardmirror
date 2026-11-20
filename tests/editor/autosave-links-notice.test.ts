// @vitest-environment jsdom

/** The one-time "autosave is paused" notice for a .docx holding live links. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetAutosaveLinksNoticeForTests,
  clearAutosavePausedNotice,
  describeLiveLinks,
  noteAutosavePausedByLinks,
} from '../../src/editor/autosave-links-notice.js';

afterEach(() => {
  __resetAutosaveLinksNoticeForTests();
  document.body.innerHTML = '';
});

const toasts = (): string => [...document.querySelectorAll('.pmd-toast')].map((t) => t.textContent).join('|');

describe('autosave paused notice', () => {
  it('names what is in the document', () => {
    expect(describeLiveLinks(1, 0)).toBe('a live view');
    expect(describeLiveLinks(0, 2)).toBe('2 linked copies');
    expect(describeLiveLinks(1, 1)).toBe('a live view and a linked copy');
  });

  it('shows once per document, for a live view as well as a linked copy', () => {
    expect(noteAutosavePausedByLinks('doc-a', 1, 0)).toBe(true);
    expect(toasts()).toMatch(/Autosave is paused: this Word file has a live view/);
    expect(noteAutosavePausedByLinks('doc-a', 1, 0)).toBe(false);
    expect(noteAutosavePausedByLinks('doc-a', 2, 1)).toBe(false);
    // Another document is told separately.
    expect(noteAutosavePausedByLinks('doc-b', 0, 1)).toBe(true);
  });

  it('says nothing for a document with no links', () => {
    expect(noteAutosavePausedByLinks('doc-a', 0, 0)).toBe(false);
    expect(toasts()).toBe('');
  });

  it('tells again after autosave has resumed (links removed) and one is added back', () => {
    expect(noteAutosavePausedByLinks('doc-a', 0, 1)).toBe(true);
    clearAutosavePausedNotice('doc-a');
    expect(noteAutosavePausedByLinks('doc-a', 0, 1)).toBe(true);
  });
});
