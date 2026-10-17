/**
 * Keyboard map: a picture of the keyboard for the Keyboard shortcuts screen.
 * Each key shows the command it runs on the current modifier layer (Command,
 * Option, Shift… switch the layer, by clicking them or by holding the real
 * keys). Everything is read from the live bindings — the built-in defaults
 * with the user's overrides on top, plus plugin commands and keyboard macros —
 * so a rebind shows up on the map straight away.
 */

import {
  DEFAULT_RIBBON_KEYS,
  RIBBON_COMMAND_IDS,
  commandLabelFor,
  effectivePluginDefaultKeys,
  isMacPlatform,
  type AnyCommandId,
} from './ribbon-commands.js';
import { RIBBON_GROUPS } from './ribbon-groups.js';
import { isRibbonCommandAvailable } from './ribbon-availability.js';
import { pluginCommandIds } from './plugin-registry.js';
import { settings } from './settings.js';
import { bindKeyToCommand, unbindKeyFromCommand, clearMacroKey } from './keybindings-editor.js';

export type MapMod = 'Mod' | 'Ctrl' | 'Alt' | 'Shift';

/** One key combination that runs something. */
export interface MapBinding {
  /** Command id, or `macro:<id>` for a keyboard macro. */
  id: string;
  label: string;
  /** The key string as stored (`Mod-Shift-8`). */
  raw: string;
  mods: MapMod[];
  /** Physical key name: lowercase letter, digit, symbol, `F4`, `ArrowUp`, `Space`… */
  base: string;
}

const MOD_ORDER: MapMod[] = ['Mod', 'Ctrl', 'Alt', 'Shift'];

/** Split a key string into its modifiers and the key. `~` is how the keymap
 *  spells Shift+` ; on a Mac, Mod+Tab is really Control+Tab (⌘Tab belongs to
 *  the OS), the same rule the key labels elsewhere in the app follow. */
export function parseKeyString(raw: string, mac: boolean): { mods: MapMod[]; base: string } | null {
  if (!raw) return null;
  if (raw === '~') return { mods: ['Shift'], base: '`' };
  const mods = new Set<MapMod>();
  let rest = raw;
  for (;;) {
    const m = /^(Mod|Ctrl|Alt|Shift)-(.+)$/.exec(rest);
    if (!m) break;
    mods.add(m[1] as MapMod);
    rest = m[2]!;
  }
  if (!rest) return null;
  const base = rest.length === 1 ? rest.toLowerCase() : rest;
  if (mac && base === 'Tab' && mods.has('Mod')) {
    mods.delete('Mod');
    mods.add('Ctrl');
  }
  return { mods: MOD_ORDER.filter((x) => mods.has(x)), base };
}

const layerKey = (mods: Iterable<MapMod>): string => {
  const s = new Set(mods);
  return MOD_ORDER.filter((m) => s.has(m)).join('+');
};

function resolvedKeys(id: AnyCommandId): string[] {
  const overrides = settings.get('ribbonKeyOverrides');
  if (!(id in (DEFAULT_RIBBON_KEYS as Record<string, unknown>))) {
    return effectivePluginDefaultKeys(id, overrides);
  }
  const spec =
    id in overrides
      ? overrides[id]!
      : ((DEFAULT_RIBBON_KEYS as Record<string, string | string[] | undefined>)[id] ?? []);
  return (Array.isArray(spec) ? spec : [spec]).filter((k): k is string => typeof k === 'string' && k !== '');
}

/** Every binding in force right now: built-in and plugin commands with the
 *  user's overrides applied, and keyboard macros. */
export function collectBindings(mac: boolean = isMacPlatform()): MapBinding[] {
  const out: MapBinding[] = [];
  const ids: AnyCommandId[] = [
    ...RIBBON_COMMAND_IDS.filter((id) => isRibbonCommandAvailable(id)),
    ...pluginCommandIds(),
  ];
  for (const id of ids) {
    for (const raw of resolvedKeys(id)) {
      const p = parseKeyString(raw, mac);
      if (p) out.push({ id, label: commandLabelFor(id), raw, ...p });
    }
  }
  for (const m of settings.get('keyboardMacros')) {
    const p = parseKeyString(m.key, mac);
    if (!p) continue;
    const text = m.text.replace(/\s+/g, ' ').trim();
    out.push({
      id: `macro:${m.id}`,
      label: `Types “${text.length > 28 ? text.slice(0, 27) + '…' : text}”`,
      raw: m.key,
      ...p,
    });
  }
  return out;
}

