/**
 * Three-pane New must produce the same blank as single-pane New: exactly
 * one empty line, in the user's "Default text style" (Analytic out of the
 * box). Regression for the undocumented pocket("Untitled") that the
 * shell's blank used to seed — it duplicated the pane chip's name,
 * diverged from single-pane, and broke the speech-doc pocket-OFF branch.
 * Both modes now share this one builder, so the shapes cannot drift.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { makeBlankDoc, seedCursorOffset } from '../../src/editor/blank-doc.js';
import { settings } from '../../src/editor/settings.js';

describe('makeBlankDoc (three-pane New)', () => {
  afterEach(() => settings.set('defaultTextStyle', 'analytic'));

  it('starts in an analytic by default — no seeded headings', () => {
    const doc = makeBlankDoc();
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe('analytic_unit');
    expect(doc.firstChild!.firstChild!.type.name).toBe('analytic');
    expect(doc.textContent).toBe('');
    expect(seedCursorOffset(doc.firstChild!)).toBe(2);
  });

  it('"Clear" gives one empty paragraph', () => {
    settings.set('defaultTextStyle', 'normal');
    const doc = makeBlankDoc();
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe('paragraph');
    expect(doc.firstChild!.content.size).toBe(0);
    expect(seedCursorOffset(doc.firstChild!)).toBe(1);
  });

  it('"Undertag" gives one empty undertag', () => {
    settings.set('defaultTextStyle', 'undertag');
    const doc = makeBlankDoc();
    expect(doc.firstChild!.type.name).toBe('undertag');
    expect(doc.firstChild!.content.size).toBe(0);
  });

  it('any heading level or Tag can be the starting line', () => {
    for (const style of ['pocket', 'hat', 'block'] as const) {
      settings.set('defaultTextStyle', style);
      const doc = makeBlankDoc();
      expect(doc.childCount).toBe(1);
      expect(doc.firstChild!.type.name).toBe(style);
      expect(doc.firstChild!.content.size).toBe(0);
      expect(seedCursorOffset(doc.firstChild!)).toBe(1);
    }
    settings.set('defaultTextStyle', 'tag');
    const doc = makeBlankDoc();
    expect(doc.firstChild!.type.name).toBe('card');
    expect(doc.firstChild!.firstChild!.type.name).toBe('tag');
    expect(doc.firstChild!.firstChild!.content.size).toBe(0);
    expect(seedCursorOffset(doc.firstChild!)).toBe(2);
  });

  it('an unknown stored value falls back to analytic', () => {
    settings.set('defaultTextStyle', 'bogus' as never);
    expect(makeBlankDoc().firstChild!.type.name).toBe('analytic_unit');
  });
});
