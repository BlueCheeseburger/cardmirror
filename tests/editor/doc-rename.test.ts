// @vitest-environment jsdom
/**
 * Double-click-to-rename (doc-rename.ts): what a typed name means for
 * the filename, and the inline-edit affordance the ribbon chip and the
 * pane chips share.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveRenameFilename,
  installInlineRename,
  isInlineRenaming,
} from '../../src/editor/doc-rename.js';

describe('resolveRenameFilename', () => {
  it('keeps the current extension when the user types none', () => {
    expect(resolveRenameFilename('1nc.docx', '2nr')).toEqual({ ok: true, filename: '2nr.docx' });
    expect(resolveRenameFilename('case.cmir', 'case v2')).toEqual({
      ok: true,
      filename: 'case v2.cmir',
    });
  });

  it('accepts the same extension typed explicitly, without doubling it', () => {
    expect(resolveRenameFilename('1nc.docx', '2nr.docx')).toEqual({
      ok: true,
      filename: '2nr.docx',
    });
  });

  it('refuses to change format — that is a conversion, not a rename', () => {
    expect(resolveRenameFilename('case.cmir', 'case.docx')).toEqual({
      ok: false,
      reason: 'format-change',
    });
    expect(resolveRenameFilename('1nc.docx', '1nc.cmir')).toEqual({
      ok: false,
      reason: 'format-change',
    });
  });

  it('compares extensions case-insensitively but preserves the original spelling', () => {
    expect(resolveRenameFilename('1NC.DOCX', '2nr.docx')).toEqual({
      ok: true,
      filename: '2nr.docx',
    });
    expect(resolveRenameFilename('1NC.DOCX', '2nr')).toEqual({ ok: true, filename: '2nr.DOCX' });
  });

  it('reports an unchanged name instead of a pointless rename', () => {
    expect(resolveRenameFilename('1nc.docx', '1nc.docx')).toEqual({
      ok: false,
      reason: 'unchanged',
    });
    expect(resolveRenameFilename('1nc.docx', '  1nc  ')).toEqual({
      ok: false,
      reason: 'unchanged',
    });
  });

  it('reports an empty name', () => {
    expect(resolveRenameFilename('1nc.docx', '   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('leaves an extensionless doc extensionless', () => {
    expect(resolveRenameFilename('Untitled', 'Notes')).toEqual({ ok: true, filename: 'Notes' });
  });

  it('treats an unknown extension as part of the name, keeping the real one', () => {
    // "Politics DA v2.final" shouldn't be read as a format.
    expect(resolveRenameFilename('da.docx', 'Politics DA v2.final')).toEqual({
      ok: true,
      filename: 'Politics DA v2.final.docx',
    });
  });
});

describe('installInlineRename', () => {
  let el: HTMLElement;
  let commit: ReturnType<typeof vi.fn>;
  let restore: ReturnType<typeof vi.fn>;

  const dblclick = (): void => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  };
  const field = (): HTMLInputElement | null => el.querySelector('input');

  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('span');
    el.textContent = '1nc.docx';
    document.body.appendChild(el);
    commit = vi.fn();
    restore = vi.fn(() => {
      el.textContent = '1nc.docx';
    });
    installInlineRename(el, { currentName: () => '1nc.docx', commit, restore });
  });

  it('swaps in a field seeded with the current name, basename selected', () => {
    dblclick();
    const input = field()!;
    expect(input.value).toBe('1nc.docx');
    // The extension stays out of the selection so typing doesn't eat it.
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
    expect(isInlineRenaming(el)).toBe(true);
  });

  it('commits on Enter, with the typed text, exactly once', () => {
    dblclick();
    const input = field()!;
    input.value = '2nr';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('2nr');
    expect(field()).toBeNull();
    expect(isInlineRenaming(el)).toBe(false);
  });

  it('commits on blur — the Finder behaviour for renaming a file', () => {
    dblclick();
    const input = field()!;
    input.value = '2nr';
    input.dispatchEvent(new FocusEvent('blur'));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('2nr');
  });

  it('does not double-commit when Enter is followed by a blur', () => {
    dblclick();
    const input = field()!;
    input.value = '2nr';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape without committing, and a later blur stays silent', () => {
    dblclick();
    const input = field()!;
    input.value = 'discard me';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(commit).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalled();
    expect(el.textContent).toBe('1nc.docx');
    input.dispatchEvent(new FocusEvent('blur'));
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps typing away from the app’s global shortcuts', () => {
    const seen: string[] = [];
    document.addEventListener('keydown', (e) => seen.push(e.key));
    dblclick();
    field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(seen).toEqual([]);
  });

  it('ignores a double-click when there is no name yet (never-saved doc)', () => {
    document.body.innerHTML = '';
    const blank = document.createElement('span');
    document.body.appendChild(blank);
    installInlineRename(blank, { currentName: () => null, commit, restore });
    blank.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(blank.querySelector('input')).toBeNull();
    expect(isInlineRenaming(blank)).toBe(false);
  });

  it('a second double-click while editing does not restart the field', () => {
    dblclick();
    const first = field();
    dblclick();
    expect(field()).toBe(first);
  });

  it('destroy() removes the affordance', () => {
    document.body.innerHTML = '';
    const target = document.createElement('span');
    target.textContent = 'x.docx';
    document.body.appendChild(target);
    const handle = installInlineRename(target, {
      currentName: () => 'x.docx',
      commit,
      restore,
    });
    handle.destroy();
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(target.querySelector('input')).toBeNull();
  });

  it('destroy() mid-edit tears the field down and clears the mid-edit marker', () => {
    // Leaving the marker set would strand the label: every refresh
    // that rewrites its text checks isInlineRenaming() first and bails,
    // so the chip would keep showing whatever it said when the edit
    // started, forever.
    document.body.innerHTML = '';
    const target = document.createElement('span');
    target.textContent = 'x.docx';
    document.body.appendChild(target);
    const handle = installInlineRename(target, {
      currentName: () => 'x.docx',
      commit,
      restore,
    });
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(target.querySelector('input')).not.toBeNull();

    handle.destroy();
    expect(target.querySelector('input')).toBeNull();
    expect(isInlineRenaming(target)).toBe(false);
    // Tearing down is not a commit — the name must not change on disk.
    expect(commit).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalled();
  });
});
