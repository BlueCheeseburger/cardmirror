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
  it('keeps the window-drag strip clear of the close X', () => {
    const html = chooserHtml({ message: 'm', labels: ['A'], withCancel: false, dark: false });
    // The title is the drag region; its box must END before the X (margin),
    // not run underneath it with padding, or the OS takes the click as a drag.
    expect(html).toContain('h1{margin:0 34px 0 0;');
    expect(html).not.toMatch(/h1\{[^}]*padding-right/);
    expect(html).toContain('class="drag"');
    expect(html).toMatch(/\.x\{[^}]*-webkit-app-region:no-drag/);
  });
  it('can report its natural height so the window fits the rows', () => {
    expect(chooserHtml({ message: 'm', labels: ['A'], withCancel: false, dark: false })).toContain('function naturalHeight()');
  });

  it('draws pills at the right of a row, with a hint on each', () => {
    const html = chooserHtml({
      message: 'm',
      labels: ['A', 'B'],
      pills: [['lastViewed', 'speech'], []],
      withCancel: false,
      dark: false,
    });
    expect(html).toContain('<span class="pill lastViewed" title="The window you were last looking at">Last viewed</span>');
    expect(html).toContain('<span class="pill speech" title="This window holds the speech doc">Speech doc</span>');
    expect(html.match(/class="pill /g)).toHaveLength(2);
    // The number key still sits at the far right, after the pills.
    expect(html.indexOf('class="pills"')).toBeLessThan(html.indexOf('<kbd>1</kbd>'));
  });
  it('marks the speech doc on its own name in amber, with the mic first, and leaves the window without a Speech doc pill', () => {
    const html = chooserHtml({
      message: 'm',
      labels: ['Stocks DA'],
      details: [['Stocks DA---Glenbrooks.docx', 'Sameer---Stocks DA.docx']],
      pills: [['lastViewed', 'speech']],
      speechDocs: ['Sameer---Stocks DA.docx'],
      withCancel: false,
      dark: false,
    });
    expect(html).toMatch(/<span class="speechdoc" title="This is the speech doc"><svg class="mic"[^>]*>.*?<\/svg>Sameer---Stocks DA\.docx<\/span>/);
    // Only the speech doc's name is highlighted, and its window lost the pill.
    expect(html.match(/class="speechdoc"/g)).toHaveLength(1);
    expect(html).not.toContain('class="pill speech"');
    expect(html).toContain('class="pill lastViewed"');
    // The list around it may run to more lines so the name is not cut.
    expect(html).toContain('<span class="sub roomy">Stocks DA---Glenbrooks.docx · <span class="speechdoc"');
    // Amber text, not a highlight box.
    expect(html).toMatch(/\.speechdoc\{color:var\(--speech-amber\)\}/);
    expect(html).not.toMatch(/\.speechdoc\{[^}]*background/);
  });

  it('marks the speech doc in an unnamed window\'s own lines, letting that line wrap', () => {
    const html = chooserHtml({
      message: 'm',
      labels: ['A.docx · B.docx'],
      speechDocs: ['B.docx'],
      pills: [['speech']],
      withCancel: false,
      dark: false,
    });
    expect(html).toContain('<span class="doc">A.docx</span>');
    expect(html).toMatch(/<span class="doc long"><span class="speechdoc"[^>]*><svg class="mic"[^>]*>.*?<\/svg>B\.docx<\/span><\/span>/);
    expect(html).not.toContain('class="pill speech"');
    expect(html).toContain('.doc.long{white-space:normal');
  });

  it('keeps the window\'s Speech doc pill when the speech doc matches none of the names shown', () => {
    const html = chooserHtml({
      message: 'm',
      labels: ['A.docx'],
      speechDocs: ['Something else.docx'],
      pills: [['speech']],
      withCancel: false,
      dark: false,
    });
    expect(html).not.toContain('class="speechdoc"');
    expect(html).toContain('<span class="pill speech"');
  });

  it('escapes the speech doc name', () => {
    const html = chooserHtml({
      message: 'm',
      labels: ['<b>x</b>.docx'],
      speechDocs: ['<b>x</b>.docx'],
      withCancel: false,
      dark: false,
    });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;.docx</span>');
    expect(html).not.toContain('<b>x</b>');
  });

  it('shows a window busy with Compare greyed: no pick, no number key, same numbers for the rest', () => {
    const html = chooserHtml({
      message: 'm',
      labels: ['A', 'B', 'C'],
      pills: [[], ['comparing'], ['lastViewed']],
      disabled: [false, true, false],
      withCancel: false,
      dark: false,
    });
    expect(html).toContain('<div class="row off" aria-disabled="true">');
    expect(html).not.toContain('data-pick="1"');
    expect(html).toContain('data-pick="2" data-key="3"');
    expect(html).toContain('<kbd>3</kbd>');
    expect(html).not.toContain('<kbd>2</kbd>');
    expect(html).toContain('Comparing documents');
    // The arrow keys and Enter only visit rows that can be picked.
    expect(html).toContain("querySelectorAll('.row:not(.off)')");
  });
  it('picks by each row\'s own number key', () => {
    const html = chooserHtml({ message: 'm', labels: ['A'], withCancel: false, dark: false });
    expect(html).toContain('data-key="1"');
    expect(html).toContain('.row[data-key="');
  });
});
