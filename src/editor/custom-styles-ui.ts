/**
 * Settings → Editing → Custom styles editor. One collapsed dropdown per style
 * (name + a live preview in the summary; the formatting controls open beneath),
 * plus an "Edit as JSON" mode that shows the whole list as raw JSON and applies
 * it on demand — for pasting styles between machines or writing several quickly.
 */

import { settings } from './settings.js';
import { setIcon } from './icons.js';
import {
  CUSTOM_STYLE_HIGHLIGHTS,
  MAX_CUSTOM_STYLES,
  parseCustomStylesJson,
  sanitizeCustomStyles,
  type CustomStyle,
  type CustomStyleFormat,
} from './custom-styles-model.js';
import { HIGHLIGHT_NAME_TO_HEX } from '../ooxml/highlight-colors.js';

const FLAGS: readonly { key: 'bold' | 'italic' | 'strikethrough' | 'superscript' | 'subscript'; label: string }[] = [
  { key: 'bold', label: 'Bold' },
  { key: 'italic', label: 'Italic' },
  { key: 'strikethrough', label: 'Strikethrough' },
  { key: 'superscript', label: 'Superscript' },
  { key: 'subscript', label: 'Subscript' },
];

/** Inline CSS that previews a format in the summary row. */
export function previewCss(f: CustomStyleFormat): string {
  const css: string[] = [];
  if (f.bold) css.push('font-weight:700');
  if (f.italic) css.push('font-style:italic');
  if (f.strikethrough) css.push('text-decoration:line-through');
  if (f.color) css.push(`color:#${f.color}`);
  if (f.highlight) {
    const hex = HIGHLIGHT_NAME_TO_HEX[f.highlight];
    if (hex) css.push(`background:#${hex}`, 'color:' + (f.color ? `#${f.color}` : '#000'));
  }
  if (f.font) css.push(`font-family:${JSON.stringify(f.font)},inherit`);
  if (f.size) css.push(`font-size:${Math.min(Math.max(f.size, 8), 22)}px`);
  if (f.superscript) css.push('vertical-align:super', 'font-size:0.8em');
  else if (f.subscript) css.push('vertical-align:sub', 'font-size:0.8em');
  return css.join(';');
}

