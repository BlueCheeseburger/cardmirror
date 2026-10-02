// @vitest-environment jsdom
/**
 * The "what's new" popup after an update: when it shows, what it fetches,
 * how release-note markdown renders (without trusting its markup), and that
 * a failed fetch is retried on a later launch instead of being lost.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  decideWhatsNew,
  releaseApiUrl,
  fetchReleaseNotes,
  renderReleaseNotes,
  maybeShowWhatsNew,
  showWhatsNewDialog,
  __whatsNewMarkerForTests as MARKER,
} from '../../src/editor/whats-new.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('decideWhatsNew', () => {
  it('shows nothing when this version was already seen', () => {
    expect(decideWhatsNew({ stored: '1.2.0', current: '1.2.0', returningInstall: true })).toBe('none');
  });
  it('shows the notes after an update', () => {
    expect(decideWhatsNew({ stored: '1.1.0', current: '1.2.0', returningInstall: true })).toBe('show');
  });
  it('just records the version on a fresh install', () => {
    expect(decideWhatsNew({ stored: null, current: '1.2.0', returningInstall: false })).toBe('record');
  });
  it('shows the notes to a returning install that has no marker yet', () => {
    expect(decideWhatsNew({ stored: null, current: '1.2.0', returningInstall: true })).toBe('show');
  });
});

describe('fetchReleaseNotes', () => {
  const ok = (body: unknown): typeof fetch =>
    (async () => ({ ok: true, json: async () => ({ body }) }) as Response) as unknown as typeof fetch;

  it('asks for the release by tag', () => {
    expect(releaseApiUrl('1.13.0-bcb.5')).toBe(
      'https://api.github.com/repos/BlueCheeseburger/cardmirror/releases/tags/v1.13.0-bcb.5',
    );
  });
  it('returns the release body', async () => {
    expect(await fetchReleaseNotes('1.0.0', ok('### Added\n\n- A thing\n'))).toBe('### Added\n\n- A thing');
  });
  it('is null for an empty body, an HTTP error, or a thrown request', async () => {
    expect(await fetchReleaseNotes('1.0.0', ok('  '))).toBeNull();
    expect(await fetchReleaseNotes('1.0.0', (async () => ({ ok: false }) as Response) as unknown as typeof fetch)).toBeNull();
    expect(await fetchReleaseNotes('1.0.0', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe('renderReleaseNotes', () => {
  it('renders headings, bullets with continuation lines, bold, code and links', () => {
    const el = renderReleaseNotes(
      [
        '### Changed',
        '',
        '- **Mod-F11 highlights with white.** F11 still',
        '  uses the selected color. See `Settings`.',
        '- Read [the docs](https://example.com/docs).',
        '',
        '### Fixed',
        '',
        '- One more.',
      ].join('\n'),
    );
    expect(el.querySelectorAll('h3').length).toBe(2);
    const items = el.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0]!.querySelector('strong')!.textContent).toBe('Mod-F11 highlights with white.');
    expect(items[0]!.textContent).toContain('F11 still uses the selected color.');
    expect(items[0]!.querySelector('code')!.textContent).toBe('Settings');
    const a = items[1]!.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/docs');
  });

  it('never turns release text into markup or a non-web link', () => {
    const el = renderReleaseNotes('- <img src=x onerror=alert(1)> and [bad](javascript:alert(1))');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('maybeShowWhatsNew', () => {
  const base = { openExternal: vi.fn() };

  it('records a fresh install without fetching or showing', async () => {
    const fetchNotes = vi.fn(async () => 'notes');
    const show = vi.fn(async () => {});
    const r = await maybeShowWhatsNew({ ...base, version: '2.0.0', returningInstall: false, fetchNotes, show });
    expect(r).toBe('record');
    expect(fetchNotes).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(localStorage.getItem(MARKER)).toBe('2.0.0');
  });

  it('shows the notes once after an update, then stays quiet', async () => {
    localStorage.setItem(MARKER, '1.0.0');
    const show = vi.fn(async () => {});
    const fetchNotes = vi.fn(async () => '- New thing');
    expect(await maybeShowWhatsNew({ ...base, version: '2.0.0', fetchNotes, show })).toBe('show');
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ version: '2.0.0', notes: '- New thing' }));
    expect(localStorage.getItem(MARKER)).toBe('2.0.0');
    expect(await maybeShowWhatsNew({ ...base, version: '2.0.0', fetchNotes, show })).toBe('none');
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('leaves the marker alone when the notes cannot be fetched, so a later launch retries', async () => {
    localStorage.setItem(MARKER, '1.0.0');
    const show = vi.fn(async () => {});
    expect(await maybeShowWhatsNew({ ...base, version: '2.0.0', fetchNotes: async () => null, show })).toBe('none');
    expect(show).not.toHaveBeenCalled();
    expect(localStorage.getItem(MARKER)).toBe('1.0.0');
  });
});

describe('showWhatsNewDialog', () => {
  it('closes on Got it, and its links and the GitHub button open outside the app', async () => {
    const openExternal = vi.fn();
    const done = showWhatsNewDialog({ version: '2.0.0', notes: '- See [docs](https://example.com)', openExternal });
    const dialog = document.querySelector('.pmd-whatsnew')!;
    expect(dialog.querySelector('.pmd-whatsnew-title')!.textContent).toBe("What's new in 2.0.0");
    dialog.querySelector<HTMLAnchorElement>('a')!.click();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'View on GitHub')!.click();
    expect(openExternal).toHaveBeenLastCalledWith(
      'https://github.com/BlueCheeseburger/cardmirror/releases/tag/v2.0.0',
    );
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Got it')!.click();
    await done;
    expect(document.querySelector('.pmd-whatsnew')).toBeNull();
  });
});
