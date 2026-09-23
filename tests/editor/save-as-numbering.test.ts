// @vitest-environment jsdom
/**
 * The Save As dialog's card-number choice (2026-09-19): presets carry the
 * per-preset setting, Custom save offers freeze / remove as an exclusive
 * pair, and neither ticked keeps the live numbering. This fork's dialog
 * picks a mode by radio and saves on submit, rather than saving from a
 * preset button.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openSaveAs } from '../../src/editor/save-as-ui.js';
import { settings } from '../../src/editor/settings.js';

afterEach(() => {
  settings.set('sendDocNumbering', 'freeze');
  settings.set('markedDocNumbering', 'freeze');
  document.body.innerHTML = '';
});

const boxByLabel = (label: string): HTMLInputElement => {
  const el = Array.from(document.querySelectorAll<HTMLLabelElement>('label.pmd-save-as-option')).find((l) => l.textContent?.trim() === label);
  if (!el) throw new Error(`no checkbox labelled ${label}`);
  return el.querySelector('input')!;
};
const selectMode = (label: string): void => {
  const row = Array.from(document.querySelectorAll('.pmd-save-as-radio-row')).find(
    (r) => r.querySelector('.pmd-save-as-radio-row-label')?.textContent === label,
  );
  if (!row) throw new Error(`no mode ${label}`);
  row.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
};
const submit = (): void => {
  document.querySelector('form.pmd-save-as-body')!.dispatchEvent(new Event('submit', { cancelable: true }));
};

describe('Save As: card numbers', () => {
  it('Custom save: freeze and remove exclude each other; neither = keep', async () => {
    const pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    selectMode('Custom Save');
    const freeze = boxByLabel('Freeze card numbers as text');
    const remove = boxByLabel('Remove card numbers');
    expect(freeze.checked || remove.checked, 'both off by default').toBe(false);
    freeze.checked = true;
    freeze.dispatchEvent(new Event('change'));
    expect(remove.checked).toBe(false);
    remove.checked = true;
    remove.dispatchEvent(new Event('change'));
    expect(freeze.checked, 'ticking Remove unticks Freeze').toBe(false);
    submit();
    const result = await pending;
    expect(result?.numbering).toBe('remove');
  });

  it('Custom save with neither box keeps live numbering', async () => {
    const pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    selectMode('Custom Save');
    submit();
    expect((await pending)?.numbering).toBe('keep');
  });

  it('the Read Doc preset keeps live numbering (read mode drops no heading)', async () => {
    const pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    selectMode('Read Doc');
    submit();
    expect((await pending)?.numbering).toBe('keep');
  });

  it('the Send Doc preset carries the Send Doc setting; As-Is keeps', async () => {
    settings.set('sendDocNumbering', 'remove');
    let pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    selectMode('Send Doc');
    submit();
    expect((await pending)?.numbering).toBe('remove');
    document.body.innerHTML = '';
    pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    selectMode('As-Is');
    submit();
    expect((await pending)?.numbering).toBe('keep');
  });

  it('the Marked Doc preset carries the Marked Cards setting', async () => {
    settings.set('markedDocNumbering', 'remove');
    const pending = openSaveAs({ initialFilename: 'doc', defaultFormat: 'cmir' });
    selectMode('Marked Doc');
    submit();
    expect((await pending)?.numbering).toBe('remove');
  });
});
