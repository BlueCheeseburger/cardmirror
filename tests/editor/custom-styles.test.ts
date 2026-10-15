// @vitest-environment jsdom
/** Custom styles: the data model (sanitizing, raw-JSON parse), applying one as
 *  direct marks (a toggle, like Bold), and the command registry it rides on. */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../../src/schema/index.js';
import {
  customStyleTransaction,
  isCustomStyleActive,
  marksForCustomStyle,
  parseCustomStylesJson,
  sanitizeCustomStyles,
  MAX_CUSTOM_STYLES,
  type CustomStyle,
} from '../../src/editor/custom-styles.js';
import {
  isPluginCommandId,
  pluginCommandIds,
  pluginCommandLabel,
  resetPluginRegistryForTests,
  runPluginCommand,
  setUserCommands,
} from '../../src/editor/plugin-registry.js';
import { settings } from '../../src/editor/settings.js';

const n = schema.nodes;

function stateWith(text: string, from?: number, to?: number): EditorState {
  const doc = n['doc']!.create(null, [n['paragraph']!.create(null, schema.text(text))]);
  let state = EditorState.create({ doc });
  if (from != null) state = state.apply(state.tr.setSelection(TextSelection.create(doc, from, to ?? from)));
  return state;
}
const style = (format: CustomStyle['format']): CustomStyle => ({ id: 's', name: 'S', format });
const markNames = (s: EditorState, pos: number): string[] =>
  s.doc.resolve(pos).marks().map((m) => m.type.name);

afterEach(() => {
  resetPluginRegistryForTests();
  settings.set('customStyles', []);
});

describe('sanitizeCustomStyles', () => {
  it('keeps good styles, drops nameless and malformed ones, trims names', () => {
    const out = sanitizeCustomStyles([
      { name: '  Rebuttal  ', format: { bold: true, color: '#c00000' } },
      { name: '', format: { bold: true } },
      'junk',
      null,
      { name: 'Flat', italic: true, highlight: 'CYAN', size: 11.26 },
    ]);
    expect(out.map((s) => s.name)).toEqual(['Rebuttal', 'Flat']);
    expect(out[0]!.format).toEqual({ bold: true, color: 'C00000' });
    expect(out[1]!.format).toEqual({ italic: true, highlight: 'cyan', size: 11.5 });
  });

  it('drops invalid fields and lets superscript beat subscript', () => {
    const [s] = sanitizeCustomStyles([
      { name: 'X', format: { bold: 'yes', color: 'red', highlight: 'chartreuse', size: 0, font: '  ', superscript: true, subscript: true, nope: 1 } },
    ]);
    expect(s!.format).toEqual({ superscript: true });
  });

  it('mints unique ids and caps the list', () => {
    const out = sanitizeCustomStyles([{ name: 'A b' }, { name: 'A b' }, { name: 'A B', id: 'a-b' }]);
    expect(new Set(out.map((s) => s.id)).size).toBe(3);
    const many = sanitizeCustomStyles(Array.from({ length: 60 }, (_, i) => ({ name: `s${i}` })));
    expect(many).toHaveLength(MAX_CUSTOM_STYLES);
  });
});

describe('parseCustomStylesJson', () => {
  it('accepts a list or { styles }', () => {
    const a = parseCustomStylesJson('[{"name":"A","format":{"bold":true}}]');
    expect(a.ok && a.styles[0]!.format).toEqual({ bold: true });
    const b = parseCustomStylesJson('{"styles":[{"name":"B"}]}');
    expect(b.ok && b.styles).toHaveLength(1);
    expect(parseCustomStylesJson('[]')).toEqual({ ok: true, styles: [] });
  });

  it('explains what is wrong', () => {
    const bad = parseCustomStylesJson('[{"name":');
    expect(!bad.ok && bad.error).toMatch(/Not valid JSON/);
    const shape = parseCustomStylesJson('{"a":1}');
    expect(!shape.ok && shape.error).toMatch(/list of styles/);
    const none = parseCustomStylesJson('[{"format":{"bold":true}}]');
    expect(!none.ok && none.error).toMatch(/"name"/);
  });
});

describe('applying a custom style', () => {
  const rebuttal = style({ bold: true, color: 'C00000', highlight: 'yellow', size: 12 });

  it('builds the matching marks', () => {
    expect(marksForCustomStyle(rebuttal).map((m) => m.type.name)).toEqual([
      'bold',
      'font_color',
      'highlight',
      'font_size',
    ]);
    expect(marksForCustomStyle(rebuttal).find((m) => m.type.name === 'font_size')!.attrs['halfPoints']).toBe(24);
  });

  it('adds every mark over a selection, then strips them on the second run', () => {
    let state = stateWith('hello world', 1, 6);
    const add = customStyleTransaction(state, rebuttal)!;
    state = state.apply(add);
    expect(markNames(state, 3)).toEqual(expect.arrayContaining(['bold', 'font_color', 'highlight', 'font_size']));
    expect(markNames(state, 8)).toEqual([]); // outside the selection
    expect(isCustomStyleActive(state, rebuttal)).toBe(true);
    state = state.apply(customStyleTransaction(state, rebuttal)!);
    expect(markNames(state, 3)).toEqual([]);
  });

  it('adds (not removes) when only part of the selection has it', () => {
    let state = stateWith('hello world', 1, 6);
    state = state.apply(customStyleTransaction(state, style({ bold: true }))!);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 9)));
    expect(isCustomStyleActive(state, style({ bold: true }))).toBe(false);
    state = state.apply(customStyleTransaction(state, style({ bold: true }))!);
    expect(markNames(state, 8)).toContain('bold');
  });

  it('with a caret it arms the stored marks instead', () => {
    let state = stateWith('hello', 3);
    state = state.apply(customStyleTransaction(state, style({ italic: true }))!);
    expect(state.storedMarks?.map((m) => m.type.name)).toEqual(['italic']);
    expect(isCustomStyleActive(state, style({ italic: true }))).toBe(true);
    state = state.apply(customStyleTransaction(state, style({ italic: true }))!);
    expect(state.storedMarks).toEqual([]);
  });

  it('a style that sets nothing does nothing', () => {
    expect(customStyleTransaction(stateWith('x', 1, 2), style({}))).toBeNull();
  });
});

describe('user commands in the command pool', () => {
  it('registers, labels, runs and replaces', () => {
    let ran = 0;
    setUserCommands([{ id: 'custom-style.a', label: 'Style: A', run: () => void ran++ }]);
    expect(isPluginCommandId('custom-style.a')).toBe(true);
    expect(pluginCommandLabel('custom-style.a')).toBe('Style: A');
    expect(runPluginCommand('custom-style.a')).toBe(true);
    expect(ran).toBe(1);
    const removed = setUserCommands([{ id: 'custom-style.b', label: 'Style: B', run: () => {} }]);
    expect(removed).toEqual(['custom-style.a']);
    expect(pluginCommandIds()).toEqual(['custom-style.b']);
    expect(runPluginCommand('custom-style.a')).toBe(false);
  });

  it('fires the changed hook', async () => {
    const { onUserCommandsChanged } = await import('../../src/editor/plugin-registry.js');
    let fired = 0;
    onUserCommandsChanged(() => void fired++);
    setUserCommands([]);
    expect(fired).toBe(1);
  });

  it('the settings value survives the sanitizer round trip', () => {
    settings.set('customStyles', [{ id: 'x', name: 'X', format: { bold: true } }]);
    expect(settings.get('customStyles')).toEqual([{ id: 'x', name: 'X', format: { bold: true } }]);
  });
});
