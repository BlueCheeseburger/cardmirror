// @vitest-environment jsdom
/**
 * "Compare documents" (doc-diff-ui.ts) — the two-step overlay: pick two
 * files, then see the diff. `getHost().openFile()` is mocked so this
 * drives the REAL dialog code without a native file picker, the same
 * way other UI tests here stub the host rather than the browser chrome.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const openFileMock = vi.fn();
vi.mock('../../src/editor/host/index.js', () => ({
  getHost: () => ({ openFile: openFileMock }),
}));

import { openDocDiff } from '../../src/editor/doc-diff-ui.js';
import { serializeNative } from '../../src/native/index.js';
import { toDocx } from '../../src/export/index.js';
import { schema, newHeadingId } from '../../src/schema/index.js';

const q = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel);
const qa = (sel: string): Element[] => Array.from(document.querySelectorAll(sel));

function cardDoc(tag: string, body: string) {
  return schema.nodes['doc']!.createChecked(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
      schema.nodes['card_body']!.create(null, schema.text(body)),
    ]),
  ]);
}

function cardBytes(tag: string, body: string): Uint8Array {
  return serializeNative(cardDoc(tag, body));
}

/** Poll for the results view instead of a fixed microtask flush: a
 *  `.cmir` parse (`parseNative`) resolves within a couple of
 *  microtasks, but a `.docx` parse (`fromDocxFull`) does real async
 *  zip reads and needs actual event-loop ticks to settle. */
async function waitForResults(): Promise<void> {
  await vi.waitFor(
    () => {
      if (!document.querySelector('.pmd-doc-diff-names')) {
        throw new Error('results view not rendered yet');
      }
    },
    { timeout: 2000, interval: 10 },
  );
}

function pickerButtons(): HTMLButtonElement[] {
  return qa('.pmd-doc-diff-picker-row .pmd-doc-diff-btn') as HTMLButtonElement[];
}

function compareBtn(): HTMLButtonElement {
  return q<HTMLButtonElement>('.pmd-doc-diff-topbar-actions .pmd-doc-diff-btn-primary')!;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '';
  openFileMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Compare documents — the picker step', () => {
  it('shows two empty picker rows and a disabled Compare button', () => {
    openDocDiff();
    expect(q('.pmd-doc-diff-dialog')).not.toBeNull();
    expect(qa('.pmd-doc-diff-picker-row')).toHaveLength(2);
    expect(compareBtn().disabled).toBe(true);
  });

  it('Compare stays disabled until both files are picked', async () => {
    openFileMock.mockResolvedValueOnce({ name: 'a.cmir', bytes: cardBytes('Tag', 'Body') });
    openDocDiff();
    pickerButtons()[0]!.click();
    await flush();
    expect(q('.pmd-doc-diff-picker-name')?.textContent).toBe('a.cmir');
    expect(compareBtn().disabled).toBe(true);
  });

  it('cancelling a file picker (openFile resolves null) leaves that row empty', async () => {
    openFileMock.mockResolvedValueOnce(null);
    openDocDiff();
    pickerButtons()[0]!.click();
    await flush();
    expect(q('.pmd-doc-diff-picker-name-empty')).not.toBeNull();
  });

  it('Cancel closes the dialog', () => {
    openDocDiff();
    const cancel = qa('.pmd-doc-diff-topbar-actions .pmd-doc-diff-btn').find((b) => b.textContent === 'Cancel');
    (cancel as HTMLButtonElement).click();
    expect(q('.pmd-doc-diff-dialog')).toBeNull();
  });
});

