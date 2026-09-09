/**
 * Shelf / Receive-pill type chips are all three letters (user request
 * 2026-09-09) so the rows line up, and the heading ones match the search
 * toolbar's file-object badges.
 */
import { describe, it, expect } from 'vitest';
import { typeBadge } from '../../src/editor/dropzone-ui.js';
import { SESSION_BADGE_LABEL } from '../../src/editor/pairing/receive-pill-ui.js';
import { FILE_OBJECT_KIND_BADGES } from '../../src/editor/file-search.js';

const TYPES = ['pocket', 'hat', 'block', 'tag', 'analytic', 'card', 'card_body', 'cite_paragraph', 'analytic_unit', 'undertag', 'paragraph', 'text', 'something-else'];

describe('row type chips', () => {
  it('every chip label is exactly three letters', () => {
    for (const t of TYPES) expect(typeBadge(t).label, t).toMatch(/^[A-Z]{3}$/);
    expect(SESSION_BADGE_LABEL).toMatch(/^[A-Z]{3}$/);
  });
  it('heading chips match the search toolbar', () => {
    for (const k of ['pocket', 'hat', 'block', 'tag'] as const) expect(typeBadge(k).label).toBe(FILE_OBJECT_KIND_BADGES[k]);
  });
  it('kinds (the styling hook) are unchanged', () => {
    expect(TYPES.map((t) => typeBadge(t).kind)).toEqual(['pocket', 'hat', 'block', 'tag', 'analytic', 'card', 'card', 'cite', 'analytic', 'tag', 'text', 'text', 'generic']);
  });
});
