/**
 * Order of the live word-count readouts: six permutations, one order
 * while editing and one in read mode, unknown values falling back to
 * the default so a bad stored value never hides a readout.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_WORD_COUNT_ORDER,
  WORD_COUNT_ORDERS,
  isWordCountOrder,
  orderWordCountSegments,
} from '../../src/editor/word-count-order.js';
import { settings } from '../../src/editor/settings.js';

const segs = { doc: 'Doc: 10', container: 'Card: 4', remaining: 'Left: 6' };

describe('word count order', () => {
  it('lists every permutation exactly once, default first', () => {
    const values = WORD_COUNT_ORDERS.map((o) => o.value);
    expect(new Set(values).size).toBe(6);
    expect(values[0]).toBe(DEFAULT_WORD_COUNT_ORDER);
    for (const v of values) expect(isWordCountOrder(v)).toBe(true);
    expect(isWordCountOrder('doc-doc-doc')).toBe(false);
    expect(isWordCountOrder(null)).toBe(false);
  });

  it('arranges the segments left to right as asked', () => {
    expect(orderWordCountSegments('doc-container-remaining', segs)).toEqual(['Doc: 10', 'Card: 4', 'Left: 6']);
    expect(orderWordCountSegments('remaining-container-doc', segs)).toEqual(['Left: 6', 'Card: 4', 'Doc: 10']);
    expect(orderWordCountSegments('container-doc-remaining', segs)).toEqual(['Card: 4', 'Doc: 10', 'Left: 6']);
  });

  it('drops readouts that are off and keeps the rest in order', () => {
    expect(orderWordCountSegments('remaining-doc-container', { ...segs, doc: null })).toEqual(['Left: 6', 'Card: 4']);
    expect(orderWordCountSegments('doc-remaining-container', { doc: null, container: null, remaining: null })).toEqual([]);
  });

  it('an unknown order reads as the default', () => {
    expect(orderWordCountSegments('bogus', segs)).toEqual(['Doc: 10', 'Card: 4', 'Left: 6']);
  });
});

describe('the two order settings', () => {
  afterEach(() => {
    settings.set('wordCountOrder', DEFAULT_WORD_COUNT_ORDER);
    settings.set('wordCountOrderReadMode', DEFAULT_WORD_COUNT_ORDER);
  });

  it('default to Doc · Card · Left and are independent', () => {
    expect(settings.get('wordCountOrder')).toBe(DEFAULT_WORD_COUNT_ORDER);
    expect(settings.get('wordCountOrderReadMode')).toBe(DEFAULT_WORD_COUNT_ORDER);
    settings.set('wordCountOrderReadMode', 'remaining-container-doc');
    expect(settings.get('wordCountOrder')).toBe(DEFAULT_WORD_COUNT_ORDER);
    expect(settings.get('wordCountOrderReadMode')).toBe('remaining-container-doc');
  });

  it('a bad stored value sanitizes to the default on import', () => {
    settings.replaceAll({ wordCountOrder: 'sideways', wordCountOrderReadMode: 'container-remaining-doc' });
    expect(settings.get('wordCountOrder')).toBe(DEFAULT_WORD_COUNT_ORDER);
    expect(settings.get('wordCountOrderReadMode')).toBe('container-remaining-doc');
    settings.replaceAll({});
  });
});
