/**
 * Voice v2 vocabulary matcher: the whole-utterance rule, built-in and
 * per-user aliases, the edit-distance allowance for long words only,
 * sleep/wake phrases, and calibration alias learning.
 */
import { describe, it, expect } from 'vitest';
import {
  VOICE_COMMANDS,
  normalizeTranscript,
  matchCommand,
  matchPhrase,
  learnAliases,
  SLEEP_PHRASES,
  WAKE_PHRASES,
} from '../../src/editor/voice/vocabulary.js';

describe('voice vocabulary', () => {
  it('has fourteen acoustically spaced words', () => {
    expect(VOICE_COMMANDS).toHaveLength(14);
    expect(new Set(VOICE_COMMANDS).size).toBe(14);
  });

  it('normalizes recognizer output: case, punctuation, fillers', () => {
    expect(normalizeTranscript('Line.')).toBe('line');
    expect(normalizeTranscript('  Um, glow! ')).toBe('glow');
    expect(normalizeTranscript("Accord's")).toBe('accords');
  });

  it('fires only when the whole utterance is one word (or a whole-utterance alias)', () => {
    expect(matchCommand('Line.')).toBe('line');
    expect(matchCommand('the line of argument')).toBeNull();
    expect(matchCommand('delete the paragraph')).toBeNull();
    expect(matchCommand('Site.')).toBe('cite'); // homophone alias
    expect(matchCommand('Low.')).toBe('glow');
    expect(matchCommand('and do')).toBe('undo'); // two-word alias, still whole utterance
    expect(matchCommand('')).toBeNull();
  });

  it('allows one character off for the longer words only', () => {
    expect(matchCommand('condensed')).toBe('condense');
    expect(matchCommand('shrinl')).toBe('shrink');
    expect(matchCommand('lint')).toBeNull(); // short words stay exact
    expect(matchCommand('bag')).toBeNull();
  });

  it('honors per-user profile aliases from calibration', () => {
    expect(matchCommand('there')).toBeNull();
    expect(matchCommand('there', { aliases: { bare: ['there'] } })).toBe('bare');
  });

  it('matches sleep and wake phrases with a stray word or a repeat', () => {
    expect(matchPhrase('Sleep.', SLEEP_PHRASES)).toBe('sleep');
    expect(matchPhrase('um wake', WAKE_PHRASES)).toBe('wake');
    expect(matchPhrase('wake up wake up', WAKE_PHRASES)).toBe('wake up');
    expect(matchPhrase('I need to wake up early tomorrow', WAKE_PHRASES)).toBeNull();
  });

  it('learns aliases from calibration takes and reports collisions instead of learning them', () => {
    const res = learnAliases('bare', ['Bare.', 'there', 'Bah', 'Card']);
    expect(res.aliases).toEqual(['there', 'bah']);
    expect(res.collisions).toEqual([{ transcript: 'card', with: 'card' }]);
    // A learned alias then matches, and only as a whole utterance.
    const profile = { aliases: { bare: res.aliases } };
    expect(matchCommand('There.', profile)).toBe('bare');
    expect(matchCommand('over there', profile)).toBeNull();
  });
});
