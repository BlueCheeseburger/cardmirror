/**
 * Command-palette file search — matching + object extraction.
 */

import { describe, expect, it } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { importDoc } from '../../src/import/index.js';
import {
  baseName,
  dirName,
  fileFormat,
  stripFileExt,
  makeFileEntry,
  searchFiles,
  searchFileObjects,
  extractFile,
  type FileEntry,
  type FileObject,
  type FileObjectKind,
} from '../../src/editor/file-search.js';
import { isPathExcluded, filterExcludedFiles, exclusionContaining } from '../../src/editor/file-search.js';

describe('exclusions', () => {
  it('matches an excluded file exactly', () => {
    expect(isPathExcluded('/a/b/File.cmir', ['/a/b/File.cmir'])).toBe(true);
    expect(isPathExcluded('/a/b/File.cmir', ['/a/b/Other.cmir'])).toBe(false);
    expect(isPathExcluded('/a/b/File.cmir', [])).toBe(false);
  });

  it('an excluded folder covers its subtree, separator-aware', () => {
    expect(isPathExcluded('/a/b/x.cmir', ['/a/b'])).toBe(true);
    expect(isPathExcluded('/a/b/deep/x.cmir', ['/a/b'])).toBe(true);
    // Prefix of the NAME, not a path boundary — must not match.
    expect(isPathExcluded('/a/bc/x.cmir', ['/a/b'])).toBe(false);
  });

  it('tolerates a trailing separator on the exclusion entry', () => {
    expect(isPathExcluded('/a/b/x.cmir', ['/a/b/'])).toBe(true);
  });

  it('handles Windows separators both ways', () => {
    expect(isPathExcluded('C:\\camp\\b\\x.cmir', ['C:\\camp\\b'])).toBe(true);
    expect(isPathExcluded('C:\\camp\\b\\x.cmir', ['C:\\camp\\b\\'])).toBe(true);
    expect(isPathExcluded('C:\\camp\\bc\\x.cmir', ['C:\\camp\\b'])).toBe(false);
  });

  it('a search folder inside an excluded folder is still searched; the rest of the excluded folder is not', () => {
    const exclusions = ['/Debate/Old'];
    const roots = ['/Debate', '/Debate/Old/Keepers'];
    expect(isPathExcluded('/Debate/Old/Keepers/a.cmir', exclusions, roots)).toBe(false);
    expect(isPathExcluded('/Debate/Old/Keepers/deep/b.cmir', exclusions, roots)).toBe(false);
    // Everything else under the exclusion stays hidden, even though /Debate is a search folder.
    expect(isPathExcluded('/Debate/Old/c.cmir', exclusions, roots)).toBe(true);
    expect(isPathExcluded('/Debate/Old/Other/d.cmir', exclusions, roots)).toBe(true);
    // Without the search folder the whole exclusion applies, as before.
    expect(isPathExcluded('/Debate/Old/Keepers/a.cmir', exclusions, ['/Debate'])).toBe(true);
    expect(isPathExcluded('/Debate/Old/Keepers/a.cmir', exclusions)).toBe(true);
  });

  it('an exclusion deeper than the search folder still wins for what it covers', () => {
    const exclusions = ['/Debate/Old', '/Debate/Old/Keepers/Drafts'];
    const roots = ['/Debate/Old/Keepers'];
    expect(isPathExcluded('/Debate/Old/Keepers/a.cmir', exclusions, roots)).toBe(false);
    expect(isPathExcluded('/Debate/Old/Keepers/Drafts/x.cmir', exclusions, roots)).toBe(true);
  });

  it('a folder that is both excluded and a search folder stays excluded', () => {
    expect(isPathExcluded('/Debate/Old/a.cmir', ['/Debate/Old'], ['/Debate/Old'])).toBe(true);
    expect(isPathExcluded('/Debate/Old/a.cmir', ['/Debate/Old/'], ['/Debate/Old'])).toBe(true);
  });

  it('exclusionContaining names the excluded folder a search folder sits inside', () => {
    expect(exclusionContaining('/Debate/Old/Keepers', ['/Debate/Old'])).toBe('/Debate/Old');
    expect(exclusionContaining('/Debate/Old/Keepers/', ['/Debate/Old/'])).toBe('/Debate/Old/');
    // The deepest one when several nest.
    expect(exclusionContaining('/a/b/c/d', ['/a', '/a/b'])).toBe('/a/b');
    // Not inside: the same folder, a sibling, or a name that merely starts the same.
    expect(exclusionContaining('/Debate/Old', ['/Debate/Old'])).toBeNull();
    expect(exclusionContaining('/Debate/Older', ['/Debate/Old'])).toBeNull();
    expect(exclusionContaining('/Debate/New', ['/Debate/Old'])).toBeNull();
    expect(exclusionContaining('C:\\camp\\b\\c', ['C:\\camp\\b'])).toBe('C:\\camp\\b');
  });

  it('filterExcludedFiles keeps a search folder inside an exclusion', () => {
    const files = [
      makeFileEntry('/x/Old/Keep/a.cmir', 'Old/Keep/a.cmir', 1),
      makeFileEntry('/x/Old/b.cmir', 'Old/b.cmir', 2),
    ];
    expect(filterExcludedFiles(files, ['/x/Old'], ['/x', '/x/Old/Keep']).map((f) => f.path)).toEqual(['/x/Old/Keep/a.cmir']);
  });

  it('filterExcludedFiles drops excluded entries and keeps the rest', () => {
    const files = [
      makeFileEntry('/r/keep.cmir', 'keep.cmir', 1),
      makeFileEntry('/r/gone.cmir', 'gone.cmir', 2),
      makeFileEntry('/r/sub/gone-too.cmir', 'sub/gone-too.cmir', 3),
    ];
    const out = filterExcludedFiles(files, ['/r/gone.cmir', '/r/sub']);
    expect(out.map((f) => f.path)).toEqual(['/r/keep.cmir']);
  });
});