describe('Compare documents — the results step', () => {
  async function runCompare(bytesA: Uint8Array, bytesB: Uint8Array, nameA = 'a.cmir', nameB = 'b.cmir'): Promise<void> {
    openFileMock.mockResolvedValueOnce({ name: nameA, bytes: bytesA }).mockResolvedValueOnce({ name: nameB, bytes: bytesB });
    openDocDiff();
    pickerButtons()[0]!.click();
    await flush();
    pickerButtons()[1]!.click();
    await flush();
    compareBtn().click();
    await waitForResults();
  }

  it('renders a diff table with the right add/remove cells for a changed line', async () => {
    await runCompare(cardBytes('Tag', 'Old body'), cardBytes('Tag', 'New body'));
    const rows = qa('.pmd-doc-diff-row');
    // Row 1: "Tag" is equal on both sides. Row 2: body changed, left=remove, right=add.
    expect(rows).toHaveLength(2);
    const [equalRow, changedRow] = rows;
    expect(equalRow!.querySelector('.pmd-doc-diff-cell-left .pmd-doc-diff-text')?.textContent).toBe('Tag');
    expect(equalRow!.querySelector('.pmd-doc-diff-cell-right .pmd-doc-diff-text')?.textContent).toBe('Tag');
    expect(changedRow!.querySelector('.pmd-doc-diff-cell-remove .pmd-doc-diff-text')?.textContent).toBe('Old body');
    expect(changedRow!.querySelector('.pmd-doc-diff-cell-add .pmd-doc-diff-text')?.textContent).toBe('New body');
  });

  it('an edited line marks its changed words: struck through on the left, underlined on the right', async () => {
    await runCompare(cardBytes('Tag', 'The plan causes war by 2030.'), cardBytes('Tag', 'The plan prevents war by 2035.'));
    const changedRow = qa('.pmd-doc-diff-row')[1]!;
    const left = changedRow.querySelector('.pmd-doc-diff-cell-remove .pmd-doc-diff-text')!;
    const right = changedRow.querySelector('.pmd-doc-diff-cell-add .pmd-doc-diff-text')!;
    expect(Array.from(left.querySelectorAll('del.pmd-doc-diff-word')).map((e) => e.textContent)).toEqual(['causes', '2030']);
    expect(Array.from(right.querySelectorAll('ins.pmd-doc-diff-word')).map((e) => e.textContent)).toEqual(['prevents', '2035']);
    expect(left.querySelector('ins')).toBeNull();
    expect(right.querySelector('del')).toBeNull();
    // The whole line still reads in order around the marked words.
    expect(left.textContent).toBe('The plan causes war by 2030.');
    expect(right.textContent).toBe('The plan prevents war by 2035.');
  });

  it('unrelated replaced lines stay whole-line colored, with no word marks', async () => {
    await runCompare(cardBytes('Tag', 'Old body'), cardBytes('Tag', 'Entirely different sentence'));
    expect(qa('.pmd-doc-diff-word')).toHaveLength(0);
  });

  it('shows both filenames and a +/- summary count', async () => {
    await runCompare(cardBytes('Tag', 'Old body'), cardBytes('Tag', 'New body'), 'before.cmir', 'after.cmir');
    const names = q('.pmd-doc-diff-names')!.textContent!;
    expect(names).toContain('before.cmir');
    expect(names).toContain('after.cmir');
    expect(q('.pmd-doc-diff-summary-add')?.textContent).toBe('+1');
    expect(q('.pmd-doc-diff-summary-remove')?.textContent).toBe('−1');
  });

  it('identical documents report "No differences."', async () => {
    const bytes = cardBytes('Tag', 'Same body');
    await runCompare(bytes, bytes);
    expect(q('.pmd-doc-diff-summary')?.textContent).toBe('No differences.');
    for (const row of qa('.pmd-doc-diff-row')) {
      expect(row.querySelector('.pmd-doc-diff-cell-remove, .pmd-doc-diff-cell-add')).toBeNull();
    }
  });

  it('"Compare different files" returns to the picker with a fresh pick', () => {
    // Smoke-test the button exists and switches views without asserting
    // internal state — the picker-step tests above cover that view.
    return runCompare(cardBytes('T', 'A'), cardBytes('T', 'B')).then(() => {
      const back = qa('.pmd-doc-diff-topbar-actions .pmd-doc-diff-btn').find((b) => b.textContent === 'Compare different files');
      (back as HTMLButtonElement).click();
      expect(qa('.pmd-doc-diff-picker-row')).toHaveLength(2);
    });
  });

  it('Close closes the dialog', async () => {
    await runCompare(cardBytes('T', 'A'), cardBytes('T', 'B'));
    const close = qa('.pmd-doc-diff-topbar-actions .pmd-doc-diff-btn').find((b) => b.textContent === 'Close');
    (close as HTMLButtonElement).click();
    expect(q('.pmd-doc-diff-dialog')).toBeNull();
  });

  it('reads real .docx bytes too, not just .cmir (fromDocxFull, not parseNative)', async () => {
    const bytesA = await toDocx(cardDoc('Tag', 'Old body'));
    const bytesB = await toDocx(cardDoc('Tag', 'New body'));
    await runCompare(bytesA, bytesB, 'a.docx', 'b.docx');
    const rows = qa('.pmd-doc-diff-row');
    expect(rows).toHaveLength(2);
    const [equalRow, changedRow] = rows;
    expect(equalRow!.querySelector('.pmd-doc-diff-cell-left .pmd-doc-diff-text')?.textContent).toBe('Tag');
    expect(changedRow!.querySelector('.pmd-doc-diff-cell-remove .pmd-doc-diff-text')?.textContent).toBe('Old body');
    expect(changedRow!.querySelector('.pmd-doc-diff-cell-add .pmd-doc-diff-text')?.textContent).toBe('New body');
  });

  it('fills the viewport as a page, not a bounded popup', async () => {
    await runCompare(cardBytes('T', 'A'), cardBytes('T', 'B'));
    const dialog = q<HTMLElement>('.pmd-doc-diff-dialog')!;
    expect(dialog.style.maxWidth).toBe('');
    expect(dialog.classList.contains('pmd-doc-diff-dialog-wide')).toBe(false); // no such class anymore
  });
});

