// @vitest-environment jsdom
/**
 * `filterSliceForReadMode` — the copy-time filter that keeps a clipboard
 * slice down to what read mode actually shows.
 *
 * Root cause of the bug this fixes: read mode only CSS-hides filler text
 * (`pmd-rm-hide`) — it stays in the doc model. A DOM selection drawn over
 * the visible spans still maps back to model positions that SPAN the
 * hidden text in between, so `state.doc.slice(from, to)` (what
 * `transformCopied` starts from) includes it. This filter strips it back
 * out before the slice reaches the clipboard, mirroring exactly what the
 * live decorations show.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Fragment, Slice } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { filterSliceForReadMode } from '../../src/editor/read-mode-plugin.js';
import { settings } from '../../src/editor/settings.js';

function sliceOf(...nodes: PMNode[]): Slice {
  return new Slice(Fragment.from(nodes), 0, 0);
}

function textOf(slice: Slice): string {
  return slice.content.textBetween(0, slice.content.size, '␤', '␤');
}

describe('filterSliceForReadMode', () => {
  it('keeps only highlighted text in a card_body, joined with a single space across a dropped gap', () => {
    const body = schema.nodes['card_body']!.create(null, [
      schema.text('kept one ', [schema.marks['highlight']!.create({ color: 'yellow' })]),
      schema.text('dropped filler '),
      schema.text('kept two', [schema.marks['highlight']!.create({ color: 'yellow' })]),
    ]);
    const filtered = filterSliceForReadMode(sliceOf(body));
    expect(textOf(filtered)).toBe('kept one kept two');
    expect(textOf(filtered)).not.toContain('dropped filler');
  });

  it('keeps cite-marked and highlighted runs in a cite_paragraph; drops plain filler', () => {
    const cite = schema.nodes['cite_paragraph']!.create(null, [
      schema.text('AuthorName ', [schema.marks['cite_mark']!.create()]),
      schema.text('plain filler the reader skips '),
      schema.text('highlighted phrase', [schema.marks['highlight']!.create({ color: 'yellow' })]),
    ]);
    const filtered = filterSliceForReadMode(sliceOf(cite));
    const text = textOf(filtered);
    expect(text).toContain('AuthorName');
    expect(text).toContain('highlighted phrase');
    expect(text).not.toContain('plain filler');
  });

  it('drops a card_body down to empty when nothing in it is highlighted', () => {
    const body = schema.nodes['card_body']!.create(null, schema.text('all plain filler'));
    const filtered = filterSliceForReadMode(sliceOf(body));
    expect(textOf(filtered).trim()).toBe('');
  });

  it('recurses through a card, filtering its cite and body while keeping the tag intact', () => {
    const card = schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag text always shows')),
      schema.nodes['cite_paragraph']!.create(null, [
        schema.text('kept', [schema.marks['highlight']!.create({ color: 'yellow' })]),
        schema.text(' dropped'),
      ]),
      schema.nodes['card_body']!.create(null, [
        schema.text('kept body', [schema.marks['highlight']!.create({ color: 'yellow' })]),
        schema.text(' dropped body'),
      ]),
    ]);
    const filtered = filterSliceForReadMode(sliceOf(card));
    const outCard = filtered.content.firstChild!;
    expect(outCard.type.name).toBe('card');
    const text = textOf(filtered);
    expect(text).toContain('Tag text always shows');
    expect(text).toContain('kept');
    expect(text).toContain('kept body');
    expect(text).not.toContain('dropped');
    expect(text).not.toContain('dropped body');
  });

  it('passes a non-text inline leaf (e.g. an image) through untouched', () => {
    const body = schema.nodes['card_body']!.create(null, [
      schema.text('dropped before '),
      schema.nodes['image']!.create({ src: 'x.png' }),
      schema.text(' dropped after'),
    ]);
    const filtered = filterSliceForReadMode(sliceOf(body));
    let sawImage = false;
    filtered.content.firstChild!.forEach((child) => {
      if (child.type.name === 'image') sawImage = true;
    });
    expect(sawImage).toBe(true);
    expect(textOf(filtered)).not.toContain('dropped');
  });

  it('preserves openStart/openEnd from the source slice', () => {
    const body = schema.nodes['card_body']!.create(null, [
      schema.text('kept', [schema.marks['highlight']!.create({ color: 'yellow' })]),
    ]);
    const slice = new Slice(Fragment.from(body), 1, 1);
    const filtered = filterSliceForReadMode(slice);
    expect(filtered.openStart).toBe(1);
    expect(filtered.openEnd).toBe(1);
  });

  describe('"Read mode: keep entire cite" on', () => {
    const before = settings.get('readModeKeepEntireCite');
    afterEach(() => settings.set('readModeKeepEntireCite', before));

    it('keeps the whole cite once it has any read-aloud run', () => {
      settings.set('readModeKeepEntireCite', true);
      const cite = schema.nodes['cite_paragraph']!.create(null, [
        schema.text('AuthorName ', [schema.marks['cite_mark']!.create()]),
        schema.text('quals that would normally be dropped'),
      ]);
      const filtered = filterSliceForReadMode(sliceOf(cite));
      expect(textOf(filtered)).toContain('quals that would normally be dropped');
    });

    it('a cite with nothing marked still drops entirely', () => {
      settings.set('readModeKeepEntireCite', true);
      const cite = schema.nodes['cite_paragraph']!.create(null, schema.text('nothing marked here'));
      const filtered = filterSliceForReadMode(sliceOf(cite));
      expect(textOf(filtered).trim()).toBe('');
    });

    it('a same-paragraph selection (bare inline content, no wrapper node) still needs source to resolve at all', () => {
      settings.set('readModeKeepEntireCite', true);
      const cite = schema.nodes['cite_paragraph']!.create(null, [
        schema.text('AuthorName ', [schema.marks['cite_mark']!.create()]),
        schema.text('unmarked qualifier text'),
      ]);
      const card = schema.nodes['card']!.createChecked(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
        cite,
        schema.nodes['card_body']!.create(null, schema.text('body')),
      ]);
      const doc = schema.nodes['doc']!.createChecked(null, [card]);

      // A user in read mode sees the whole cite (the cite_mark run makes
      // "keep entire cite" show it all) but selects and copies ONLY the
      // unmarked qualifier — the cite_mark run itself sits outside the
      // selection. A selection that never leaves one textblock comes back
      // from `doc.slice` as BARE inline content (no cite_paragraph wrapper,
      // openStart/openEnd both 0) — this is the common case a plain
      // Ctrl+C hits, and exactly why the filter needs `source` at all: with
      // no wrapper node, there's nothing to read a `type.name` off of.
      let citePos = -1;
      doc.descendants((node, pos) => {
        if (node.type.name === 'cite_paragraph') citePos = pos;
        return citePos < 0;
      });
      const from = citePos + 1 + 'AuthorName '.length;
      const to = from + 'unmarked qualifier text'.length;
      const raw = doc.slice(from, to);
      expect(raw.openStart, 'a same-block selection comes back unwrapped').toBe(0);
      expect(raw.content.firstChild!.isText).toBe(true);

      const withoutSource = filterSliceForReadMode(raw);
      expect(
        textOf(withoutSource),
        'without source context there is no governing parent to resolve, so the text passes through unfiltered',
      ).toContain('unmarked qualifier text');

      const withSource = filterSliceForReadMode(raw, { doc, from, to });
      expect(withSource, 'still keeps the selected text (it IS read-mode-visible via "keep entire cite")').toEqual(
        raw,
      );
    });

    it('a selection crossing INTO the next block resolves the partial cite boundary against its full paragraph', () => {
      settings.set('readModeKeepEntireCite', true);
      const cite = schema.nodes['cite_paragraph']!.create(null, [
        schema.text('AuthorName ', [schema.marks['cite_mark']!.create()]),
        schema.text('unmarked qualifier text'),
      ]);
      const body = schema.nodes['card_body']!.create(null, [
        schema.text('trailing', [schema.marks['highlight']!.create({ color: 'yellow' })]),
        schema.text(' body text'),
      ]);
      const card = schema.nodes['card']!.createChecked(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag')),
        cite,
        body,
      ]);
      const doc = schema.nodes['doc']!.createChecked(null, [card]);

      let citePos = -1;
      let bodyPos = -1;
      doc.descendants((node, pos) => {
        if (node.type.name === 'cite_paragraph') citePos = pos;
        if (node.type.name === 'card_body') bodyPos = pos;
        return true;
      });
      // From inside the cite's unmarked qualifier (cite_mark run excluded)
      // through partway into the following card_body — crosses a block
      // boundary, so the cite_paragraph shows up in the slice as a real,
      // partial, wrapped node (unlike the bare-inline case above).
      const from = citePos + 1 + 'AuthorName '.length;
      const to = bodyPos + 1 + 'trailing'.length;
      const raw = doc.slice(from, to);
      expect(raw.openStart, 'the left edge is a partial cite_paragraph').toBe(1);
      expect(raw.content.firstChild!.type.name).toBe('cite_paragraph');

      const withoutSource = filterSliceForReadMode(raw);
      expect(
        textOf(withoutSource),
        'without source, the partial cite alone has no kept run and drops — the gap `source` fixes',
      ).not.toContain('unmarked qualifier text');

      const withSource = filterSliceForReadMode(raw, { doc, from, to });
      expect(textOf(withSource)).toContain('unmarked qualifier text');
      expect(textOf(withSource)).toContain('trailing');
    });
  });
});