/** Short names for the key caps; anything not listed uses its full label. */
const SHORT: Record<string, string> = {
  Undo: 'Undo', Redo: 'Redo', 'Apply Pocket Style': 'Pocket', 'Apply Hat Style': 'Hat', 'Apply Block Style': 'Block',
  'Apply Tag Style': 'Tag', 'Apply Analytic Style': 'Analytic', 'Apply Undertag Style': 'Undertag',
  'Move Container Up': 'Move up', 'Move Container Down': 'Move down', Bold: 'Bold', Italic: 'Italic',
  Strikethrough: 'Strike', Superscript: 'Super', Subscript: 'Sub', 'Apply Cite Style': 'Cite',
  'Toggle Underline': 'Underline', 'Underline (toggle while typing)': 'Underline',
  'Reading-position marker (toggle)': 'Marker', 'Apply Emphasis Style': 'Emphasis', 'Emphasize Acronym': 'Emph. acro',
  'Highlight with Selected Color': 'Highlight', 'Highlight with White': 'White hl', 'Highlight Acronym': 'Hl acro',
  'Background Color': 'Background', Condense: 'Condense', 'Condense Without Paragraph Integrity': 'Condense*',
  'Condense Without Paragraph Integrity (With Pilcrows)': 'Cond. ¶', Uncondense: 'Uncondense', 'Toggle Case': 'Case',
  'Copy Previous Cite': 'Prev cite', 'Paste Plain Text': 'Paste text', Clear: 'Clear', 'Shrink Card Text': 'Shrink',
  'Smart Shrink (Deeper for Unmarked Paragraphs)': 'Smart shrink', 'Restore Card Text Size': 'Regrow',
  'Mark Card (Marked Doc / Unmark)': 'Mark card', 'Reload From Disk': 'Reload', 'Print…': 'Print',
  'Add Note to Selection': 'Note', 'Ask AI About Selection': 'Ask AI', 'Translate Selection to Clipboard (AI)': 'Translate',
  'Repair OCR/PDF Text (AI)': 'Repair OCR', 'Repair Formatting (AI)': 'Repair fmt', 'Toggle voice control': 'Voice',
  'Cut card with AI…': 'Cut card', 'Add / Remove Hyperlink': 'Link', 'Open File': 'Open', Save: 'Save', 'Save As…': 'Save as',
  'Save Send Doc': 'Send doc', 'Save Marked Cards': 'Marked doc', 'Send to Speech (At Cursor)': 'To speech',
  'Send to Speech (At End)': 'To speech end', 'Send to Dropzone': 'Dropzone', 'Insert Received Card (At Cursor)': 'Insert card',
  'Insert Received Card (At End)': 'Insert end', 'Select Current Heading': 'Select head', 'Search Everything': 'Search all',
  'Zoom In': 'Zoom in', 'Zoom Out': 'Zoom out', 'Chrome Scale Up': 'UI bigger', 'Chrome Scale Down': 'UI smaller',
  'Reset Chrome Scale to 100%': 'UI 100%', Find: 'Find', 'Find and Replace': 'Replace',
  'Find Without Category Grouping': 'Find flat', 'Open Settings': 'Settings', 'Minimize Window': 'Minimize',
  'Switch Window': 'Switch win', 'Focus Slot 1': 'Pane 1', 'Focus Slot 2': 'Pane 2', 'Focus Slot 3': 'Pane 3',
  'Send Doc to Slot 1': 'Send → 1', 'Send Doc to Slot 2': 'Send → 2', 'Send Doc to Slot 3': 'Send → 3',
  'Toggle Slot Expand / Restore': 'Expand pane', 'Close Doc or Window': 'Close',
};
export const shortLabel = (label: string): string => SHORT[label] ?? label;

type KeySpec = [legend: string, width: number, id: string | null];

