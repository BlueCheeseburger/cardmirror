/**
 * Right-click context menu for `link` marks: Open Link, Copy Link
 * Address, Edit Link…, Remove Link. Open Link routes through
 * `ElectronHost.openExternal` on desktop so URLs open in the OS
 * browser rather than a new BrowserWindow; the web build uses
 * `window.open` with `noopener,noreferrer`. Edit/Remove operate on
 * the full contiguous run carrying the clicked mark.
 *
 * Non-link right-clicks fall through (the image context menu wins
 * for image elements; everything else keeps the browser default).
 * Styling reuses `.pmd-nav-context-menu` to match the nav-pane and
 * image context menus.
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { schema } from '../schema/index.js';
import { promptForText, promptForLink } from './text-prompt.js';
import { showToast } from './toast.js';
import { writeClipboardText } from './clipboard-write.js';
import { getElectronHost } from './host/index.js';
import { positionFloatingMenu } from './context-menu-position.js';

export const linkContextMenuPlugin: Plugin = new Plugin({
  props: {
    handleDOMEvents: {
      contextmenu(view, event) {
        const target = event.target as HTMLElement | null;
        if (!target) return false;
        // The link mark's toDOM produces a bare `<a href="…">`, so
        // any contextmenu event whose target is inside an `<a>`
        // descendant of the editor is on a link.
        const anchor = target.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return false;
        if (!view.dom.contains(anchor)) return false;

        const hit = findLinkAt(view, event.clientX, event.clientY);
        if (!hit) return false;

        event.preventDefault();
        showLinkContextMenu(event.clientX, event.clientY, view, hit);
        return true;
      },
    },
  },
});

interface LinkHit {
  href: string;
  /** Start position of the contiguous run carrying THIS link mark. */
  from: number;
  /** End position of the same run. */
  to: number;
  mark: Mark;
}

/** Locate the link mark covering a doc position (e.g. a collapsed cursor).
 *  Walks the doc from `pos` outward to find the contiguous range of the
 *  same `link` mark instance — replace / remove operate on that whole
 *  range. Returns null when `pos` isn't inside a link. Shared by
 *  `findLinkAt` (mouse click, resolves coords to a position first) and
 *  the Ctrl/Cmd+K shortcut (collapsed cursor, already has a position). */
function findLinkRunAtPos(doc: PMNode, pos: number): LinkHit | null {
  const linkType = schema.marks['link'];
  if (!linkType) return null;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  const beforeMarks = $pos.nodeBefore?.marks ?? [];
  const afterMarks = $pos.nodeAfter?.marks ?? [];
  const linkBefore = beforeMarks.find((m) => m.type === linkType);
  const linkAfter = afterMarks.find((m) => m.type === linkType);
  const mark = linkAfter ?? linkBefore;
  if (!mark) return null;
  const href = String(mark.attrs['href'] ?? '');
  if (!href) return null;

  // Walk outward from the cursor position to find the full run
  // sharing this exact link-mark instance. Marks compare equal
  // (`mark.eq(other)`) when type + attrs match, so multiple
  // adjacent runs with the same href are treated as one link.
  const startSearch = linkAfter ? $pos.pos : $pos.pos - ($pos.nodeBefore?.nodeSize ?? 0);
  let from = startSearch;
  let to = startSearch;
  doc.descendants((node, nodePos) => {
    if (!node.isInline) return true;
    const has = node.marks.some((m) => m.eq(mark));
    if (!has) return false;
    const end = nodePos + node.nodeSize;
    if (nodePos <= startSearch && end >= startSearch) {
      from = nodePos;
      to = end;
    } else if (nodePos === to) {
      to = end;
    } else if (end === from) {
      from = nodePos;
    }
    return false;
  });
  // Final pass to extend `from` / `to` across consecutive runs
  // sharing the mark (the single-pass descendants above misses
  // long chains because each iteration only checks against the
  // anchor, not against running bounds).
  for (let p = from - 1; p > 0; p--) {
    const n = doc.nodeAt(p);
    if (!n || !n.isInline) break;
    if (!n.marks.some((m) => m.eq(mark))) break;
    from = p;
  }
  for (let p = to; p < doc.content.size; p++) {
    const n = doc.nodeAt(p);
    if (!n || !n.isInline) break;
    if (!n.marks.some((m) => m.eq(mark))) break;
    to = p + n.nodeSize;
  }
  return { href, from, to, mark };
}

/** Locate the link mark at a viewport (x, y) coordinate — the
 *  right-click target. `posAtCoords` returns the DOM-level inside
 *  position; `findLinkRunAtPos` does the rest. */
function findLinkAt(view: EditorView, x: number, y: number): LinkHit | null {
  const coords = view.posAtCoords({ left: x, top: y });
  if (!coords) return null;
  return findLinkRunAtPos(view.state.doc, coords.pos);
}

interface MenuItem {
  label: string;
  disabled?: boolean;
  title?: string;
  action: () => void;
}

let openMenuEl: HTMLElement | null = null;

