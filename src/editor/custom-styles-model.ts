/**
 * Custom styles — data model: types, limits, sanitizing and the raw-JSON parse.
 * Kept free of the schema / ProseMirror so `settings.ts` can validate the
 * stored list without pulling the editor in; applying a style lives in
 * `custom-styles.ts`.
 *
 * User-defined character styles. Each is a named bundle of
 * formatting (bold, italic, a colour, a highlight, a font, a size…) applied to
 * the selection as ordinary direct marks, so they round-trip through .docx and
 * .cmir with no schema change. Defined in Settings → Editing → Custom styles
 * (a dropdown editor per style, or raw JSON for the whole list) and run like
 * any command: from the palette, a keybinding, or a custom ribbon button.
 *
 * Only direct-formatting marks that carry no structural invariant are offered:
 * underline and emphasis are the named Underline / Emphasis styles (they're
 * mutually exclusive, and body text can't carry a direct underline), so a
 * custom style that tried to set them would fight those rules.
 */

import { HIGHLIGHT_NAME_TO_HEX } from '../ooxml/highlight-colors.js';

export interface CustomStyleFormat {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  /** Text colour: six hex digits, no `#`. */
  color?: string;
  /** Highlight: an OOXML highlight name (`yellow`, `cyan`, `darkBlue`…). */
  highlight?: string;
  /** Font family name. */
  font?: string;
  /** Size in points (half-point steps). */
  size?: number;
}

export interface CustomStyle {
  /** Stable id; the command id is `custom-style.<id>`. */
  id: string;
  name: string;
  format: CustomStyleFormat;
}

export const MAX_CUSTOM_STYLES = 24;
export const CUSTOM_STYLE_COMMAND_PREFIX = 'custom-style.';
export const customStyleCommandId = (id: string): string => CUSTOM_STYLE_COMMAND_PREFIX + id;

/** Highlight names the editor offers, in picker order. */
export const CUSTOM_STYLE_HIGHLIGHTS: readonly string[] = Object.keys(HIGHLIGHT_NAME_TO_HEX);

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BOOLEAN_KEYS = ['bold', 'italic', 'strikethrough', 'superscript', 'subscript'] as const;

function canonicalHighlight(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const lower = v.trim().toLowerCase();
  return CUSTOM_STYLE_HIGHLIGHTS.find((n) => n.toLowerCase() === lower) ?? null;
}

/** Coerce anything into a well-formed format (unknown / invalid fields drop). */
export function sanitizeCustomStyleFormat(raw: unknown): CustomStyleFormat {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: CustomStyleFormat = {};
  for (const k of BOOLEAN_KEYS) if (r[k] === true) out[k] = true;
  // Super- and subscript exclude each other in the schema; the first wins.
  if (out.superscript && out.subscript) delete out.subscript;
  if (typeof r['color'] === 'string') {
    const hex = r['color'].trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(hex)) out.color = hex.toUpperCase();
  }
  const highlight = canonicalHighlight(r['highlight']);
  if (highlight) out.highlight = highlight;
  if (typeof r['font'] === 'string') {
    const font = r['font'].trim().slice(0, 64);
    if (font) out.font = font;
  }
  if (typeof r['size'] === 'number' && Number.isFinite(r['size'])) {
    const size = Math.round(r['size'] * 2) / 2;
    if (size >= 1 && size <= 200) out.size = size;
  }
  return out;
}

function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return s || 'style';
}

/** Coerce a stored / pasted value into a clean list: names trimmed (≤ 40
 *  chars, required), ids unique, the count capped. An item may keep its
 *  formatting under `format` or flat on the object itself. */
export function sanitizeCustomStyles(raw: unknown): CustomStyle[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomStyle[] = [];
  const usedIds = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_CUSTOM_STYLES) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o['name'] === 'string' ? o['name'].trim().slice(0, 40) : '';
    if (!name) continue;
    let id = typeof o['id'] === 'string' && ID_RE.test(o['id']) ? o['id'] : slug(name);
    if (usedIds.has(id)) {
      const base = id.slice(0, 36);
      let n = 2;
      while (usedIds.has(`${base}-${n}`)) n++;
      id = `${base}-${n}`;
    }
    usedIds.add(id);
    const format = sanitizeCustomStyleFormat(o['format'] && typeof o['format'] === 'object' ? o['format'] : o);
    out.push({ id, name, format });
  }
  return out;
}

/** Parse the raw-JSON editor's text: a list of styles, or `{ "styles": [...] }`. */
export function parseCustomStylesJson(
  text: string,
): { ok: true; styles: CustomStyle[] } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Not valid JSON — ${err instanceof Error ? err.message : String(err)}` };
  }
  const list = Array.isArray(data) ? data : (data as { styles?: unknown } | null)?.styles;
  if (!Array.isArray(list)) {
    return { ok: false, error: 'Expected a list of styles: [ { "name": "…", "format": { … } } ]' };
  }
  const styles = sanitizeCustomStyles(list);
  if (list.length > 0 && styles.length === 0) {
    return { ok: false, error: 'No valid styles found — every style needs a "name".' };
  }
  return { ok: true, styles };
}

