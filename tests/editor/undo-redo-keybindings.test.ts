/**
 * Undo / redo as rebindable ribbon commands (2026-09-18): registered with
 * the classic defaults, dispatched through the host's per-document routing
 * (session undo manager vs. history), and movable like any other binding.
 */

import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema } from '../../src/schema/index.js';
import {
  buildRibbonKeymap,
  DEFAULT_RIBBON_KEYS,
  RIBBON_COMMAND_IDS,
  RIBBON_COMMAND_LABELS,
  type RibbonContext,
} from '../../src/editor/ribbon-commands.js';

describe('undo / redo keybindings', () => {
  it('are registered commands with the classic defaults', () => {
    expect(RIBBON_COMMAND_IDS).toContain('undo');
    expect(RIBBON_COMMAND_IDS).toContain('redo');
    expect(DEFAULT_RIBBON_KEYS.undo).toBe('Mod-z');
    expect(DEFAULT_RIBBON_KEYS.redo).toEqual(['Mod-y', 'Mod-Shift-z']);
    expect(RIBBON_COMMAND_LABELS.undo).toBe('Undo');
    expect(RIBBON_COMMAND_LABELS.redo).toBe('Redo');
  });

  it('dispatch through the host-supplied routing, resolved at press time', () => {
    let undos = 0;
    let redos = 0;
    const ctx = {
      undoCommand: () => () => { undos++; return true; },
      redoCommand: () => () => { redos++; return true; },
    } as unknown as RibbonContext;
    const km = buildRibbonKeymap({}, ctx);
    const state = EditorState.create({ schema });
    km['Mod-z']!(state, () => {});
    km['Mod-y']!(state, () => {});
    km['Mod-Shift-z']!(state, () => {});
    expect([undos, redos]).toEqual([1, 2]);
  });

  it('an override moves the keys and frees the defaults', () => {
    const km = buildRibbonKeymap({ undo: 'Mod-Alt-z', redo: 'Mod-Alt-y' });
    expect(km['Mod-Alt-z']).toBeDefined();
    expect(km['Mod-Alt-y']).toBeDefined();
    expect(km['Mod-z']).toBeUndefined();
    expect(km['Mod-y']).toBeUndefined();
    expect(km['Mod-Shift-z']).toBeUndefined();
  });

  it('fall back to plain history when the host supplies no routing', () => {
    const km = buildRibbonKeymap();
    const state = EditorState.create({ schema });
    // No history plugin on this state → nothing to undo → false, not a throw.
    expect(km['Mod-z']!(state, () => {})).toBe(false);
  });
});
