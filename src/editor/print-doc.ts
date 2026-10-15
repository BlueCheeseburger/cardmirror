/**
 * Printing the active document through the OS / browser print dialog.
 *
 * The live editor sits inside fixed-height scrollers, panes and a ribbon,
 * none of which paginate. Instead of unwinding that layout, printing builds
 * a throwaway copy of the document's rendered DOM (decorations, card
 * numbers and read mode's hidden text all included, so the paper matches
 * the screen) in a `#pmd-print-root` element and lets the `@media print`
 * rules in style.css hide everything else. The copy is removed again once
 * the print dialog closes.
 */

import type { EditorView } from 'prosemirror-view';

const ROOT_ID = 'pmd-print-root';
const PRINTING_CLASS = 'pmd-printing';
const THEME_ATTRS = ['data-theme', 'data-theme-doc'] as const;

/** Classes on the editor's host element that change how the content
 *  renders (hidden text in read mode); anything else is layout. */
const CARRIED_HOST_CLASSES = ['pmd-read-mode'];

interface Prepared {
  root: HTMLElement;
  savedTheme: Array<[string, string | null]>;
}

let current: Prepared | null = null;

/** Classes ProseMirror puts on the live editor that mean "being edited". */
const EDITING_CLASSES = ['ProseMirror-focused', 'ProseMirror-hideselection', 'ProseMirror-selectednode'];

/** Copy of the editor's rendered content, stripped of editing state. */
export function buildPrintContent(view: EditorView): HTMLElement {
  const source = view.dom as HTMLElement;
  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute('contenteditable');
  clone.removeAttribute('id');
  clone.removeAttribute('tabindex');
  clone.removeAttribute('spellcheck');
  for (const cls of EDITING_CLASSES) {
    clone.classList.remove(cls);
    for (const el of clone.querySelectorAll(`.${cls}`)) el.classList.remove(cls);
  }
  for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id');
  for (const el of clone.querySelectorAll('[contenteditable]')) el.removeAttribute('contenteditable');
  for (const el of clone.querySelectorAll('.ProseMirror-gapcursor, .ProseMirror-separator, .ProseMirror-trailingBreak')) {
    el.remove();
  }

  const wrap = document.createElement('div');
  wrap.classList.add('pmd-pane-editor', 'pmd-print-doc');
  const host = source.parentElement;
  for (const cls of CARRIED_HOST_CLASSES) {
    if (host?.classList.contains(cls)) wrap.classList.add(cls);
  }
  wrap.appendChild(clone);
  return wrap;
}

/** True when the copy has nothing visible to print (an empty document, or
 *  read mode with nothing highlighted). */
export function isPrintContentEmpty(content: HTMLElement): boolean {
  if (content.querySelector('img, table, canvas, svg')) return false;
  const clone = content.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('.pmd-rm-hide')) el.remove();
  return (clone.textContent ?? '').trim().length === 0;
}

/** Every rule of every stylesheet on the page as one string, with relative
 *  `url(...)`s made absolute so they still resolve from another document. */
function collectCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet we can't read
    }
    const base = sheet.href ?? document.baseURI;
    for (const rule of Array.from(rules)) {
      out.push(
        rule.cssText.replace(/url\((['"]?)(?!data:|https?:|file:|blob:|#)([^)'"]+)\1\)/gu, (m, q: string, u: string) => {
          try {
            return `url(${q}${new URL(u, base).href}${q})`;
          } catch {
            return m;
          }
        }),
      );
    }
  }
  return out.join('\n');
}

function escapeAttr(v: string): string {
  return v.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');
}
function escapeText(v: string): string {
  return v.replace(/&/gu, '&amp;').replace(/</gu, '&lt;');
}

/** A complete, self-contained HTML page holding just the print copy of `view`
 *  and the app's stylesheets, with no theme attribute — so it is the light
 *  palette by construction. Desktop prints this in a hidden window, which means
 *  the live window is never touched (no flip to light while the dialog is
 *  open). Null when there is nothing visible to print. */
