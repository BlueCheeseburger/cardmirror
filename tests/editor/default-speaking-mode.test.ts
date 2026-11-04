import { afterEach, describe, expect, it } from 'vitest';
import { settings, SETTING_METADATA } from '../../src/editor/settings.js';
import { defaultLaySpeaking } from '../../src/editor/live-read-time.js';

const reset = (): void => {
  settings.set('defaultSpeakingMode', 'flow');
};
afterEach(reset);

describe('Default read-time speed', () => {
  it('is flow by default, and lives beside the readers row in Word counts', () => {
    expect(settings.get('defaultSpeakingMode')).toBe('flow');
    const keys = SETTING_METADATA.map((m) => m.key as string);
    const meta = SETTING_METADATA.find((m) => m.key === 'defaultSpeakingMode')!;
    expect(meta.kind).toBe('speakingMode');
    expect(meta.section).toBe('Word counts');
    expect(keys.indexOf('defaultSpeakingMode')).toBe(keys.indexOf('readers') + 1);
  });

  it('starts documents on flow unless set to lay', () => {
    settings.set('readers', [{ name: 'A', wpm: 250, layWpm: 180 }]);
    expect(defaultLaySpeaking()).toBe(false);
    settings.set('defaultSpeakingMode', 'lay');
    expect(defaultLaySpeaking()).toBe(true);
  });

  it('stays on flow while no reader shown live has a lay rate, even when set to lay', () => {
    settings.set('defaultSpeakingMode', 'lay');
    settings.set('readers', [{ name: 'A', wpm: 250 }]);
    expect(defaultLaySpeaking()).toBe(false);
    // Only the first two readers count, as in the bottom bar.
    settings.set('readers', [
      { name: 'A', wpm: 250 },
      { name: 'B', wpm: 240 },
      { name: 'C', wpm: 230, layWpm: 170 },
    ]);
    expect(defaultLaySpeaking()).toBe(false);
  });
});