function showLinkContextMenu(
  x: number,
  y: number,
  view: EditorView,
  hit: LinkHit,
): void {
  closeLinkContextMenu();

  const items: MenuItem[] = [
    {
      label: 'Open Link',
      action: () => openLinkExternally(hit.href),
    },
    {
      label: 'Copy Link Address',
      action: () => copyToClipboard(hit.href),
    },
    {
      label: 'Edit Link…',
      action: () => void editLink(view, hit),
    },
    {
      label: 'Remove Link',
      action: () => removeLink(view, hit),
    },
  ];

  const menu = document.createElement('div');
  menu.className = 'pmd-nav-context-menu';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-nav-context-item';
    btn.textContent = item.label;
    if (item.disabled) {
      btn.disabled = true;
      btn.classList.add('pmd-nav-context-item-disabled');
    }
    if (item.title) btn.title = item.title;
    btn.addEventListener('click', () => {
      if (item.disabled) return;
      closeLinkContextMenu();
      item.action();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  positionFloatingMenu(menu, x, y);

  openMenuEl = menu;
  setTimeout(() => {
    window.addEventListener('mousedown', maybeCloseLinkContextMenu, { capture: true });
    window.addEventListener('keydown', maybeCloseLinkContextMenu, { capture: true });
  });
}

function closeLinkContextMenu(): void {
  if (!openMenuEl) return;
  openMenuEl.remove();
  openMenuEl = null;
  window.removeEventListener('mousedown', maybeCloseLinkContextMenu, { capture: true });
  window.removeEventListener('keydown', maybeCloseLinkContextMenu, { capture: true });
}

function maybeCloseLinkContextMenu(e: MouseEvent | KeyboardEvent): void {
  if (e instanceof KeyboardEvent) {
    if (e.key === 'Escape') closeLinkContextMenu();
    return;
  }
  if (!openMenuEl) return;
  if (!openMenuEl.contains(e.target as Node)) closeLinkContextMenu();
}

function openLinkExternally(href: string): void {
  const electron = getElectronHost();
  if (electron) {
    void electron.openExternal(href).catch((err) => {
      console.warn('openExternal failed:', err);
      showToast('Could not open link.');
    });
    return;
  }
  // Web fallback. noopener+noreferrer prevents the opened page
  // from running scripts back against ours.
  try {
    window.open(href, '_blank', 'noopener,noreferrer');
  } catch (err) {
    console.warn('window.open failed:', err);
    showToast('Could not open link.');
  }
}

function copyToClipboard(text: string): void {
  // Shared host-first / retrying path (clipboard-write.ts); it owns
  // the execCommand fallback too.
  void writeClipboardText(text).then((ok) =>
    showToast(ok ? 'Link copied.' : 'Copy failed.'),
  );
}

async function editLink(view: EditorView, hit: LinkHit): Promise<void> {
  const next = await promptForText({
    message: 'Edit link URL',
    initial: hit.href,
    placeholder: 'https://…',
    okLabel: 'Save',
  });
  if (next === null) return;
  const trimmed = next.trim();
  const linkType = schema.marks['link'];
  if (!linkType) return;
  // Empty input = remove the link mark.
  if (trimmed === '') {
    removeLink(view, hit);
    return;
  }
  if (trimmed === hit.href) return;
  const tr = view.state.tr
    .removeMark(hit.from, hit.to, linkType)
    .addMark(hit.from, hit.to, linkType.create({ href: trimmed }));
  view.dispatch(tr);
}

function removeLink(view: EditorView, hit: LinkHit): void {
  const linkType = schema.marks['link'];
  if (!linkType) return;
  view.dispatch(view.state.tr.removeMark(hit.from, hit.to, linkType));
}

/** Ctrl/Cmd+K: toggle a hyperlink.
 *
 *   - Collapsed cursor inside an existing link → remove just that link's
 *     run (findLinkRunAtPos, same lookup the right-click menu uses).
 *   - Collapsed cursor NOT in a link → nothing to link or unlink; toast.
 *   - Non-empty selection touching a link anywhere in range → remove the
 *     link mark from the selection (same scope as the Doc menu's Remove
 *     Hyperlinks, just always scoped to the selection here).
 *   - Non-empty selection with no link → prompt for display text (pre-
 *     filled with the selection) + URL, then apply. Typing the text
 *     field over its prefill REPLACES the selected text with the new
 *     link text; leaving it alone just adds the link mark over the
 *     existing selection, preserving whatever other formatting it had. */
export async function toggleOrCreateLink(view: EditorView): Promise<void> {
  const linkType = schema.marks['link'];
  if (!linkType) return;
  const { state } = view;
  const { from, to, empty } = state.selection;

  if (empty) {
    const hit = findLinkRunAtPos(state.doc, from);
    if (hit) {
      view.dispatch(view.state.tr.removeMark(hit.from, hit.to, linkType));
    } else {
      showToast(
        'Select text to add a hyperlink, or place the cursor in an existing link to remove it.',
      );
    }
    return;
  }

  let hasLink = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.marks.some((m) => m.type === linkType)) hasLink = true;
  });
  if (hasLink) {
    view.dispatch(view.state.tr.removeMark(from, to, linkType));
    return;
  }

  const rawSelected = state.doc.textBetween(from, to, ' ');
  // Trim whitespace OUT of the range to actually link — a double-click
  // word-select often grabs a trailing space, and a manual shift-select
  // can grab either end. Linking that space too is harmless-looking but
  // wrong (an underlined, clickable space), and worse, comparing it
  // against promptForLink's always-trimmed return value would wrongly
  // read as "the user changed the text," triggering the destructive
  // replaceWith branch below and silently eating the space instead of
  // just placing the mark on it.
  const selectedText = rawSelected.trim();
  const linkFrom = from + (rawSelected.length - rawSelected.trimStart().length);
  const linkTo = to - (rawSelected.length - rawSelected.trimEnd().length);
  if (!selectedText) {
    showToast('Select some text to add a hyperlink.');
    return;
  }
  const result = await promptForLink({ initialText: selectedText, initialHref: '' });
  if (!result) return;
  const mark = linkType.create({ href: result.href });
  const tr =
    result.text === selectedText
      ? view.state.tr.addMark(linkFrom, linkTo, mark)
      : view.state.tr.replaceWith(linkFrom, linkTo, schema.text(result.text, [mark]));
  view.dispatch(tr);
}
