/**
 * The always-visible shortcut hint on Doc / Card menu rows (the toolbar
 * dropdowns and the outline's right-click submenus). It shows the command's
 * current key, so it follows rebinds, and it is small and right-aligned like
 * the F-key badges on the style buttons. Rows with no key get no hint. The
 * hover tooltip setting does not apply: the hint is always on.
 *
 * The key lookup is registered by the app at startup (`setShortcutHintResolver`)
 * rather than imported here: the command table reads the host as it loads, and
 * the outline panel, which uses this file, must stay loadable without it.
 */
import type { RibbonCommandId } from './ribbon-commands.js';

type HintResolver = (commandId: RibbonCommandId) => string | null;
let resolver: HintResolver | null = null;

/** Register how a command's current key is looked up and formatted. */
export function setShortcutHintResolver(fn: HintResolver | null): void {
  resolver = fn;
}

/** The key to show for a command, e.g. "Ctrl+Shift+C", or null if unbound. */
export function shortcutHintFor(commandId: RibbonCommandId): string | null {
  return resolver ? resolver(commandId) : null;
}

/** Fill a menu-row button: the label, then (when bound) the hint at the right. */
export function fillMenuRow(
  btn: HTMLElement,
  label: string,
  commandId: RibbonCommandId | undefined,
): void {
  const hint = commandId ? shortcutHintFor(commandId) : null;
  if (!hint) {
    btn.textContent = label;
    return;
  }
  const text = document.createElement('span');
  text.className = 'pmd-menu-row-label';
  text.textContent = label;
  const key = document.createElement('span');
  key.className = 'pmd-menu-row-key';
  key.textContent = hint;
  key.setAttribute('aria-hidden', 'true');
  btn.classList.add('pmd-has-key');
  btn.setAttribute('aria-keyshortcuts', hint);
  btn.append(text, key);
}
