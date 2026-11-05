// @vitest-environment jsdom

/**
 * The speech doc is marked on its own name (amber, mic first) in every list that
 * names windows, the way the "which window?" chooser does it, and its window
 * gets no "Speech doc" pill when the name carries the marker.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { namesSpeechDoc, renderDocNames, renderSpeechName } from '../../src/editor/window-pills.js';
import { showMoveTray } from '../../src/editor/pane-move-tray.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderSpeechName / renderDocNames', () => {
  it('draws the name with the mic first, in a span that carries the amber class', () => {
    const el = renderSpeechName('Politics DA.cmir');
    expect(el.className).toBe('pmd-speech-name');
    expect(el.firstElementChild?.className).toBe('pmd-speech-name-mic');
    expect(el.textContent).toBe('Politics DA.cmir');
  });
  it('joins names with a dot and marks only the speech doc, once', () => {
    const { el, marked } = renderDocNames(['A.cmir', 'B.cmir', 'B.cmir'], 'B.cmir');
    expect(marked).toBe(true);
    expect(el.textContent).toBe('A.cmir · B.cmir · B.cmir');
    expect(el.querySelectorAll('.pmd-speech-name')).toHaveLength(1);
    expect(el.querySelector('.pmd-speech-name')?.textContent).toBe('B.cmir');
  });
  it('marks nothing when the speech doc is not among the names', () => {
    expect(renderDocNames(['A.cmir'], 'Other.cmir').marked).toBe(false);
    expect(renderDocNames(['A.cmir'], null).marked).toBe(false);
    expect(namesSpeechDoc(['A.cmir'], 'A.cmir')).toBe(true);
    expect(namesSpeechDoc(['A.cmir'], undefined)).toBe(false);
  });
});

describe('move tray', () => {
  const slots = [{ id: 'slot1', num: 1, name: 'x', source: true }];
  const tile = (id: number): HTMLElement | null => document.querySelector(`[data-move-target="win:${id}"]`);

  it('marks the speech doc on its name and drops the window pill', () => {
    showMoveTray(slots, [{ id: 7, label: 'Case.cmir · Politics DA.cmir', speech: true, speechDoc: 'Politics DA.cmir' }]);
    expect(tile(7)?.querySelector('.pmd-move-tile-name .pmd-speech-name')?.textContent).toBe('Politics DA.cmir');
    expect(tile(7)?.querySelector('.pmd-win-pill-speech')).toBeNull();
    // The tile stays two lines: the name, then the verb.
    expect(tile(7)?.textContent).toContain('Send there');
  });
  it('keeps the Speech doc pill when the label does not name the speech doc (a named window)', () => {
    showMoveTray(slots, [{ id: 7, label: 'Round 3', speech: true, speechDoc: 'Politics DA.cmir' }]);
    expect(tile(7)?.querySelector('.pmd-speech-name')).toBeNull();
    expect(tile(7)?.querySelector('.pmd-win-pill-speech')).not.toBeNull();
  });
  it('still shows the other pills beside a marked name', () => {
    showMoveTray(slots, [{ id: 7, label: 'Politics DA.cmir', speech: true, speechDoc: 'Politics DA.cmir', minimized: true }]);
    const pills = [...(tile(7)?.querySelectorAll('.pmd-win-pill') ?? [])].map((p) => p.textContent);
    expect(pills).toEqual(['Minimized']);
  });
});
