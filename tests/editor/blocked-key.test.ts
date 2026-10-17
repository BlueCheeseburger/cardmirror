// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { notifyKeyBlocked, CLOSE_DIALOG_FIRST } from '../../src/editor/blocked-key.js';

afterEach(() => {
  document.body.innerHTML = '';
});

const toasts = () => [...document.querySelectorAll('.pmd-toast')].map((t) => t.textContent);

describe('notifyKeyBlocked', () => {
  it('shows the message', () => {
    notifyKeyBlocked(CLOSE_DIALOG_FIRST);
    expect(toasts()).toEqual(['Close this dialog first.']);
  });
  it('keeps one note on screen for repeated presses', () => {
    notifyKeyBlocked(CLOSE_DIALOG_FIRST);
    notifyKeyBlocked(CLOSE_DIALOG_FIRST);
    notifyKeyBlocked(CLOSE_DIALOG_FIRST);
    expect(toasts()).toHaveLength(1);
  });
  it('a different message still shows', () => {
    notifyKeyBlocked(CLOSE_DIALOG_FIRST);
    notifyKeyBlocked('Something else');
    expect(toasts()).toHaveLength(2);
  });
});