export function buildPrintHtml(view: EditorView, title = 'CardMirror'): string | null {
  const content = buildPrintContent(view);
  if (isPrintContentEmpty(content)) return null;
  // The page's own `<html>` attributes carry the display settings the content
  // rules key off (typography classes, CSS variables in `style`) — all except
  // the theme.
  const html = document.documentElement;
  const attrs = html
    .getAttributeNames()
    .filter((n) => !(THEME_ATTRS as readonly string[]).includes(n))
    .map((n) => {
      let v = html.getAttribute(n) ?? '';
      if (n === 'class') v = v.split(/\s+/u).filter((c) => c && c !== PRINTING_CLASS).join(' ');
      return ` ${n}="${escapeAttr(v)}"`;
    })
    .filter((a) => !a.startsWith(' class='))
    .join('');
  // The `@media print` rules key off `html.pmd-printing`; keep the page's other
  // classes (typography toggles) beside it.
  const classes = [...html.classList].filter((c) => c !== PRINTING_CLASS);
  classes.push(PRINTING_CLASS);
  const classAttr = ` class="${escapeAttr(classes.join(' '))}"`;
  return (
    `<!doctype html><html${attrs}${classAttr}><head><meta charset="utf-8">` +
    `<title>${escapeText(title)}</title><style>${collectCss()}</style></head>` +
    `<body><div id="${ROOT_ID}">${content.outerHTML}</div></body></html>`
  );
}

function prepare(view: EditorView): 'empty' | 'ok' {
  cleanup();
  const content = buildPrintContent(view);
  if (isPrintContentEmpty(content)) return 'empty';
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.appendChild(content);
  document.body.appendChild(root);

  // Paper is white: print a dark document on its light palette.
  const html = document.documentElement;
  const savedTheme: Array<[string, string | null]> = [];
  for (const attr of THEME_ATTRS) {
    savedTheme.push([attr, html.getAttribute(attr)]);
    html.removeAttribute(attr);
  }
  html.classList.add(PRINTING_CLASS);
  current = { root, savedTheme };
  return 'ok';
}

/** Remove the print copy and restore the theme. Safe to call repeatedly. */
export function cleanup(): void {
  const prepared = current;
  current = null;
  const html = document.documentElement;
  html.classList.remove(PRINTING_CLASS);
  if (!prepared) return;
  prepared.root.remove();
  for (const [attr, value] of prepared.savedTheme) {
    if (value === null) html.removeAttribute(attr);
    else html.setAttribute(attr, value);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export interface PrintOptions {
  /** Desktop: hand a self-contained HTML page of the document to the main
   *  process, which prints it from a hidden window through the OS dialog. The
   *  live window is not touched. */
  printHtml?: (html: string) => Promise<unknown>;
  /** Names the printed page (the PDF's default file name). */
  title?: string;
  /** Older desktop shells: print the live window's own page through the OS
   *  dialog (swaps the page for the print copy while the dialog is open). */
  nativePrint?: () => Promise<unknown>;
}

/** Print the document in `view`. Resolves 'empty' without opening a dialog
 *  when there is nothing visible to print. */
export async function printDocument(view: EditorView, opts: PrintOptions = {}): Promise<'printed' | 'empty'> {
  if (opts.printHtml) {
    const html = buildPrintHtml(view, opts.title);
    if (html === null) return 'empty';
    await opts.printHtml(html);
    return 'printed';
  }
  if (prepare(view) === 'empty') return 'empty';
  try {
    // Let the copy lay out before the print engine snapshots the page.
    await nextFrame();
    await nextFrame();
    if (opts.nativePrint) await opts.nativePrint();
    else window.print();
  } finally {
    cleanup();
  }
  return 'printed';
}

/** Browser File → Print (or Ctrl+P, where the page doesn't claim it) bypasses
 *  the command, so build and tear down the same copy around those events. */
export function installPrintListeners(getView: () => EditorView | null): void {
  window.addEventListener('beforeprint', () => {
    if (current) return;
    const view = getView();
    if (view) prepare(view);
  });
  window.addEventListener('afterprint', () => cleanup());
}
