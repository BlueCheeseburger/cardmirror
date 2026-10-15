/**
 * OOXML highlight names (`ST_HighlightColor`, the `w:highlight` values and
 * the `highlight` mark's `color`) and the RGB each one paints, uppercase hex
 * without a leading "#". Shared by the importer, which uses it to spot a
 * shading fill that merely repeats a run's highlight.
 */
export const HIGHLIGHT_NAME_TO_HEX: Readonly<Record<string, string>> = {
  yellow: 'FFFF00',
  green: '00FF00',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  blue: '0000FF',
  red: 'FF0000',
  darkBlue: '000080',
  darkCyan: '008080',
  darkGreen: '008000',
  darkMagenta: '800080',
  darkRed: '800000',
  darkYellow: '808000',
  darkGray: '808080',
  lightGray: 'C0C0C0',
  black: '000000',
  white: 'FFFFFF',
};

/** The hex a highlight name paints, or null for an unknown name / `none`.
 *  Matches the name case-insensitively (`Cyan`, `darkblue`). */
export function highlightNameToHex(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [known, hex] of Object.entries(HIGHLIGHT_NAME_TO_HEX)) {
    if (known.toLowerCase() === lower) return hex;
  }
  return null;
}
