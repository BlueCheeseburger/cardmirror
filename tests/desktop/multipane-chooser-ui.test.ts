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
  it('Esc maps to New Window without Cancel', () => {
    const html = chooserHtml({ message: 'm', labels: ['A', 'B'], withCancel: false, dark: false });
    expect(html).toContain("if(e.key==='Escape'){pick(2)");
  });
});
