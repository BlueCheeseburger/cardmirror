/**
 * The always-visible shortcut hint on Doc / Card menu rows (the toolbar
 * dropdowns and the outline's right-click submenus). It shows the command's
 * current key, so it follows rebinds, and it is small and right-aligned like
 * the F-key badges on the style buttons. Rows with no key get no hint. The
 * hover tooltip setting does not apply: the hint is always on.
 */
import { settings } from './settings.js';
import { primaryKeyFor, formatKeyForDisplay } from './ribbon-commands.js';
import type { RibbonCommandId } from './ribbon-commands.js';

/** The key to show for a command, e.g. "Ctrl+Shift+C", or null if unbound. */
export function shortcutHintFor(commandId: RibbonCommandId): string | null {
  const key = primaryKeyFor(commandId, settings.get('ribbonKeyOverrides'));
  return key ? formatKeyForDisplay(key) || null : null;
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
