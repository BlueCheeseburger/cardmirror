import { describe, expect, it } from 'vitest';
import { jumpRevealNeeded, jumpRevealToast } from '../../src/editor/jump-reveal.js';

describe('jumpRevealNeeded', () => {
  it('needs nothing when the pane is on screen', () => {
    expect(jumpRevealNeeded(false, false)).toBe('none');
  });
  it('unhides a pane the user hid', () => {
    expect(jumpRevealNeeded(true, false)).toBe('unhide');
  });
  it('moves the expansion when another pane is expanded', () => {
    expect(jumpRevealNeeded(false, true)).toBe('show-over-expanded');
    // Hidden and covered: the expansion move shows it, so one answer is enough.
    expect(jumpRevealNeeded(true, true)).toBe('show-over-expanded');
  });
});

describe('jumpRevealToast', () => {
  it('names the document and what changed', () => {
    expect(jumpRevealToast('unhide', 'Aff.cmir')).toBe('Showed the hidden pane for “Aff.cmir” to jump there.');
    expect(jumpRevealToast('show-over-expanded', 'Aff.cmir')).toBe(
      'Switched the expanded pane to “Aff.cmir” to jump there.',
    );
  });
  it('copes with an unnamed document and says nothing when nothing changed', () => {
    expect(jumpRevealToast('unhide', null)).toContain('the document');
    expect(jumpRevealToast('none', 'x')).toBe('');
  });
});