describe('path helpers', () => {
  it('baseName takes the last segment', () => {
    expect(baseName('a/b/c.cmir')).toBe('c.cmir');
    expect(baseName('c.cmir')).toBe('c.cmir');
    expect(baseName('a\\b\\c.cmir')).toBe('c.cmir');
  });
  it('dirName drops the filename', () => {
    expect(dirName('a/b/c.cmir')).toBe('a/b');
    expect(dirName('c.cmir')).toBe('');
  });
  it('fileFormat reads the extension (default cmir)', () => {
    expect(fileFormat('a/b/c.cmir')).toBe('cmir');
    expect(fileFormat('Heg Good.docx')).toBe('docx');
    expect(fileFormat('SHOUTY.DOCX')).toBe('docx');
    expect(fileFormat('no-ext')).toBe('cmir');
  });
  it('stripFileExt removes only the openable extension', () => {
    expect(stripFileExt('Warming Impacts.cmir')).toBe('Warming Impacts');
    expect(stripFileExt('Heg Good.docx')).toBe('Heg Good');
    expect(stripFileExt('my.report.cmir')).toBe('my.report'); // other dots kept
    expect(stripFileExt('plain')).toBe('plain');
  });
});

function file(name: string, relPath = name, mtimeMs = 0): FileEntry {
  const entry = makeFileEntry(`/root/${relPath}`, relPath, mtimeMs);
  // Some cases name the entry differently from its relPath basename;
  // keep that freedom while the lowered match field stays in sync.
  return { ...entry, name, nameLower: name.toLowerCase() };
}

describe('makeFileEntry', () => {
  it('derives the display name and precomputed lowercase match fields', () => {
    const e = makeFileEntry('/r/Neg/Warming DA.cmir', 'Neg/Warming DA.cmir', 5);
    expect(e.name).toBe('Warming DA');
    expect(e.nameLower).toBe('warming da');
    expect(e.dirLower).toBe('neg');
    expect(e.mtimeMs).toBe(5);
  });

  it('matching runs on the precomputed fields — mixed-case query and name still meet', () => {
    // Regression for the pre-lowered refactor: if a caller ever builds
    // entries without lowering, this stops matching.
    const files = [file('Warming Impacts.cmir', 'NEG/Warming Impacts.cmir')];
    expect(searchFiles(files, 'WARMING').length).toBe(1);
    expect(searchFiles(files, 'neg warming').length).toBe(1); // cross-field tokens
  });
});

describe('searchFiles', () => {
  const files = [file('Warming Impacts.cmir'), file('Heg Good.cmir'), file('warming good.cmir')];

  it('empty query returns everything', () => {
    expect(searchFiles(files, '').length).toBe(3);
  });

  it('order-independent multi-token AND match', () => {
    const r = searchFiles(files, 'good warming');
    expect(r.map((f) => f.name)).toEqual(['warming good.cmir']);
  });

  it('both prefix matches tie and fall back to input order (mtime equal)', () => {
    const r = searchFiles(files, 'warming');
    // "Warming Impacts" and "warming good" both start with the query (tier 1);
    // equal mtime → the recency tiebreak is a no-op → input order.
    expect(r.map((f) => f.name)).toEqual(['Warming Impacts.cmir', 'warming good.cmir']);
  });
});