describe('Compare documents — the outline rails', () => {
  // jsdom doesn't implement scrollIntoView; stub it so clicking an
  // outline entry doesn't throw, and so the click can be observed.
  let scrollSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
  });

  function multiCardBytes(cards: Array<[tag: string, body: string]>): Uint8Array {
    const doc = schema.nodes['doc']!.createChecked(
      null,
      cards.map(([tag, body]) =>
        schema.nodes['card']!.createChecked(null, [
          schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
          schema.nodes['card_body']!.create(null, schema.text(body)),
        ]),
      ),
    );
    return serializeNative(doc);
  }

  async function runCompare(bytesA: Uint8Array, bytesB: Uint8Array): Promise<void> {
    openFileMock.mockResolvedValueOnce({ name: 'a.cmir', bytes: bytesA }).mockResolvedValueOnce({ name: 'b.cmir', bytes: bytesB });
    openDocDiff();
    pickerButtons()[0]!.click();
    await flush();
    pickerButtons()[1]!.click();
    await flush();
    compareBtn().click();
    await waitForResults();
  }

  it('lists one outline entry per heading, on both sides', async () => {
    await runCompare(
      multiCardBytes([
        ['First tag', 'body one'],
        ['Second tag', 'body two'],
      ]),
      multiCardBytes([['First tag', 'body one']]),
    );
    const left = qa('.pmd-doc-diff-outline-left .pmd-doc-diff-outline-entry').map((e) => e.textContent);
    const right = qa('.pmd-doc-diff-outline-right .pmd-doc-diff-outline-entry').map((e) => e.textContent);
    expect(left).toEqual(['First tag', 'Second tag']);
    expect(right).toEqual(['First tag']);
  });

  it('clicking an outline entry scrolls the matching diff row into view', async () => {
    await runCompare(
      multiCardBytes([
        ['First tag', 'body one'],
        ['Second tag', 'body two'],
      ]),
      multiCardBytes([
        ['First tag', 'body one'],
        ['Second tag', 'body two'],
      ]),
    );
    const entries = qa('.pmd-doc-diff-outline-left .pmd-doc-diff-outline-entry') as HTMLButtonElement[];
    const secondTagEntry = entries.find((e) => e.textContent === 'Second tag')!;
    expect(secondTagEntry.disabled).toBe(false);
    secondTagEntry.click();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    // The scrolled element is the row cell actually holding "Second tag".
    const scrolledEl = scrollSpy.mock.contexts[0] as HTMLElement;
    expect(scrolledEl.textContent).toContain('Second tag');
  });

  it('a heading with no matching diff line (e.g. untitled) renders disabled, not hidden', async () => {
    const untitled = schema.nodes['doc']!.createChecked(null, [
      schema.nodes['card']!.createChecked(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }), // empty tag text
        schema.nodes['card_body']!.create(null, schema.text('body')),
      ]),
    ]);
    await runCompare(serializeNative(untitled), cardBytes('Tag', 'body'));
    const entry = qa('.pmd-doc-diff-outline-left .pmd-doc-diff-outline-entry')[0] as HTMLButtonElement;
    expect(entry.disabled).toBe(true);
    expect(entry.textContent).toContain('untitled');
  });

  it('two same-named headings on one side jump to their own occurrence, not always the first', async () => {
    await runCompare(
      multiCardBytes([
        ['Extend', 'first occurrence body'],
        ['Extend', 'second occurrence body'],
      ]),
      multiCardBytes([['Extend', 'first occurrence body']]),
    );
    const entries = qa('.pmd-doc-diff-outline-left .pmd-doc-diff-outline-entry') as HTMLButtonElement[];
    expect(entries).toHaveLength(2);
    entries[1]!.click();
    const scrolledEl = scrollSpy.mock.contexts[0] as HTMLElement;
    // The second "Extend" entry must resolve to the SECOND row with that
    // text (the one belonging to the second card), not the first again.
    const allExtendCells = qa('.pmd-doc-diff-cell-left').filter(
      (e) => e.querySelector('.pmd-doc-diff-text')?.textContent === 'Extend',
    );
    expect(allExtendCells).toHaveLength(2);
    expect(scrolledEl).toBe(allExtendCells[1]);
  });
});
