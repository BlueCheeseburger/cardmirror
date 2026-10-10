import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, nativeTheme: { shouldUseDarkColors: false } }));

const { chooserHtml, splitLabel } = await import('../../apps/desktop/src/multipane-chooser-ui.js');

describe('chooserHtml', () => {
  it('splits a window label into one line per doc', () => {
    expect(splitLabel('A.docx · B.docx')).toEqual(['A.docx', 'B.docx']);
  });
  it('escapes names and indexes New Window / Cancel after the rows', () => {
    const html = chooserHtml({ message: 'Open "<x>" in:', labels: ['A & B'], withCancel: true, dark: true });
    expect(html).toContain('A &amp; B');
    expect(html).toContain('Open &quot;&lt;x&gt;&quot; in:');
    expect(html).toContain('class="row new" data-pick="1"');
    expect(html).toContain('<kbd>0</kbd>');
    expect(html).toContain('data-pick="2" type="button">Cancel');
    // New window row comes before the first window row.
    expect(html.indexOf('row new')).toBeLessThan(html.indexOf('data-pick="0"'));
    expect(html).toContain('data-theme="dark"');
  });
  it('Esc means Cancel with or without a Cancel button', () => {
    const noBtn = chooserHtml({ message: 'm', labels: ['A', 'B'], withCancel: false, dark: false });
    expect(noBtn).toContain("if(e.key==='Escape'){pick(3)");
    expect(noBtn).not.toContain('>Cancel<');
    const withBtn = chooserHtml({ message: 'm', labels: ['A', 'B'], withCancel: true, dark: false });
    expect(withBtn).toContain("if(e.key==='Escape'){pick(3)");
  });
  it('lists every doc of a named window in tiny grey text', () => {
    const html = chooserHtml({
      message: 'm',
      labels: ['AFF', 'Plain · Docs'],
      details: [['AFF---SP.docx', 'Stocks DA.docx'], null],
      withCancel: false,
      dark: true,
    });
    expect(html).toContain('<span class="sub">AFF---SP.docx · Stocks DA.docx</span>');
    expect(html.match(/class="sub"/g)).toHaveLength(1);
    expect(html).toContain('.sub{');
  });
  it('has a close X in the corner that does what Esc does', () => {
    const withCancel = chooserHtml({ message: 'm', labels: ['A'], withCancel: true, dark: false });
    expect(withCancel).toContain('class="x" data-pick="2"');
    const noCancel = chooserHtml({ message: 'm', labels: ['A', 'B'], withCancel: false, dark: false });
    expect(noCancel).toContain('class="x" data-pick="3"');
  });
  it('can report its natural height so the window fits the rows', () => {
    expect(chooserHtml({ message: 'm', labels: ['A'], withCancel: false, dark: false })).toContain('function naturalHeight()');
  });
});