describe('searchFiles — relevance tiers', () => {
  const files = [
    file('Rewarming notes'), // substring, mid-word
    file('AT: Warming'), // word-start (not the label start)
    file('Warming DA'), // prefix
    file('Warming'), // exact
    file('Heg Good'), // no match
  ];

  it('orders exact → prefix → word-start → substring', () => {
    expect(searchFiles(files, 'warming').map((f) => f.name)).toEqual([
      'Warming',
      'Warming DA',
      'AT: Warming',
      'Rewarming notes',
    ]);
  });

  it('prefers a word-start over a mid-word substring', () => {
    const fs = [file('Software'), file('War powers')];
    expect(searchFiles(fs, 'war').map((f) => f.name)).toEqual(['War powers', 'Software']);
  });
});

describe('searchFiles — folder (relPath) matching', () => {
  it('matches a folder term via the relative path, ranked below a name hit', () => {
    const files = [
      file('Warming DA', 'Neg/Warming DA.cmir'),
      file('Impacts', 'Neg/Impacts.cmir'),
    ];
    // "neg" lives only in the folder → both match (secondary-only tier).
    expect(
      searchFiles(files, 'neg')
        .map((f) => f.name)
        .sort(),
    ).toEqual(['Impacts', 'Warming DA']);
    // "neg warming": only Warming DA has warming in the NAME and neg in the folder.
    expect(searchFiles(files, 'neg warming').map((f) => f.name)).toEqual(['Warming DA']);
  });
});

