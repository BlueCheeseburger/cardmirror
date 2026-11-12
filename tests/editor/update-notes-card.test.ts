// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { summarizeReleaseNotes, attachUpdateNotesCard } from '../../src/editor/update-notes-card.js';

const NOTES = `### Added

- **The Card menu can run Cross-Ex Practice on just the cards you pick.** With AI on, the toolbar's **Card** menu has a new section.
- **A notice appears in read mode.** It says why.

### Fixed

- F11 can highlight a \`%\` next to a number. It used to do nothing.
- **Words you highlight over grey now count.**
  A second line of the same bullet.
`;

describe('summarizeReleaseNotes', () => {
  it('keeps the sections and one headline per bullet (bold lead, else first sentence)', () => {
    const { sections, more } = summarizeReleaseNotes(NOTES);
    expect(more).toBe(0);
    expect(sections.map((s) => s.title)).toEqual(['Added', 'Fixed']);
    expect(sections[0]!.items).toEqual([
      'The Card menu can run Cross-Ex Practice on just the cards you pick.',
      'A notice appears in read mode.',
    ]);
    expect(sections[1]!.items).toEqual([
      'F11 can highlight a % next to a number.',
      'Words you highlight over grey now count.',
    ]);
  });

  it('caps a section at 3 and the whole list at 6, counting the rest', () => {
    const bullets = (n: number) => Array.from({ length: n }, (_, i) => `- **Item ${i}.** detail`).join('\n');
    const md = `### A\n\n${bullets(6)}\n\n### B\n\n${bullets(6)}\n\n### C\n\n${bullets(3)}\n`;
    const { sections, more } = summarizeReleaseNotes(md);
    expect(sections.map((s) => s.items.length)).toEqual([3, 3]);
    expect(more).toBe(3 + 3 + 3);
  });

  it('shortens a very long headline and copes with notes that have no headings or bullets', () => {
    const long = `- **${'word '.repeat(60)}end.**`;
    expect(summarizeReleaseNotes(long).sections[0]!.items[0]!.length).toBeLessThanOrEqual(110);
    expect(summarizeReleaseNotes('Just a paragraph of text.')).toEqual({ sections: [], more: 0 });
  });
});

describe('the release-notes card on the chip', () => {
  let chip: HTMLButtonElement;
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pmd-update-notes')];

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    chip = document.createElement('button');
    chip.id = 'update-chip';
    document.body.appendChild(chip);
  });
  afterEach(() => vi.useRealTimers());

  const make = (over: Partial<Parameters<typeof attachUpdateNotesCard>[1]> = {}) => {
    const fetchNotes = vi.fn(async (_v: string) => NOTES as string | null);
    const showDialog = vi.fn(async () => {});
    const openExternal = vi.fn();
    const detach = attachUpdateNotesCard(chip, {
      getVersion: () => '1.17.3',
      getAction: () => 'install',
      openExternal,
      fetchNotes,
      showDialog,
      ...over,
    });
    return { fetchNotes, showDialog, openExternal, detach };
  };
  const hover = async (): Promise<void> => {
    chip.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(400);
    await flush();
  };

  it('shows the headlines after a short hover, with the install hint', async () => {
    const { fetchNotes } = make();
    await hover();
    expect(fetchNotes).toHaveBeenCalledWith('1.17.3');
    const [card] = cards();
    expect(card!.textContent).toContain("What's new in 1.17.3");
    expect(card!.textContent).toContain('The Card menu can run Cross-Ex Practice on just the cards you pick.');
    expect(card!.textContent).toContain('Click the chip to install');
  });

  it('shows nothing for a download in progress, a plugin update or a hidden chip', async () => {
    make({ getVersion: () => null });
    await hover();
    expect(cards()).toHaveLength(0);
    chip.hidden = true;
    make();
    await hover();
    expect(cards()).toHaveLength(0);
  });

  it('hides when the pointer leaves (after a grace) and when the chip is pressed', async () => {
    make();
    await hover();
    expect(cards()).toHaveLength(1);
    chip.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(300);
    expect(cards()).toHaveLength(0);
    await hover();
    chip.dispatchEvent(new Event('pointerdown'));
    expect(cards()).toHaveLength(0);
  });

  it('stays while the pointer moves onto the card', async () => {
    make();
    await hover();
    chip.dispatchEvent(new MouseEvent('mouseleave'));
    cards()[0]!.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(500);
    expect(cards()).toHaveLength(1);
  });

  it('"Read the full notes…" opens the What\'s new dialog with those notes', async () => {
    const { showDialog } = make();
    await hover();
    cards()[0]!.querySelector<HTMLButtonElement>('.pmd-update-notes-link')!.click();
    expect(showDialog).toHaveBeenCalledWith(expect.objectContaining({ version: '1.17.3', notes: NOTES }));
    expect(cards()).toHaveLength(0);
  });

  it('says so when the notes cannot be loaded, links to the release page, and retries next time', async () => {
    const fetchNotes = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(NOTES);
    const { openExternal } = make({ fetchNotes });
    await hover();
    expect(cards()[0]!.textContent).toContain("The release notes couldn't be loaded.");
    cards()[0]!.querySelector<HTMLButtonElement>('.pmd-update-notes-link')!.click();
    expect(openExternal).toHaveBeenCalledWith('https://github.com/BlueCheeseburger/cardmirror/releases/tag/v1.17.3');
    chip.dispatchEvent(new Event('pointerdown'));
    await hover();
    expect(fetchNotes).toHaveBeenCalledTimes(2);
    expect(cards()[0]!.textContent).toContain('A notice appears in read mode.');
  });

  it('fetches a version\'s notes once', async () => {
    const { fetchNotes } = make();
    await hover();
    chip.dispatchEvent(new Event('pointerdown'));
    await hover();
    expect(fetchNotes).toHaveBeenCalledTimes(1);
  });

  it('says "download" for an update that is only available, and Escape closes it', async () => {
    make({ getAction: () => 'download' });
    await hover();
    expect(cards()[0]!.textContent).toContain('Click the chip to download');
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cards()).toHaveLength(0);
  });
});

