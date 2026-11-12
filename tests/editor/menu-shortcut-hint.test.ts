// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { fillMenuRow, shortcutHintFor, setShortcutHintResolver } from '../../src/editor/menu-shortcut-hint.js';
import { primaryKeyFor, formatKeyForDisplay } from '../../src/editor/ribbon-commands.js';
import { settings } from '../../src/editor/settings.js';
import { openDocMenu } from '../../src/editor/doc-menu-ui.js';

describe('Doc / Card menu shortcut hints', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    settings.set('ribbonKeyOverrides', {});
    // The same lookup the app registers at startup.
    setShortcutHintResolver((id) => {
      const key = primaryKeyFor(id, settings.get('ribbonKeyOverrides'));
      return key ? formatKeyForDisplay(key) || null : null;
    });
  });

  it('shows nothing until the app registers a key lookup', () => {
    setShortcutHintResolver(null);
    const btn = document.createElement('button');
    fillMenuRow(btn, 'Condense', 'condenseDefault');
    expect(btn.textContent).toBe('Condense');
  });

  it('shows the default key, right-aligned in its own span, for a bound command', () => {
    expect(shortcutHintFor('condenseDefault')).toMatch(/F3/);
    const btn = document.createElement('button');
    fillMenuRow(btn, 'Condense', 'condenseDefault');
    expect(btn.querySelector('.pmd-menu-row-label')?.textContent).toBe('Condense');
    expect(btn.querySelector('.pmd-menu-row-key')?.textContent).toMatch(/F3/);
    expect(btn.classList.contains('pmd-has-key')).toBe(true);
  });

  it('leaves an unbound command, or a row with no command, as plain text', () => {
    const a = document.createElement('button');
    fillMenuRow(a, 'Create Reference', 'createReference');
    expect(a.textContent).toBe('Create Reference');
    expect(a.querySelector('.pmd-menu-row-key')).toBeNull();
    const b = document.createElement('button');
    fillMenuRow(b, 'Cross-Ex Practice (AI)', undefined);
    expect(b.textContent).toBe('Cross-Ex Practice (AI)');
  });

  it('follows a rebind', () => {
    settings.set('ribbonKeyOverrides', { createReference: 'Mod-Alt-r' });
    expect(shortcutHintFor('createReference')).toMatch(/R/i);
    settings.set('ribbonKeyOverrides', { condenseDefault: '' });
    expect(shortcutHintFor('condenseDefault')).toBeNull();
  });

  it('the opened menu carries the hints regardless of the tooltip setting', () => {
    settings.set('ribbonTooltipMode', 'none');
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    openDocMenu(anchor, null, [
      {
        title: 'Condense',
        items: [
          { label: 'Condense', commandId: 'condenseDefault', run: () => {} },
          { label: 'Condense with warning', commandId: 'condenseWithWarning', run: () => {} },
        ],
      },
    ]);
    const rows = [...document.querySelectorAll('.pmd-doc-menu-item')];
    expect(rows[0]!.querySelector('.pmd-menu-row-key')?.textContent).toMatch(/F3/);
    expect(rows[1]!.querySelector('.pmd-menu-row-key')).toBeNull();
  });
});
