// @vitest-environment jsdom
/**
 * Reloading a document from disk closes the old record, which clears the
 * speech designation, then opens a fresh one. Both reload paths now capture
 * the flag before the close and set it on the fresh view afterward; this
 * pins the registry sequence they rely on.
 */
import { describe, it, expect } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { getSpeechDocResolver } from '../../src/editor/speech-doc-registry.js';

const fakeView = (): EditorView => ({}) as unknown as EditorView;

describe('speech designation across a reload', () => {
  it('is lost by the close alone, and restored by marking the fresh view', () => {
    const resolver = getSpeechDocResolver();
    const oldView = fakeView();
    resolver.registerView('old-uid', oldView);
    resolver.setSpeech(oldView);
    const wasSpeech = resolver.isSpeechByUid('old-uid');
    expect(wasSpeech).toBe(true);

    // What closing the old record does.
    if (resolver.isSpeechByUid('old-uid')) resolver.setSpeechByUid(null);
    resolver.unregisterView('old-uid');
    expect(resolver.getSpeechUid()).toBeNull();

    // The fresh record registers itself, then the reload re-marks it.
    const freshView = fakeView();
    resolver.registerView('fresh-uid', freshView);
    if (wasSpeech) resolver.setSpeech(freshView);
    expect(resolver.isSpeechByUid('fresh-uid')).toBe(true);
    expect(resolver.getSpeechView()).toBe(freshView);

    resolver.setSpeechByUid(null);
    resolver.unregisterView('fresh-uid');
  });

  it('leaves a non-speech document unmarked after a reload', () => {
    const resolver = getSpeechDocResolver();
    const a = fakeView();
    resolver.registerView('a', a);
    expect(resolver.isSpeechByUid('a')).toBe(false);
    resolver.unregisterView('a');
    expect(resolver.getSpeechUid()).toBeNull();
  });
});
