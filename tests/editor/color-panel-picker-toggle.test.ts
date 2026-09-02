// @vitest-environment jsdom

/**
 * Color-picker trigger ownership: a second activation of the same arrow
 * closes its picker. The pointerdown is important because the production
 * outside-dismiss handler runs before the trigger's click handler.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wireColorPanel } from '../../src/editor/color-panel.js';

function buildRibbonStubs(): void {
  const ids = [
    'highlight-btn', 'highlight-picker-btn', 'highlight-bar',
    'shading-btn', 'shading-picker-btn', 'shading-bar',
    'fontcolor-btn', 'fontcolor-picker-btn', 'fontcolor-bar', 'fontcolor-glyph',
  ];
  for (const id of ids) {
    const element = document.createElement(id.endsWith('-btn') ? 'button' : 'div');
    element.id = id;
    document.body.appendChild(element);
  }
}

function activate(button: HTMLButtonElement): void {
  button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
}

describe('color-panel picker toggle', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    buildRibbonStubs();
    wireColorPanel({ view: null });
  });

  afterEach(() => {
    // Close a picker left open by a failed assertion so its document-level
    // listeners do not leak into another test.
    if (document.querySelector('.pmd-color-picker')) {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    }
    document.body.replaceChildren();
  });

  it('closes an open picker when its arrow is activated again', () => {
    const arrow = document.getElementById('highlight-picker-btn') as HTMLButtonElement;

    activate(arrow);
    expect(document.querySelector('.pmd-color-picker')).not.toBeNull();
    expect(arrow.getAttribute('aria-expanded')).toBe('true');

    activate(arrow);
    expect(document.querySelector('.pmd-color-picker')).toBeNull();
    expect(arrow.getAttribute('aria-expanded')).toBe('false');
  });
});
