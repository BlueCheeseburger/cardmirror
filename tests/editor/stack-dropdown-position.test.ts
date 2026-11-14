import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A pane at the right edge used to open its stack list off the screen, so
// the rows' close buttons could not be reached. The list must be fixed and
// clamped to the window, and its folder paths must be allowed to shrink.
describe('pane stack dropdown stays on screen', () => {
  const shell = readFileSync(resolve(process.cwd(), 'src/editor/multi-pane-shell.ts'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src/editor/style.css'), 'utf8');

  it('is positioned with the shared viewport clamp, not at the raw chip edge', () => {
    const body = shell.slice(shell.indexOf('private openStackDropdown'));
    const fn = body.slice(0, body.indexOf('Close a specific record'));
    expect(fn).toContain("dropdown.style.position = 'fixed'");
    expect(fn).toContain('positionFloatingMenu(dropdown');
    expect(fn).not.toContain('window.scrollX');
  });

  it('has a window-width cap and a shrinking path', () => {
    expect(css).toMatch(/\.pmd-pane-chip-dropdown \{[^}]*max-width: calc\(100vw - 8px\)/s);
    expect(css).toMatch(/\.pmd-pane-chip-dropdown-row \.pmd-pane-chip-path \{[^}]*flex: 0 1 14rem/s);
  });
});

// The rows drag to reorder the stack with no handle (row-reorder.ts has the
// drag itself under test); this pins the wiring in the pane shell.
describe('pane stack dropdown reorders by dragging', () => {
  const shell = readFileSync(resolve(process.cwd(), 'src/editor/multi-pane-shell.ts'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src/editor/style.css'), 'utf8');

  it('attaches the row drag to the dropdown, leaving the close button out of it', () => {
    const body = shell.slice(shell.indexOf('private openStackDropdown'));
    const fn = body.slice(0, body.indexOf('Close a specific record'));
    expect(fn).toContain('attachRowReorder(dropdown');
    expect(fn).toContain("ignore: '.pmd-pane-chip-dropdown-close'");
    expect(fn).toContain('this.applyStackOrder(');
    expect(shell).toContain('openStackDropdownDetach?.()');
  });

  it('keeps the visible doc visible and refuses a stale order', () => {
    const fn = shell.slice(shell.indexOf('applyStackOrder('), shell.indexOf('Close a specific record'));
    expect(fn).toContain('this.stack.indexOf(visible)');
    expect(fn).toContain('order.length !== this.stack.length');
  });

  it('has no visible handle and does not start a text selection', () => {
    expect(css).toMatch(/\.pmd-pane-chip-dropdown \{ user-select: none/);
    expect(css).not.toMatch(/pmd-pane-chip-dropdown[^{]*(grip|handle)/i);
  });
});
