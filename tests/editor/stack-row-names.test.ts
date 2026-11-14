import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stackRowNames, stripDocExtension } from '../../src/editor/stack-row-names.js';

describe('stripDocExtension', () => {
  it('drops .docx and .cmir, in any case, and nothing else', () => {
    expect(stripDocExtension('1NC Shell---GGSA.docx')).toBe('1NC Shell---GGSA');
    expect(stripDocExtension('Notes.CMIR')).toBe('Notes');
    expect(stripDocExtension('draft.v2.docx')).toBe('draft.v2');
    expect(stripDocExtension('Untitled')).toBe('Untitled');
    expect(stripDocExtension('notes.txt')).toBe('notes.txt');
    expect(stripDocExtension('docx')).toBe('docx');
  });
});

describe('stackRowNames', () => {
  it('shows every name without its ending', () => {
    expect(stackRowNames(['1NC.docx', '2NR', '2NC.docx', '1NR.docx'])).toEqual(['1NC', '2NR', '2NC', '1NR']);
  });

  it('keeps the ending on names that would otherwise look the same', () => {
    expect(stackRowNames(['Round 3.docx', 'Round 3.cmir', 'Other.docx'])).toEqual([
      'Round 3.docx',
      'Round 3.cmir',
      'Other',
    ]);
  });

  it('a bare name next to an extended one keeps the extended one\'s ending', () => {
    expect(stackRowNames(['Round 3', 'Round 3.docx'])).toEqual(['Round 3', 'Round 3.docx']);
  });

  it('identical names (told apart by their folder in the list) are shortened together', () => {
    expect(stackRowNames(['1NC.docx', '1NC.docx'])).toEqual(['1NC', '1NC']);
  });
});

// The list's rows are built in the pane shell; pin the wiring.
describe('pane stack list rows', () => {
  const shell = readFileSync(resolve(process.cwd(), 'src/editor/multi-pane-shell.ts'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src/editor/style.css'), 'utf8');
  const body = shell.slice(shell.indexOf('private openStackDropdown'));
  const fn = body.slice(0, body.indexOf('Close a specific record'));

  it('uses the extension-free names', () => {
    expect(fn).toContain('stackRowNames(');
    expect(fn).toContain('rowNames[rowIndex]');
  });

  it('marks the speech doc\'s name amber and keeps its mic', () => {
    expect(fn).toContain("name.classList.add('pmd-speech-name')");
    expect(fn).toContain("setIcon(mark, 'mic')");
    expect(css).toMatch(/\.pmd-speech-name \{[^}]*--pmd-c-speech-amber/s);
    expect(css).toMatch(/\.pmd-pane-chip-dropdown-row\.pmd-speech \.pmd-pane-chip-dropdown-mic \{[^}]*--pmd-c-speech-amber/);
  });
});
