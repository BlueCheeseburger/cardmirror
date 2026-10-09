/**
 * "Which window?" chooser button arithmetic (apps/desktop/src/
 * multipane-chooser.ts). The dialog needs a live Electron app, but the
 * part that actually breaks is which index means what — and it differs
 * between the two callers, which is exactly the kind of off-by-one that
 * silently routes a New Document into the wrong window.
 */

import { describe, it, expect } from 'vitest';
import {
  buildChooserPrompt,
  readChooserResponse,
  sortChooserEntries,
} from '../../apps/desktop/src/multipane-chooser.js';

const LABELS = ['Aff Case · Untitled', '2NR Blocks'];

describe('multi-pane window chooser', () => {
  it('OS-open layout: candidates then New Window, with Esc falling through to New Window', () => {
    const { buttons, cancelId } = buildChooserPrompt(LABELS);
    expect(buttons).toEqual(['Aff Case · Untitled', '2NR Blocks', 'New Window']);
    // A file the OS handed us has to land somewhere, so dismissing
    // still spawns a window rather than dropping the open.
    expect(cancelId).toBe(2);
    expect(readChooserResponse(cancelId, LABELS.length)).toEqual({ kind: 'new-window' });
  });

  it('New Document layout: adds Cancel, and Esc maps to it — not to New Window', () => {
    const opts = { withCancel: true };
    const { buttons, cancelId } = buildChooserPrompt(LABELS, opts);
    expect(buttons).toEqual(['Aff Case · Untitled', '2NR Blocks', 'New Window', 'Cancel']);
    expect(cancelId).toBe(3);
    expect(readChooserResponse(cancelId, LABELS.length, opts)).toEqual({ kind: 'cancel' });
    // The button before it is still New Window — the two must not collapse.
    expect(readChooserResponse(2, LABELS.length, opts)).toEqual({ kind: 'new-window' });
  });

  it('maps each candidate index to its own window, in listed order', () => {
    expect(readChooserResponse(0, LABELS.length)).toEqual({ kind: 'window', index: 0 });
    expect(readChooserResponse(1, LABELS.length)).toEqual({ kind: 'window', index: 1 });
    expect(readChooserResponse(0, LABELS.length, { withCancel: true })).toEqual({
      kind: 'window',
      index: 0,
    });
  });

  it('without a Cancel button, the Cancel index is not special-cased', () => {
    // Guards the decode against reading a withCancel layout it wasn't
    // given: index 3 with no Cancel button is out of range, not cancel.
    expect(readChooserResponse(3, LABELS.length)).toEqual({ kind: 'new-window' });
  });

  it('treats an out-of-range or non-integer response as New Window, never a window', () => {
    for (const bad of [-1, 99, 1.5, Number.NaN]) {
      expect(readChooserResponse(bad, LABELS.length, { withCancel: true })).toEqual({
        kind: 'new-window',
      });
    }
  });

  it('a single candidate still lists New Window (the caller short-circuits before asking)', () => {
    const { buttons, cancelId } = buildChooserPrompt(['Only workspace'], { withCancel: true });
    expect(buttons).toEqual(['Only workspace', 'New Window', 'Cancel']);
    expect(cancelId).toBe(2);
    expect(readChooserResponse(2, 1, { withCancel: true })).toEqual({ kind: 'cancel' });
  });
});

describe('sortChooserEntries', () => {
  it('orders windows alphabetically, docs within a window too, ties by id', () => {
    const out = sortChooserEntries([
      { id: 3, label: 'Zeta · Alpha' },
      { id: 1, label: 'beta' },
      { id: 2, label: 'Alpha · Zeta' },
    ]);
    expect(out.map((e) => e.id)).toEqual([2, 3, 1]);
    expect(out[0]!.label).toBe('Alpha · Zeta');
  });
  it('sorts numbers naturally', () => {
    const out = sortChooserEntries([
      { id: 1, label: 'Doc 10' },
      { id: 2, label: 'Doc 2' },
    ]);
    expect(out.map((e) => e.id)).toEqual([2, 1]);
  });
});
