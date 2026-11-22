// @vitest-environment jsdom
/**
 * The popups for search folders and exclusions that overlap: a search folder
 * added inside an excluded folder, and an exclusion added around search folders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/editor/confirm-dialog.js', () => ({ showConfirm: vi.fn() }));

import { showConfirm } from '../../src/editor/confirm-dialog.js';
import { settings } from '../../src/editor/settings.js';
import { searchFoldersInside } from '../../src/editor/file-search.js';
import {
  confirmExclusion,
  confirmSearchFolder,
  exclusionAroundRootsPrompt,
  folderName,
  rootInsideExclusionPrompt,
} from '../../src/editor/exclusion-notices.js';

const confirmMock = vi.mocked(showConfirm);

beforeEach(() => {
  confirmMock.mockReset();
  settings.set('fileSearchRoots', []);
  settings.set('fileSearchExclusions', []);
});

describe('searchFoldersInside', () => {
  it('lists the search folders strictly inside an exclusion', () => {
    const roots = ['/Debate', '/Debate/Old/Keepers', '/Debate/Old', '/Debate/Older', '/Debate/Old/Deep/er'];
    expect(searchFoldersInside('/Debate/Old', roots)).toEqual(['/Debate/Old/Keepers', '/Debate/Old/Deep/er']);
    expect(searchFoldersInside('/Debate/Old/', roots)).toEqual(['/Debate/Old/Keepers', '/Debate/Old/Deep/er']);
    expect(searchFoldersInside('/Elsewhere', roots)).toEqual([]);
    expect(searchFoldersInside('C:\\camp\\b', ['C:\\camp\\b\\c', 'C:\\camp\\bc'])).toEqual(['C:\\camp\\b\\c']);
  });
});

describe('the wording', () => {
  it('names folders by their last part', () => {
    expect(folderName('/Users/sam/Dropbox/Old/')).toBe('Old');
    expect(folderName('C:\\camp\\Keepers')).toBe('Keepers');
  });

  it('a search folder inside an exclusion says what stays hidden and what is searched', () => {
    const p = rootInsideExclusionPrompt('/D/Old/Keepers', '/D/Old');
    expect(p.title).toBe('This folder is inside an excluded folder');
    expect(p.message).toContain('“Keepers” is inside “Old”, which you excluded from file search.');
    expect(p.message).toContain('Everything else in “Old” stays hidden, but “Keepers” and its subfolders will be searched.');
    expect([p.confirmLabel, p.cancelLabel]).toEqual(['Search this folder', 'Don’t add']);
  });

  it('an exclusion around one search folder names it', () => {
    const p = exclusionAroundRootsPrompt('/D/Old', ['/D/Old/Keepers']);
    expect(p.title).toBe('This folder contains a search folder');
    expect(p.message).toContain('“Old” contains a folder you search: “Keepers”.');
    expect(p.message).toContain('It and its subfolders will still be searched; everything else in “Old” will be hidden.');
    expect([p.confirmLabel, p.cancelLabel]).toEqual(['Exclude', 'Cancel']);
  });

  it('an exclusion around several search folders counts them', () => {
    expect(exclusionAroundRootsPrompt('/D/Old', ['/D/Old/A', '/D/Old/B']).message).toContain(
      '“Old” contains 2 folders you search: “A” and “B”.',
    );
    expect(exclusionAroundRootsPrompt('/D/Old', ['/D/Old/A', '/D/Old/B', '/D/Old/C', '/D/Old/D', '/D/Old/E']).message).toContain(
      '5 folders you search: “A”, “B”, “C” and 2 more.',
    );
    expect(exclusionAroundRootsPrompt('/D/Old', ['/D/Old/A', '/D/Old/B']).message).toContain(
      'They and their subfolders will still be searched',
    );
  });
});

describe('confirmSearchFolder', () => {
  it('goes ahead without a popup when the folder is not inside an exclusion', async () => {
    settings.set('fileSearchExclusions', ['/D/Old']);
    expect(await confirmSearchFolder('/D/New')).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('asks when it is, and returns the answer', async () => {
    settings.set('fileSearchExclusions', ['/D/Old']);
    confirmMock.mockResolvedValueOnce(false);
    expect(await confirmSearchFolder('/D/Old/Keepers')).toBe(false);
    confirmMock.mockResolvedValueOnce(true);
    expect(await confirmSearchFolder('/D/Old/Keepers')).toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(2);
  });
});

describe('confirmExclusion', () => {
  it('goes ahead without a popup when it contains no search folder', async () => {
    settings.set('fileSearchRoots', ['/D/New']);
    expect(await confirmExclusion('/D/Old')).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('asks when it contains a search folder, and returns the answer', async () => {
    settings.set('fileSearchRoots', ['/D', '/D/Old/Keepers']);
    confirmMock.mockResolvedValueOnce(false);
    expect(await confirmExclusion('/D/Old')).toBe(false);
    expect(confirmMock.mock.calls[0]![0].message).toContain('“Keepers”');
    // A search folder that IS the exclusion is not "inside" it.
    settings.set('fileSearchRoots', ['/D/Old']);
    confirmMock.mockClear();
    expect(await confirmExclusion('/D/Old')).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