const FN_ROW: KeySpec[] = [['esc', 1.2, 'Escape'], ...Array.from({ length: 12 }, (_, i): KeySpec => [`F${i + 1}`, 1, `F${i + 1}`])];
const ROWS: (KeySpec[] | 'BOTTOM')[] = [
  FN_ROW,
  [['`', 1, '`'], ...[...'1234567890'].map((d): KeySpec => [d, 1, d]), ['-', 1, '-'], ['=', 1, '='], ['delete', 1.6, 'Backspace']],
  [['tab', 1.5, 'Tab'], ...[...'qwertyuiop'].map((d): KeySpec => [d, 1, d]), ['[', 1, '['], [']', 1, ']'], ['\\', 1.1, '\\']],
  [['caps', 1.8, null], ...[...'asdfghjkl'].map((d): KeySpec => [d, 1, d]), [';', 1, ';'], ["'", 1, "'"], ['return', 2.2, 'Enter']],
  [['shift', 2.3, 'MOD:Shift'], ...[...'zxcvbnm'].map((d): KeySpec => [d, 1, d]), [',', 1, ','], ['.', 1, '.'], ['/', 1, '/'], ['shift', 2.7, 'MOD:Shift']],
  'BOTTOM',
];

function bottomRow(mac: boolean): KeySpec[] {
  return mac
    ? [['fn', 1.1, null], ['control', 1.3, 'MOD:Ctrl'], ['option', 1.3, 'MOD:Alt'], ['command', 1.5, 'MOD:Mod'], ['space', 5.4, 'Space'],
       ['command', 1.5, 'MOD:Mod'], ['option', 1.3, 'MOD:Alt'], ['ARROWS', 3, null]]
    : [['ctrl', 1.4, 'MOD:Mod'], ['win', 1.2, null], ['alt', 1.3, 'MOD:Alt'], ['space', 6, 'Space'], ['alt', 1.3, 'MOD:Alt'],
       ['ctrl', 1.4, 'MOD:Mod'], ['ARROWS', 3, null]];
}

