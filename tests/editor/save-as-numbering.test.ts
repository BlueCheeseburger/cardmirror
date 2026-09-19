// @vitest-environment jsdom
/**
 * The Save As dialog's card-number choice (2026-09-19): presets carry the
 * per-preset setting, Custom save offers freeze / remove as an exclusive
 * pair, and neither ticked keeps the live numbering.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openSaveAs } from '../../src/editor/save-as-ui.js';
import { settings } from '../../src/editor/settings.js';

afterEach(() => {
  settings.set('sendDocNumbering', 'freeze');
  document.body.innerHTML = '';
});

const boxByLabel = (label: string): HTMLInputElement => {
  const el = Array.from(document.querySelectorAll<HTMLLabelElement>('label.pmd-save-as-option')).find((l) => l.textContent?.trim() === label);
  if (!el) throw new Error(`no checkbox labelled ${label}`);
  return el.querySelector('input')!;
};
const presetButton = (title: string): HTMLButtonElement => {
  const b = Array.from(document.querySelectorAll<HTMLButtonElement>('button.pmd-save-as-preset-btn')).find((x) => x.textContent === title);
  if (!b) throw new Error(`no preset ${title}`);
  return b;
};

describe('Save As: card numbers', () => {
  it('Custom save: freeze and remove exclude each other; neither = keep', async () => {
    const pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    const freeze = boxByLabel('Freeze card numbers as text');
    const remove = boxByLabel('Remove card numbers');
    expect(freeze.checked || remove.checked, 'both off by default').toBe(false);
    freeze.checked = true;
    freeze.dispatchEvent(new Event('change'));
    expect(remove.checked).toBe(false);
    remove.checked = true;
    remove.dispatchEvent(new Event('change'));
    expect(freeze.checked, 'ticking Remove unticks Freeze').toBe(false);
    document.querySelector('form.pmd-save-as-body')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const result = await pending;
    expect(result?.numbering).toBe('remove');
  });

  it('Custom save with neither box keeps live numbering', async () => {
    const pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    document.querySelector('form.pmd-save-as-body')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect((await pending)?.numbering).toBe('keep');
  });

  it('the Read Doc preset keeps live numbering (read mode drops no heading)', async () => {
    const pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    presetButton('Read Doc').click();
    expect((await pending)?.numbering).toBe('keep');
  });

  it('the Send Doc preset carries the Send Doc setting; As-Is keeps', async () => {
    settings.set('sendDocNumbering', 'remove');
    let pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    presetButton('Send Doc').click();
    expect((await pending)?.numbering).toBe('remove');
    pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    presetButton('As-Is').click();
    expect((await pending)?.numbering).toBe('keep');
  });
});
