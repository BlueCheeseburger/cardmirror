/**
 * The microphone at the left of a document's blue title bar: the speech-doc
 * marker. It sits invisible until the pointer is over the bar, then shows as a
 * faint ghost; clicking it makes the document the active speech doc. On the
 * speech doc itself it stays fully visible (and the bar turns amber), and a
 * click clears the designation — the same toggle as the ribbon's
 * "Mark / unmark the active doc as the speech doc".
 */

import { setIcon } from './icons.js';

export interface ChipSpeechButton {
  el: HTMLButtonElement;
  /** Show whether the bar's document is the speech doc. */
  setState(isSpeech: boolean): void;
}

export const SPEECH_MAKE_TITLE = 'Make this the speech document';
export const SPEECH_CLEAR_TITLE = 'This is the speech document — click to clear it';

export function createChipSpeechButton(onToggle: () => void): ChipSpeechButton {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pmd-pane-chip-speech';
  setIcon(el, 'mic');
  el.setAttribute('aria-pressed', 'false');
  el.title = SPEECH_MAKE_TITLE;
  el.setAttribute('aria-label', SPEECH_MAKE_TITLE);
  // Keep the editor's selection / focus, and don't let the bar read the press
  // as the start of a drag.
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggle();
  });
  return {
    el,
    setState(isSpeech: boolean): void {
      el.setAttribute('aria-pressed', isSpeech ? 'true' : 'false');
      const title = isSpeech ? SPEECH_CLEAR_TITLE : SPEECH_MAKE_TITLE;
      el.title = title;
      el.setAttribute('aria-label', title);
    },
  };
}
