/**
 * Arrange Windows in three-pane: the speech doc takes the outer slot on
 * the chosen side, every other document the middle slot, the far slot
 * empties. Plus the two settings behind both editions.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { slotPlanForSpeech } from '../../src/editor/arrange-plan.js';
import { settings } from '../../src/editor/settings.js';

describe('slotPlanForSpeech', () => {
  it('right: speech in slot3, docs in slot2, slot1 empties', () => {
    expect(slotPlanForSpeech('right')).toEqual({ speechSlot: 'slot3', docsSlot: 'slot2', emptySlot: 'slot1' });
  });
  it('left: speech in slot1, docs in slot2, slot3 empties', () => {
    expect(slotPlanForSpeech('left')).toEqual({ speechSlot: 'slot1', docsSlot: 'slot2', emptySlot: 'slot3' });
  });
});

describe('Arrange Windows settings', () => {
  afterEach(() => {
    settings.set('arrangeSpeechSide', 'right');
    settings.set('arrangeSpeechPct', 50);
  });

  it('default to the right side at 50%, like Verbatim', () => {
    expect(settings.get('arrangeSpeechSide')).toBe('right');
    expect(settings.get('arrangeSpeechPct')).toBe(50);
  });

  it('sanitize an import: unknown side → right, share clamped to 10–90', () => {
    settings.replaceAll({ arrangeSpeechSide: 'top', arrangeSpeechPct: 400 });
    expect(settings.get('arrangeSpeechSide')).toBe('right');
    expect(settings.get('arrangeSpeechPct')).toBe(90);
    settings.replaceAll({ arrangeSpeechSide: 'left', arrangeSpeechPct: 3 });
    expect(settings.get('arrangeSpeechSide')).toBe('left');
    expect(settings.get('arrangeSpeechPct')).toBe(10);
    settings.replaceAll({});
  });
});