const ARROWS: [string, string][] = [['←', 'ArrowLeft'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['→', 'ArrowRight']];

function modSymbol(m: MapMod, mac: boolean): string {
  return { Mod: mac ? '⌘' : 'Ctrl', Ctrl: mac ? '⌃' : 'Ctrl', Alt: mac ? '⌥' : 'Alt', Shift: mac ? '⇧' : 'Shift' }[m];
}
function modWord(m: MapMod, mac: boolean): string {
  return { Mod: mac ? 'command' : 'ctrl', Ctrl: 'control', Alt: mac ? 'option' : 'alt', Shift: 'shift' }[m];
}
const baseDisplay = (b: string): string =>
  b.length === 1 ? b.toUpperCase() : b === 'Backspace' ? 'Delete' : b.replace('Arrow', '');

/** The key combination as people say it: `⌘ ⇧ 8` on a Mac, `Ctrl+Shift+8` elsewhere. */
export function comboDisplay(mods: MapMod[], base: string, mac: boolean): string {
  const parts = [...mods.map((m) => modSymbol(m, mac)), baseDisplay(base)];
  return mac ? parts.join(' ') : parts.join('+');
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export interface KeyboardMapHandle {
  el: HTMLElement;
  /** Redraw from the current bindings (call after settings change). */
  refresh(): void;
  destroy(): void;
}

export function buildKeyboardMap(): KeyboardMapHandle {
  const mac = isMacPlatform();
  const root = el('div', 'pmd-kbmap');
  const layerBar = el('div', 'pmd-kbmap-layer');
  const board = el('div', 'pmd-kbmap-board');
  const detail = el('div', 'pmd-kbmap-detail');
  root.append(layerBar, el('div', 'pmd-kbmap-boardwrap'), detail);
  root.children[1]!.append(board);

  const layerMods: MapMod[] = mac ? ['Mod', 'Ctrl', 'Alt', 'Shift'] : ['Mod', 'Alt', 'Shift'];
  const state = {
    mods: new Set<MapMod>(['Mod']),
    held: null as Set<MapMod> | null,
    sel: '8',
    note: '',
  };
  let by = new Map<string, MapBinding[]>();
  let all: MapBinding[] = [];

  const build = (): void => {
    all = collectBindings(mac);
    by = new Map();
    for (const b of all) {
      const k = `${layerKey(b.mods)}|${b.base}`;
      by.set(k, [...(by.get(k) ?? []), b]);
    }
  };
  const active = (): Set<MapMod> => state.held ?? state.mods;
  const lookup = (mods: Iterable<MapMod>, base: string): MapBinding[] => by.get(`${layerKey(mods)}|${base}`) ?? [];

  const toggle = (m: MapMod): void => {
    state.held = null;
    if (state.mods.has(m)) state.mods.delete(m);
    else state.mods.add(m);
    state.note = '';
    draw();
  };

  const makeKey = (legend: string, width: number, id: string | null, small: boolean): HTMLElement => {
    const mods = active();
    const k = el('button', `pmd-kbmap-key${small ? ' pmd-kbmap-key-fn' : ''}`);
    k.type = 'button';
    k.style.setProperty('--w', String(width));
    if (id?.startsWith('MOD:')) {
      const m = id.slice(4) as MapMod;
      k.classList.add('pmd-kbmap-mod');
      if (mac) k.append(el('span', 'pmd-kbmap-sym', modSymbol(m, mac)));
      k.append(el('span', 'pmd-kbmap-lg', modWord(m, mac)));
      k.setAttribute('aria-pressed', String(mods.has(m)));
      k.onclick = () => toggle(m);
      return k;
    }
    k.append(el('span', 'pmd-kbmap-lg', legend.length === 1 ? legend.toUpperCase() : legend));
    if (!id) {
      k.disabled = true;
      k.classList.add('pmd-kbmap-inert');
      return k;
    }
    const list = lookup(mods, id);
    if (list.length) {
      k.classList.add('pmd-kbmap-bound');
      k.append(el('span', 'pmd-kbmap-cmd', shortLabel(list[0]!.label)));
      if (list.length > 1) k.append(el('span', 'pmd-kbmap-bang', '!'));
    } else if (all.some((b) => b.base === id && layerKey(b.mods) !== layerKey(mods))) {
      k.append(el('span', 'pmd-kbmap-other'));
    }
    if (state.sel === id) k.classList.add('pmd-kbmap-here');
    k.onclick = () => {
      state.sel = id;
      state.note = '';
      draw();
    };
    return k;
  };

  function draw(): void {
    const mods = active();
    layerBar.replaceChildren(el('span', 'pmd-kbmap-layerlabel', 'Hold'));
    for (const m of layerMods) {
      const b = el('button', 'pmd-kbmap-pill', mac ? `${modSymbol(m, mac)} ${modWord(m, mac)}` : modWord(m, mac));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(mods.has(m)));
      b.onclick = () => toggle(m);
      layerBar.append(b);
    }
    board.replaceChildren();
    let bound = 0;
    let free = 0;
    for (const [i, row] of ROWS.entries()) {
      const r = el('div', 'pmd-kbmap-row');
      for (const [legend, w, id] of row === 'BOTTOM' ? bottomRow(mac) : row) {
        if (legend === 'ARROWS') {
          const a = el('div', 'pmd-kbmap-arrows');
          for (const [sym, aid] of ARROWS) a.append(makeKey(sym, 1, aid, false));
          r.append(a);
          continue;
        }
        r.append(makeKey(legend, w, id, i === 0));
        if (id && !id.startsWith('MOD:') && /^(?:[a-z0-9`\-=[\]\\;',./]|F\d+)$/.test(id)) {
          lookup(mods, id).length ? bound++ : free++;
        }
      }
      board.append(r);
    }
    layerBar.append(el('span', 'pmd-kbmap-stat', `${bound} keys in use · ${free} free on this layer`));
    drawDetail();
  }

  function drawDetail(): void {
    const mods = active();
    const here = lookup(mods, state.sel);
    detail.replaceChildren();
    const left = el('div', 'pmd-kbmap-detail-main');
    left.append(el('div', 'pmd-kbmap-combo', comboDisplay([...MOD_ORDER.filter((m) => mods.has(m))], state.sel, mac)));
    if (here.length) {
      left.append(el('h3', 'pmd-kbmap-title', here[0]!.label));
      if (here.length > 1) {
        left.append(
          el('div', 'pmd-kbmap-warn', `Conflict: ${here.map((h) => h.label).join(' and ')} share this key. Only one runs.`),
        );
      }
    } else {
      left.append(el('h3', 'pmd-kbmap-title', 'Free'), el('div', 'pmd-kbmap-sub', 'Nothing uses this key on this layer.'));
    }
    if (state.note) left.append(el('div', 'pmd-kbmap-sub', state.note));
    detail.append(left);

    const actions = el('div', 'pmd-kbmap-actions');
    if (here.length) {
      const rm = el('button', 'pmd-kbmap-btn', 'Remove');
      rm.type = 'button';
      rm.onclick = () => {
        // The note goes first: changing a binding redraws the map right away.
        state.note = `Removed ${comboDisplay([...MOD_ORDER.filter((m) => mods.has(m))], state.sel, mac)}.`;
        for (const h of here) {
          if (h.id.startsWith('macro:')) clearMacroKey(h.id.slice(6));
          else unbindKeyFromCommand(h.id as AnyCommandId, h.raw);
        }
      };
      actions.append(rm);
    } else {
      actions.append(buildBindPicker(mods));
    }
    detail.append(actions);

    // The same key on other layers, so every use of it is in one place.
    const others = all.filter((b) => b.base === state.sel && layerKey(b.mods) !== layerKey(mods));
    if (others.length) {
      const ul = el('ul', 'pmd-kbmap-others');
      for (const b of others) {
        const li = el('li');
        li.append(el('span', 'pmd-kbmap-kc', comboDisplay(b.mods, b.base, mac)), el('span', undefined, b.label));
        ul.append(li);
      }
      detail.append(ul);
    }
  }

  /** "Bind a command" for a free key: one dropdown, grouped like the keybindings editor. */
  function buildBindPicker(mods: Set<MapMod>): HTMLElement {
    const wrap = el('label', 'pmd-kbmap-bind');
    wrap.append(el('span', undefined, 'Use this key for'));
    const sel = el('select', 'pmd-kbmap-select');
    sel.append(Object.assign(el('option', undefined, 'Choose a command…'), { value: '' }));
    for (const g of RIBBON_GROUPS) {
      const ids = g.commands.filter(isRibbonCommandAvailable);
      if (!ids.length) continue;
      const og = el('optgroup');
      og.label = g.title;
      for (const id of ids) og.append(Object.assign(el('option', undefined, commandLabelFor(id)), { value: id }));
      sel.append(og);
    }
    sel.onchange = () => {
      if (!sel.value) return;
      const raw = [...MOD_ORDER.filter((m) => mods.has(m)), state.sel].join('-');
      state.note = `Bound ${comboDisplay([...MOD_ORDER.filter((m) => mods.has(m))], state.sel, mac)} to ${commandLabelFor(sel.value as AnyCommandId)}.`;
      const res = bindKeyToCommand(sel.value as AnyCommandId, raw);
      if ('error' in res) {
        state.note = res.error;
        sel.value = '';
        drawDetail();
      }
    };
    wrap.append(sel);
    return wrap;
  }

  // Holding the real modifier keys previews that layer.
  const heldMods = (e: KeyboardEvent): Set<MapMod> => {
    const m = new Set<MapMod>();
    if (mac) {
      if (e.metaKey) m.add('Mod');
      if (e.ctrlKey) m.add('Ctrl');
    } else if (e.ctrlKey || e.metaKey) m.add('Mod');
    if (e.altKey) m.add('Alt');
    if (e.shiftKey) m.add('Shift');
    return m;
  };
  const onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
    const m = heldMods(e);
    const next = m.size ? m : null;
    if (!state.held && !next) return;
    state.held = next;
    draw();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  let lastOverrides = settings.get('ribbonKeyOverrides');
  let lastMacros = settings.get('keyboardMacros');
  const handle: KeyboardMapHandle = {
    el: root,
    refresh() {
      build();
      draw();
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      unsubscribe();
    },
  };
  const unsubscribe = settings.subscribe((s) => {
    if (s.ribbonKeyOverrides !== lastOverrides || s.keyboardMacros !== lastMacros) {
      lastOverrides = s.ribbonKeyOverrides;
      lastMacros = s.keyboardMacros;
      handle.refresh();
    }
  });
  handle.refresh();
  return handle;
}