function uniqueId(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'style';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function buildCustomStylesEditor(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pmd-cs-editor';

  const body = document.createElement('div');
  body.className = 'pmd-cs-body';
  const footer = document.createElement('div');
  footer.className = 'pmd-cs-footer';
  wrap.append(body, footer);

  const get = (): CustomStyle[] => settings.get('customStyles');
  let jsonMode = false;
  /** Styles whose dropdown the user has open — survives a re-render. */
  const open = new Set<string>();

  const commit = (styles: CustomStyle[], rerender: boolean): void => {
    settings.set('customStyles', sanitizeCustomStyles(styles) as never);
    if (rerender) render();
  };

  function renderStyle(style: CustomStyle, idx: number): HTMLElement {
    const details = document.createElement('details');
    details.className = 'pmd-cs-item';
    details.open = open.has(style.id);
    details.addEventListener('toggle', () => {
      if (details.open) open.add(style.id);
      else open.delete(style.id);
    });

    const summary = document.createElement('summary');
    summary.className = 'pmd-cs-summary';
    const nameEl = document.createElement('span');
    nameEl.className = 'pmd-cs-name';
    const sample = document.createElement('span');
    sample.className = 'pmd-cs-sample';
    sample.textContent = 'Sample text';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pmd-pairing-delete';
    setIcon(del, 'close');
    del.title = 'Remove style';
    del.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      open.delete(style.id);
      commit(get().filter((_, i) => i !== idx), true);
    });
    summary.append(nameEl, sample, del);
    details.appendChild(summary);

    const refresh = (s: CustomStyle): void => {
      nameEl.textContent = s.name;
      sample.style.cssText = previewCss(s.format);
    };
    refresh(style);

    // Work on a local copy; every control writes through `save`.
    let current: CustomStyle = { ...style, format: { ...style.format } };
    const save = (): void => {
      const list = get().map((s, i) => (i === idx ? current : s));
      commit(list, false);
      // Re-read what was stored (sanitizing may have normalised a field).
      current = get()[idx] ?? current;
      refresh(current);
    };

    const panel = document.createElement('div');
    panel.className = 'pmd-cs-panel';

    const row = (label: string, ...controls: HTMLElement[]): void => {
      const r = document.createElement('div');
      r.className = 'pmd-cs-row';
      const l = document.createElement('span');
      l.className = 'pmd-cs-label';
      l.textContent = label;
      const c = document.createElement('div');
      c.className = 'pmd-cs-controls';
      c.append(...controls);
      r.append(l, c);
      panel.appendChild(r);
    };

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'pmd-cs-input';
    nameInput.maxLength = 40;
    nameInput.value = style.name;
    nameInput.setAttribute('aria-label', 'Style name');
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim();
      if (!v) {
        nameInput.value = current.name;
        return;
      }
      current = { ...current, name: v };
      save();
    });
    row('Name', nameInput);

    const flags = FLAGS.map(({ key, label }) => {
      const lab = document.createElement('label');
      lab.className = 'pmd-cs-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = current.format[key] === true;
      cb.addEventListener('change', () => {
        const format = { ...current.format };
        if (cb.checked) format[key] = true;
        else delete format[key];
        // Super- and subscript exclude each other.
        if (cb.checked && key === 'superscript') delete format.subscript;
        if (cb.checked && key === 'subscript') delete format.superscript;
        current = { ...current, format };
        save();
        for (const other of flagBoxes) other.cb.checked = current.format[other.key] === true;
      });
      lab.append(cb, document.createTextNode(` ${label}`));
      return { key, cb, lab };
    });
    const flagBoxes = flags;
    row('Format', ...flags.map((f) => f.lab));

    // Text colour: an on/off box plus the picker, so "no colour" is expressible.
    const colorOn = document.createElement('input');
    colorOn.type = 'checkbox';
    colorOn.checked = !!current.format.color;
    const colorPick = document.createElement('input');
    colorPick.type = 'color';
    colorPick.className = 'pmd-cs-color';
    colorPick.value = `#${current.format.color ?? '000000'}`;
    colorPick.disabled = !colorOn.checked;
    const applyColor = (): void => {
      const format = { ...current.format };
      if (colorOn.checked) format.color = colorPick.value.replace('#', '').toUpperCase();
      else delete format.color;
      current = { ...current, format };
      colorPick.disabled = !colorOn.checked;
      save();
    };
    colorOn.addEventListener('change', applyColor);
    colorPick.addEventListener('change', applyColor);
    const colorLab = document.createElement('label');
    colorLab.className = 'pmd-cs-check';
    colorLab.append(colorOn, document.createTextNode(' Set'));
    row('Text colour', colorLab, colorPick);

    const hl = document.createElement('select');
    hl.className = 'pmd-cs-select';
    for (const name of ['', ...CUSTOM_STYLE_HIGHLIGHTS]) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name === '' ? 'None' : name;
      if ((current.format.highlight ?? '') === name) opt.selected = true;
      hl.appendChild(opt);
    }
    hl.addEventListener('change', () => {
      const format = { ...current.format };
      if (hl.value) format.highlight = hl.value;
      else delete format.highlight;
      current = { ...current, format };
      save();
    });
    row('Highlight', hl);

    const font = document.createElement('input');
    font.type = 'text';
    font.className = 'pmd-cs-input';
    font.placeholder = 'Leave blank to keep the current font';
    font.value = current.format.font ?? '';
    font.addEventListener('change', () => {
      const format = { ...current.format };
      const v = font.value.trim();
      if (v) format.font = v;
      else delete format.font;
      current = { ...current, format };
      save();
      font.value = current.format.font ?? '';
    });
    row('Font', font);

    const size = document.createElement('input');
    size.type = 'number';
    size.className = 'pmd-cs-input pmd-cs-size';
    size.min = '1';
    size.max = '200';
    size.step = '0.5';
    size.placeholder = 'pt';
    size.value = current.format.size != null ? String(current.format.size) : '';
    size.addEventListener('change', () => {
      const format = { ...current.format };
      const n = Number(size.value);
      if (size.value.trim() !== '' && Number.isFinite(n)) format.size = n;
      else delete format.size;
      current = { ...current, format };
      save();
      size.value = current.format.size != null ? String(current.format.size) : '';
    });
    row('Size', size, Object.assign(document.createElement('span'), { className: 'pmd-cs-unit', textContent: 'pt — blank keeps the current size' }));

    details.appendChild(panel);
    return details;
  }

  function renderBody(): void {
    body.replaceChildren();
    const styles = get();
    if (styles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pmd-pairing-empty';
      empty.textContent = 'No custom styles yet. Add one to get a “Style: …” command.';
      body.appendChild(empty);
    }
    styles.forEach((s, i) => body.appendChild(renderStyle(s, i)));
  }

  function renderJson(): void {
    body.replaceChildren();
    const ta = document.createElement('textarea');
    ta.className = 'pmd-cs-json';
    ta.spellcheck = false;
    ta.rows = 14;
    ta.value = JSON.stringify(get().map(({ id, name, format }) => ({ id, name, format })), null, 2);
    ta.setAttribute('aria-label', 'Custom styles as JSON');
    const hint = document.createElement('div');
    hint.className = 'pmd-cs-hint';
    hint.textContent =
      'A list of { "name", "format" }. Format keys: bold, italic, strikethrough, superscript, subscript (true), color ("C00000"), highlight ("yellow", "cyan", "darkBlue"…), font ("Calibri"), size (points). Unknown keys are dropped.';
    const err = document.createElement('div');
    err.className = 'pmd-cs-error';
    err.setAttribute('role', 'alert');
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'pmd-readers-add';
    apply.textContent = 'Apply JSON';
    apply.addEventListener('click', () => {
      const res = parseCustomStylesJson(ta.value);
      if (!res.ok) {
        err.textContent = res.error;
        return;
      }
      err.textContent = '';
      commit(res.styles, false);
      ta.value = JSON.stringify(get().map(({ id, name, format }) => ({ id, name, format })), null, 2);
      err.textContent = `Applied ${res.styles.length} style${res.styles.length === 1 ? '' : 's'}.`;
      err.classList.add('pmd-cs-ok');
    });
    ta.addEventListener('input', () => {
      err.textContent = '';
      err.classList.remove('pmd-cs-ok');
    });
    body.append(ta, hint, apply, err);
  }

  function renderFooter(): void {
    footer.replaceChildren();
    if (!jsonMode) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'pmd-readers-add';
      add.textContent = '+ Add style';
      add.disabled = get().length >= MAX_CUSTOM_STYLES;
      add.addEventListener('click', () => {
        const styles = get();
        if (styles.length >= MAX_CUSTOM_STYLES) return;
        const id = uniqueId('New style', new Set(styles.map((s) => s.id)));
        open.add(id);
        commit([...styles, { id, name: 'New style', format: { bold: true } }], true);
      });
      footer.appendChild(add);
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'pmd-readers-add';
    toggle.textContent = jsonMode ? 'Back to the editor' : 'Edit as JSON';
    toggle.addEventListener('click', () => {
      jsonMode = !jsonMode;
      render();
    });
    footer.appendChild(toggle);
  }

  function render(): void {
    if (jsonMode) renderJson();
    else renderBody();
    renderFooter();
  }

  render();
  return wrap;
}
