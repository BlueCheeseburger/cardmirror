// @vitest-environment jsdom
/**
 * The keyboard map on the Keyboard shortcuts screen: key-string parsing, the
 * live binding list (defaults + the user's overrides), and rebinding from the
 * map itself.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { parseKeyString, collectBindings, buildKeyboardMap, comboDisplay } from '../../src/editor/keyboard-map.js';
import { settings } from '../../src/editor/settings.js';

const keyEl = (root: HTMLElement, legend: string): HTMLElement => {
  const k = [...root.querySelectorAll<HTMLElement>('.pmd-kbmap-key')].find(
    (e) => e.querySelector('.pmd-kbmap-lg')?.textContent === legend,
  );
  if (!k) throw new Error(`no key ${legend}`);
  return k;
};

beforeEach(() => {
  settings.set('ribbonKeyOverrides', {});
  settings.set('keyboardMacros', []);
});
afterEach(() => {
  document.body.innerHTML = '';
  settings.set('ribbonKeyOverrides', {});
  settings.set('keyboardMacros', []);
});

describe('parseKeyString', () => {
  it('splits modifiers from the key', () => {
    expect(parseKeyString('Mod-Shift-8', false)).toEqual({ mods: ['Mod', 'Shift'], base: '8' });
    expect(parseKeyString('Mod-Alt-ArrowUp', false)).toEqual({ mods: ['Mod', 'Alt'], base: 'ArrowUp' });
    expect(parseKeyString('F3', false)).toEqual({ mods: [], base: 'F3' });
    expect(parseKeyString('Mod-Alt-F3', false)).toEqual({ mods: ['Mod', 'Alt'], base: 'F3' });
  });
  it('handles symbol keys, the shifted backquote, and case', () => {
    expect(parseKeyString('Mod--', false)).toEqual({ mods: ['Mod'], base: '-' });
    expect(parseKeyString('Mod-=', false)).toEqual({ mods: ['Mod'], base: '=' });
    expect(parseKeyString('~', false)).toEqual({ mods: ['Shift'], base: '`' });
    expect(parseKeyString('Alt-Shift-V', false)).toEqual({ mods: ['Alt', 'Shift'], base: 'v' });
  });
  it('treats Mod+Tab as Control on a Mac', () => {
    expect(parseKeyString('Mod-Tab', true)).toEqual({ mods: ['Ctrl'], base: 'Tab' });
    expect(parseKeyString('Mod-Tab', false)).toEqual({ mods: ['Mod'], base: 'Tab' });
  });
  it('spells combos per platform', () => {
    expect(comboDisplay(['Mod', 'Shift'], '8', true)).toBe('⌘ ⇧ 8');
    expect(comboDisplay(['Mod', 'Shift'], '8', false)).toBe('Ctrl+Shift+8');
  });
});

describe('collectBindings', () => {
  it('includes the defaults and applies overrides', () => {
    const has = (k: string, id: string) => collectBindings(false).some((b) => b.raw === k && b.id === id);
    expect(has('Mod-b', 'toggleBold')).toBe(true);
    settings.set('ribbonKeyOverrides', { toggleBold: 'Mod-Alt-j' });
    expect(has('Mod-b', 'toggleBold')).toBe(false);
    expect(has('Mod-Alt-j', 'toggleBold')).toBe(true);
  });
  it('an explicitly unbound command has no keys', () => {
    settings.set('ribbonKeyOverrides', { toggleBold: [] });
    expect(collectBindings(false).some((b) => b.id === 'toggleBold')).toBe(false);
  });
  it('lists keyboard macros', () => {
    settings.set('keyboardMacros', [{ id: 'm1', key: 'Mod-Shift-q', text: 'Extend the card' }]);
    expect(collectBindings(false).some((b) => b.id === 'macro:m1' && b.label.includes('Extend the card'))).toBe(true);
  });
});

describe('the map', () => {
  it('shows the command on the key for the active layer', () => {
    const map = buildKeyboardMap();
    document.body.append(map.el);
    // starts on the main-modifier layer
    expect(keyEl(map.el, 'B').textContent).toContain('Bold');
    map.destroy();
  });

  it('updates when a keybinding changes', () => {
    const map = buildKeyboardMap();
    document.body.append(map.el);
    expect(keyEl(map.el, 'J').classList.contains('pmd-kbmap-bound')).toBe(false);
    settings.set('ribbonKeyOverrides', { toggleBold: 'Mod-j' });
    expect(keyEl(map.el, 'J').textContent).toContain('Bold');
    expect(keyEl(map.el, 'B').classList.contains('pmd-kbmap-bound')).toBe(false);
    map.destroy();
  });

  it('flags two commands on one key', () => {
    const map = buildKeyboardMap();
    document.body.append(map.el);
    settings.set('ribbonKeyOverrides', { toggleItalic: 'Mod-b' });
    expect(keyEl(map.el, 'B').querySelector('.pmd-kbmap-bang')).not.toBeNull();
    keyEl(map.el, 'B').click();
    expect(map.el.querySelector('.pmd-kbmap-warn')?.textContent).toMatch(/Conflict/);
    map.destroy();
  });

  it('clicking a modifier switches the layer', () => {
    const map = buildKeyboardMap();
    document.body.append(map.el);
    keyEl(map.el, 'shift').click(); // adds Shift to the main modifier: Mod+Shift
    expect(keyEl(map.el, '8').textContent).toContain('Regrow');
    map.destroy();
  });

  it('binds a free key from the picker and removes it again', () => {
    const map = buildKeyboardMap();
    document.body.append(map.el);
    keyEl(map.el, 'J').click();
    const select = map.el.querySelector<HTMLSelectElement>('.pmd-kbmap-select')!;
    select.value = 'toggleItalic';
    select.dispatchEvent(new Event('change'));
    expect(settings.get('ribbonKeyOverrides')['toggleItalic']).toContain('Mod-j');
    expect(keyEl(map.el, 'J').textContent).toContain('Italic');
    [...map.el.querySelectorAll<HTMLButtonElement>('.pmd-kbmap-btn')].find((b) => b.textContent === 'Remove')!.click();
    expect(keyEl(map.el, 'J').classList.contains('pmd-kbmap-bound')).toBe(false);
    map.destroy();
  });

  it('refuses a bare single-character binding', () => {
    const map = buildKeyboardMap();
    document.body.append(map.el);
    keyEl(map.el, 'shift').click();
    keyEl(map.el, 'ctrl').click(); // drop Mod: the layer is now just Shift
    keyEl(map.el, 'J').click();
    const select = map.el.querySelector<HTMLSelectElement>('.pmd-kbmap-select')!;
    select.value = 'toggleItalic';
    select.dispatchEvent(new Event('change'));
    expect(map.el.textContent).toMatch(/Single-character keys must include/);
    map.destroy();
  });
});