describe('searchFiles — tiebreak', () => {
  const files = [
    file('Beta', 'Beta.cmir', 100),
    file('Alpha', 'Alpha.cmir', 300),
    file('Gamma', 'Gamma.cmir', 200),
  ];

  it('recency: most-recently-modified first (also the no-query browse order)', () => {
    expect(searchFiles(files, '', 'recency').map((f) => f.name)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  it('alphabetical: by file name', () => {
    expect(searchFiles(files, '', 'alphabetical').map((f) => f.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('breaks same-tier ties by the chosen order', () => {
    const fs = [
      file('Warming Alpha', 'Warming Alpha.cmir', 100),
      file('Warming Zeta', 'Warming Zeta.cmir', 300),
    ];
    // both prefix matches (tier 1) → the tiebreak decides
    expect(searchFiles(fs, 'warming', 'recency').map((f) => f.name)).toEqual([
      'Warming Zeta',
      'Warming Alpha',
    ]);
    expect(searchFiles(fs, 'warming', 'alphabetical').map((f) => f.name)).toEqual([
      'Warming Alpha',
      'Warming Zeta',
    ]);
  });
});

describe('searchFileObjects', () => {
  const objs: FileObject[] = [
    { kind: 'block', label: 'Warming Bad', detail: '', from: 0, to: 0 },
    { kind: 'tag', label: 'Smith says warming is bad', detail: '', from: 0, to: 0 },
    { kind: 'cite', label: 'Jones 24', detail: 'Heg key', from: 0, to: 0 },
  ];
  it('matches on label across kinds', () => {
    expect(searchFileObjects(objs, 'warming').map((o) => o.kind)).toEqual(['block', 'tag']);
  });
  it('empty query returns all', () => {
    expect(searchFileObjects(objs, '').length).toBe(3);
  });
  it('matches a tag by its card cite, not just its label', () => {
    const withCite: FileObject[] = [
      { kind: 'tag', label: 'Heg good', detail: '', cite: 'Brooks 24', from: 0, to: 0 },
    ];
    // Query is only in the cite, not the tag label.
    expect(searchFileObjects(withCite, 'brooks').map((o) => o.label)).toEqual(['Heg good']);
  });

  it('a label hit outranks a cite-only hit', () => {
    const mixed: FileObject[] = [
      { kind: 'tag', label: 'Heg good', detail: '', cite: 'Warming 24', from: 0, to: 0 }, // cite-only
      { kind: 'block', label: 'Warming Bad', detail: '', from: 0, to: 0 }, // label prefix
    ];
    expect(searchFileObjects(mixed, 'warming').map((o) => o.label)).toEqual([
      'Warming Bad',
      'Heg good',
    ]);
  });

  it('keeps same-tier matches in document (input) order', () => {
    const objs: FileObject[] = [
      { kind: 'tag', label: 'Warming second', detail: '', from: 10, to: 20 },
      { kind: 'tag', label: 'Warming first', detail: '', from: 0, to: 5 },
    ];
    // both prefix matches (tier 1) → preserve input order, never re-sorted
    expect(searchFileObjects(objs, 'warming').map((o) => o.label)).toEqual([
      'Warming second',
      'Warming first',
    ]);
  });
});

// ── Object extraction ───────────────────────────────────────────────

function citePara(...runs: { text: string; cite?: boolean }[]) {
  const inline = runs.map((r) =>
    schema.text(r.text, r.cite ? [schema.marks['cite_mark']!.create()] : []),
  );
  return schema.nodes['cite_paragraph']!.create(null, inline);
}

function block(text: string) {
  return schema.nodes['block']!.create({ id: newHeadingId() }, schema.text(text));
}

function card(tagText: string, cite: ReturnType<typeof citePara>) {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tagText)),
    cite,
  ]);
}

function sampleDoc() {
  return schema.nodes['doc']!.createChecked(null, [
    block('Warming Bad'),
    card('Smith says X', citePara({ text: 'Smith 23', cite: true })),
  ]);
}

const enabled = (...k: FileObjectKind[]) => new Set<FileObjectKind>(k);

describe('extractFile — objects', () => {
  it('surfaces block, tag, and cite by default', () => {
    const { objects } = extractFile(sampleDoc(), enabled('block', 'tag', 'cite'));
    const byKind = (k: FileObjectKind) => objects.filter((o) => o.kind === k).map((o) => o.label);
    expect(byKind('block')).toEqual(['Warming Bad']);
    expect(byKind('tag')).toEqual(['Smith says X']);
    expect(byKind('cite')).toEqual(['Smith 23']);
  });

  it('the cite object carries its owning tag as detail', () => {
    const cite = extractFile(sampleDoc(), enabled('cite')).objects.find((o) => o.kind === 'cite');
    expect(cite?.detail).toBe('Smith says X');
  });

  it('the tag object carries its card cite — even when the cite KIND is off', () => {
    // `enabled('tag')` only: no standalone CITE rows, but the tag still
    // carries its citation so it stays findable by it.
    const tag = extractFile(sampleDoc(), enabled('tag')).objects.find((o) => o.kind === 'tag');
    expect(tag?.cite).toBe('Smith 23');
  });

  it('a tag is searchable by its cite with the cite kind off', () => {
    const { objects } = extractFile(sampleDoc(), enabled('tag'));
    // "23" appears only in the cite (Smith 23), not the label (Smith says X).
    expect(searchFileObjects(objects, '23').map((o) => o.label)).toEqual(['Smith says X']);
  });

  it('respects the enabled set', () => {
    const { objects } = extractFile(sampleDoc(), enabled('tag'));
    expect(objects.map((o) => o.kind)).toEqual(['tag']);
  });

  it('empty enabled set yields no objects', () => {
    expect(extractFile(sampleDoc(), enabled()).objects).toEqual([]);
  });

  it('every object carries a valid insert range', () => {
    const { objects } = extractFile(sampleDoc(), enabled('block', 'tag', 'cite'));
    for (const o of objects) {
      expect(Number.isFinite(o.from)).toBe(true);
      expect(o.to).toBeGreaterThanOrEqual(o.from);
    }
  });
});

describe('extractFile — outline', () => {
  it('returns the full structural hierarchy with levels, regardless of enabled', () => {
    const { outline } = extractFile(sampleDoc(), enabled()); // nothing enabled for search
    expect(outline.map((o) => [o.kind, o.level, o.label])).toEqual([
      ['block', 3, 'Warming Bad'],
      ['tag', 4, 'Smith says X'],
    ]);
  });

  it('never includes cites (not headings)', () => {
    const { outline } = extractFile(sampleDoc(), enabled('cite'));
    expect(outline.some((o) => o.kind === 'cite')).toBe(false);
  });
});

// In-file object search has full .docx parity because the dive parses .docx
// (via `fromDocx`, which calls `importDoc`) into the SAME schema as .cmir, and
// `extractFile` works off that doc. This guards that a docx-imported doc is
// searchable just like the hand-built ones above.
describe('extractFile — parity with .docx-imported docs', () => {
  function bodyXml(inner: string): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${inner}</w:body></w:document>`;
  }

  it('surfaces block / tag / cite objects from a doc imported from docx XML', () => {
    const doc = importDoc(
      bodyXml(`
        <w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Warming Bad</w:t></w:r></w:p>
        <w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Smith says X</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:rStyle w:val="Style13ptBold"/></w:rPr><w:t>Smith 23</w:t></w:r></w:p>
      `),
    );
    const { objects } = extractFile(doc, enabled('block', 'tag', 'cite'));
    const byKind = (k: FileObjectKind) => objects.filter((o) => o.kind === k).map((o) => o.label);
    expect(byKind('block')).toEqual(['Warming Bad']);
    expect(byKind('tag')).toEqual(['Smith says X']);
    expect(byKind('cite')).toEqual(['Smith 23']);
    // And the tag is findable by its card's cite, same as .cmir.
    expect(searchFileObjects(objects, '23').map((o) => o.kind)).toContain('tag');
  });
});
