import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The stack button ("v 2") wears the speech amber while the speech doc is
// anywhere in that stack, visible or not.
describe('stack button amber when the stack holds the speech doc', () => {
  const shell = readFileSync(resolve(process.cwd(), 'src/editor/multi-pane-shell.ts'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src/editor/style.css'), 'utf8');

  it('is decided from every doc in the stack, on each speech refresh', () => {
    const fn = shell.slice(shell.indexOf('refreshSpeechChips(): void'));
    expect(fn.slice(0, fn.indexOf('\n  }\n'))).toContain(
      'slot.stack.some((r) => getSpeechDocResolver().isSpeechByUid(r.uid))',
    );
    expect(shell).toContain("this.chipStackBtn.classList.toggle('pmd-has-speech', has)");
  });

  it('uses the speech tokens and beats the focused-pane colors', () => {
    expect(css).toMatch(/\.pmd-pane-focused:not\(\.pmd-pane-speech\) \.pmd-pane-chip-stack\.pmd-has-speech \{[^}]*var\(--pmd-c-speech-bg\)/s);
    expect(css).toMatch(/\.pmd-pane \.pmd-pane-chip-stack\.pmd-has-speech,/);
  });
});
