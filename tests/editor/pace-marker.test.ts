// @vitest-environment jsdom

/**
 * The reading-position marker's maths: where the speaker should be by the
 * clock (the same adjusted clock as the pace verdict), when the marker stays
 * hidden, and turning "seconds read from the top" into a document position
 * for flow and lay speeds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { docReadCounts, posAtReadSeconds } from '../../src/editor/live-read-time.js';
import { countReadAloudSplit } from '../../src/editor/word-count.js';
import { readTimeSeconds } from '../../src/editor/word-count.js';
import { MASTERFILE_OVER_SEC, expectedReadSec, pacedNeedSec, speechClockStarted } from '../../src/editor/timer-pace.js';
import {
  getTimerState,
  loadSpeechPreset,
  pauseTimer,
  resetTimer,
  selectMode,
  startTimer,
} from '../../src/editor/timer-state.js';

describe('expectedReadSec', () => {
  it('starts at the top and reaches the end of the doc as the clock reaches zero', () => {
    // 8:00 speech, 8:00 doc, 3:00 left on the clock → 5:00 should be read.
    expect(expectedReadSec({ clockSec: 180, totalSec: 480, speechTotalSec: 480 })).toBe(300);
    expect(expectedReadSec({ clockSec: 480, totalSec: 480, speechTotalSec: 480 })).toBe(0);
    expect(expectedReadSec({ clockSec: 0, totalSec: 480, speechTotalSec: 480 })).toBe(480);
  });

  it('moves at the pace that fits the whole doc into the whole speech, whatever its length', () => {
    // 7:00 doc in an 8:00 speech: still at the top when the clock starts (not
    // 1:00 in), halfway when half the speech is gone, the end at 0:00.
    expect(expectedReadSec({ clockSec: 480, totalSec: 420, speechTotalSec: 480 })).toBe(0);
    expect(expectedReadSec({ clockSec: 240, totalSec: 420, speechTotalSec: 480 })).toBe(210);
    expect(expectedReadSec({ clockSec: 0, totalSec: 420, speechTotalSec: 480 })).toBe(420);
    // 5:00 doc in an 8:00 speech.
    expect(expectedReadSec({ clockSec: 240, totalSec: 300, speechTotalSec: 480 })).toBe(150);
    // 8:20 doc in an 8:00 speech (a little long): starts at the top too.
    expect(expectedReadSec({ clockSec: 480, totalSec: 500, speechTotalSec: 480 })).toBe(0);
    expect(expectedReadSec({ clockSec: 240, totalSec: 500, speechTotalSec: 480 })).toBe(250);
  });

  it('hides for a doc more than a minute over the speech (a masterfile)', () => {
    expect(expectedReadSec({ clockSec: 300, totalSec: 480 + MASTERFILE_OVER_SEC + 1, speechTotalSec: 480 })).toBeNull();
    expect(expectedReadSec({ clockSec: 300, totalSec: 12000, speechTotalSec: 480 })).toBeNull();
    // Exactly a minute over still shows.
    expect(expectedReadSec({ clockSec: 300, totalSec: 480 + MASTERFILE_OVER_SEC, speechTotalSec: 480 })).not.toBeNull();
  });

  it('falls back to total minus the clock when the speech length is unknown, and hides for an empty doc', () => {
    expect(expectedReadSec({ clockSec: 100, totalSec: 600, speechTotalSec: 0 })).toBe(500);
    expect(expectedReadSec({ clockSec: 100, totalSec: 0, speechTotalSec: 480 })).toBeNull();
  });
});

describe('pacedNeedSec', () => {
  it('scales by speech length over doc length, and leaves the time alone without both', () => {
    expect(pacedNeedSec(15, 30, 60)).toBe(30);
    expect(pacedNeedSec(15, 30, 20)).toBeCloseTo(10);
    expect(pacedNeedSec(15, null, 60)).toBe(15);
    expect(pacedNeedSec(15, 30, 0)).toBe(15);
  });
});

describe('posAtReadSeconds', () => {
  const hl = () => schema.marks['highlight']!.create();
  const reader = { name: 'Amy', wpm: 60, tagWpm: 60, layWpm: 30, layTagWpm: 30 };

  function card(tag: string, body: string): PMNode {
    return schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
      schema.nodes['card_body']!.create(null, [
        schema.text(body, [hl()]),
        schema.text(' not read aloud words'),
      ]),
    ]);
  }
  const doc = schema.nodes['doc']!.createChecked(null, [
    schema.nodes['block']!.create({ id: newHeadingId() }, schema.text('Block heading')),
    card('Tag one', 'a b c d e f g h'),
    card('Tag two', 'i j k l m n'),
    card('Tag three', 'o p q r s t u v w x'),
  ]);

  const secondsBefore = (pos: number, lay = false): number =>
    readTimeSeconds(countReadAloudSplit(doc, 0, pos), reader, lay) ?? NaN;

  it('is the doc start at 0 seconds and the doc end past the total', () => {
    expect(posAtReadSeconds(doc, 0, reader)).toBe(0);
    const total = readTimeSeconds(docReadCounts(doc), reader)!;
    expect(posAtReadSeconds(doc, total, reader)).toBe(doc.content.size);
    expect(posAtReadSeconds(doc, total + 50, reader)).toBe(doc.content.size);
  });

  it('lands on the first spot where the text before it has used up the time', () => {
    const total = readTimeSeconds(docReadCounts(doc), reader)!;
    for (const sec of [1, 3, 9, 14, 20, Math.floor(total) - 2]) {
      const pos = posAtReadSeconds(doc, sec, reader)!;
      expect(secondsBefore(pos)).toBeGreaterThanOrEqual(sec);
      expect(secondsBefore(pos - 1)).toBeLessThan(sec);
    }
  });

  it('moves later in lay mode, which reads slower', () => {
    const flow = posAtReadSeconds(doc, 10, reader, false)!;
    const lay = posAtReadSeconds(doc, 10, reader, true)!;
    expect(lay).toBeLessThan(flow);
    expect(secondsBefore(lay, true)).toBeGreaterThanOrEqual(10);
    expect(secondsBefore(lay - 1, true)).toBeLessThan(10);
  });

  it('is null when the reader has no lay speed to use', () => {
    expect(posAtReadSeconds(doc, 10, { wpm: 60 }, true)).toBeNull();
  });
});

describe('speechClockStarted', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetTimer();
  });

  it('is on once the clock starts, stays on through a pause, and goes on reset', () => {
    vi.useFakeTimers();
    resetTimer();
    expect(speechClockStarted(getTimerState())).toBe(false);
    loadSpeechPreset(1); // armed but not started
    expect(speechClockStarted(getTimerState())).toBe(false);
    startTimer();
    expect(speechClockStarted(getTimerState())).toBe(true);
    vi.advanceTimersByTime(5000);
    pauseTimer();
    expect(getTimerState().running).toBe(false);
    expect(speechClockStarted(getTimerState())).toBe(true);
    resetTimer();
    expect(speechClockStarted(getTimerState())).toBe(false);
  });

  it('is off on a prep clock', () => {
    vi.useFakeTimers();
    loadSpeechPreset(1);
    startTimer();
    vi.advanceTimersByTime(2000);
    pauseTimer();
    selectMode('affPrep');
    expect(speechClockStarted(getTimerState())).toBe(false);
  });
});
