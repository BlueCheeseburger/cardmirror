// @vitest-environment jsdom
/**
 * The voice card floats: drag it by its header and the spot is
 * remembered for the next session; the menu hangs off the card; reset
 * puts it back in the stylesheet's default corner.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VoicePill } from '../../src/editor/voice/ui.js';

const POSITION_KEY = 'pmd-voice-card-pos';
let pill: VoicePill | null = null;

function pointer(type: string, target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
}
const card = (): HTMLElement => document.querySelector<HTMLElement>('.pmd-voice-card')!;
const handle = (): HTMLElement => document.querySelector<HTMLElement>('.pmd-voice-card-handle')!;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});
afterEach(() => {
  pill?.destroy();
  pill = null;
});

describe('voice card', () => {
  it('starts in the default corner with no inline position', () => {
    pill = new VoicePill();
    expect(card().style.left).toBe('');
    expect(card().style.top).toBe('');
    expect(card().querySelector('.pmd-voice-card-menu-btn')).not.toBeNull();
  });

  it('dragging the header moves it and remembers the spot; a new card restores it', () => {
    pill = new VoicePill();
    pointer('pointerdown', handle(), 10, 10);
    pointer('pointermove', window, 150, 90);
    pointer('pointerup', window, 150, 90);
    expect(card().style.left).toBe('140px');
    expect(card().style.top).toBe('80px');
    expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual({ left: 140, top: 80 });
    pill.destroy();
    pill = new VoicePill();
    expect(card().style.left, 'remembered across sessions').toBe('140px');
    expect(card().style.top).toBe('80px');
  });

  it('a click without movement is not a drag and remembers nothing', () => {
    pill = new VoicePill();
    pointer('pointerdown', handle(), 10, 10);
    pointer('pointermove', window, 11, 11);
    pointer('pointerup', window, 11, 11);
    expect(card().style.left).toBe('');
    expect(localStorage.getItem(POSITION_KEY)).toBeNull();
  });

  it('the menu button never starts a drag; reset returns to the corner', () => {
    pill = new VoicePill();
    const btn = card().querySelector<HTMLElement>('.pmd-voice-card-menu-btn')!;
    pointer('pointerdown', btn, 10, 10);
    pointer('pointermove', window, 200, 200);
    pointer('pointerup', window, 200, 200);
    expect(card().style.left).toBe('');
    pointer('pointerdown', handle(), 10, 10);
    pointer('pointermove', window, 60, 60);
    pointer('pointerup', window, 60, 60);
    expect(localStorage.getItem(POSITION_KEY)).not.toBeNull();
    pill.resetPosition();
    expect(card().style.left).toBe('');
    expect(localStorage.getItem(POSITION_KEY)).toBeNull();
  });
});
