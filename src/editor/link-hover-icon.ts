/**
 * A small "open link" icon over a hyperlink, shown on hover.
 *
 * Hovering a link in the editor shows a button just above the top-right
 * corner of the link's last word; clicking it opens the link (the same path
 * as Mod+click and the right-click menu's Open). A plain click on the link
 * text still only places the caret.
 *
 * One shared button for every editor: it follows whichever link is hovered,
 * lives in `document.body` (position: fixed, so no editor clipping applies),
 * and is hidden shortly after the pointer leaves the link and the button, or
 * at once on scroll, a key press, a click in the editor, or an edit.
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { findLinkAt, openLinkExternally, type LinkHit } from './link-context-menu-plugin.js';

const SIZE = 20;
/** Gap between the icon's bottom edge and the top of the word. */
const GAP = 2;
/** Grace period so the pointer can travel from the word to the icon. */
const HIDE_DELAY_MS = 300;

let button: HTMLButtonElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let shownHref = '';
let globalListeners = false;

function svgIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  // A box with an arrow leaving its top-right corner.
  path.setAttribute('d', 'M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function cancelHide(): void {
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = null;
}

function hideNow(): void {
  cancelHide();
  if (button) button.hidden = true;
  shownHref = '';
}

function scheduleHide(): void {
  cancelHide();
  hideTimer = setTimeout(hideNow, HIDE_DELAY_MS);
}

function ensureButton(): HTMLButtonElement {
  if (button?.isConnected) return button; // recreated if something cleared the body
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pmd-link-open-btn';
  b.hidden = true;
  b.setAttribute('aria-label', 'Open link');
  b.appendChild(svgIcon());
  // Keep the editor's selection and focus.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    const href = shownHref;
    hideNow();
    if (href) openLinkExternally(href);
  });
  b.addEventListener('mouseenter', cancelHide);
  b.addEventListener('mouseleave', scheduleHide);
  document.body.appendChild(b);
  button = b;
  if (!globalListeners) {
    globalListeners = true;
    document.addEventListener('scroll', hideNow, true);
    document.addEventListener('keydown', hideNow, true);
  }
  return b;
}

/** The end of the link, backed off any trailing whitespace the link covers, so
 *  the icon sits over the last word rather than a trailing space. */
function lastWordEnd(view: EditorView, hit: LinkHit): number {
  const text = view.state.doc.textBetween(hit.from, hit.to, '\n', '\n');
  return hit.from + text.trimEnd().length;
}

function showFor(view: EditorView, hit: LinkHit): void {
  let rect: { right: number; top: number };
  try {
    rect = view.coordsAtPos(lastWordEnd(view, hit), -1);
  } catch {
    return; // not laid out
  }
  const b = ensureButton();
  const maxLeft = Math.max(4, window.innerWidth - SIZE - 4);
  const left = Math.min(Math.max(4, rect.right - SIZE / 2), maxLeft);
  const top = Math.max(4, rect.top - SIZE - GAP);
  b.style.left = `${Math.round(left)}px`;
  b.style.top = `${Math.round(top)}px`;
  shownHref = hit.href;
  b.hidden = false;
  cancelHide();
}

export const linkHoverIconPlugin: Plugin = new Plugin({
  props: {
    handleDOMEvents: {
      mouseover(view, event) {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!anchor || !view.dom.contains(anchor)) return false;
        const hit = findLinkAt(view, event.clientX, event.clientY);
        if (hit) showFor(view, hit);
        return false;
      },
      mouseout(view, event) {
        const target = event.target as HTMLElement | null;
        if (!target?.closest?.('a[href]')) return false;
        const to = event.relatedTarget as Node | null;
        // Moving onto the icon, or between two pieces of the same link, keeps it.
        if (to && button && button.contains(to)) return false;
        if (to && (to as HTMLElement).closest?.('a[href]') && view.dom.contains(to)) return false;
        scheduleHide();
        return false;
      },
      mousedown() {
        hideNow();
        return false;
      },
    },
  },
  view() {
    return {
      update(view, prev) {
        if (!view.state.doc.eq(prev.doc)) hideNow();
      },
      destroy() {
        hideNow();
      },
    };
  },
});