describe('wired through initUpdateChip', () => {
  it('shows the card for a ready update, not while downloading, and not for plugins', async () => {
    vi.useFakeTimers();
    try {
      document.body.replaceChildren();
      const chip = document.createElement('button');
      document.body.appendChild(chip);
      const { initUpdateChip } = await import('../../src/editor/update-chip.js');
      let push: (s: unknown) => void = () => {};
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ body: '### Fixed\n\n- **One fix.** detail' }) }));
      vi.stubGlobal('fetch', fetchMock);
      const dispose = initUpdateChip(chip, {
        getUpdateChipState: async () => null,
        updateChipAction: async () => {},
        onUpdateChip: (h) => {
          push = h as (s: unknown) => void;
          return () => {};
        },
      });
      const flush = async (): Promise<void> => {
        for (let i = 0; i < 8; i++) await Promise.resolve();
      };
      const hover = async (): Promise<void> => {
        chip.dispatchEvent(new MouseEvent('mouseenter'));
        vi.advanceTimersByTime(400);
        await flush();
      };
      push({ state: 'downloading', version: '9.9.9', pct: 10 });
      await hover();
      expect(document.querySelectorAll('.pmd-update-notes')).toHaveLength(0);
      push({ state: 'plugins', plugins: [{ name: 'x', version: '1' }] });
      await hover();
      expect(document.querySelectorAll('.pmd-update-notes')).toHaveLength(0);
      push({ state: 'ready', version: '9.9.9' });
      await hover();
      expect(document.querySelector('.pmd-update-notes')?.textContent).toContain('One fix.');
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/releases/tags/v9.9.9');
      dispose();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('the chip itself', () => {
  it('has no tooltip for ready / available (the card replaces it) but keeps an accessible name', async () => {
    const { renderUpdateChip } = await import('../../src/editor/update-chip.js');
    const el = document.createElement('button');
    el.title = 'stale';
    renderUpdateChip(el, { state: 'ready', version: '1.0.0' });
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.getAttribute('aria-label')).toMatch(/restart/i);
    renderUpdateChip(el, { state: 'available', version: '1.0.0' });
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.getAttribute('aria-label')).toMatch(/release page/i);
    renderUpdateChip(el, { state: 'downloading', version: '1.0.0', pct: 5 });
    expect(el.hasAttribute('aria-label')).toBe(false);
  });
});
