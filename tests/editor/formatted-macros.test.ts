import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { buildMacroKeymap, isFormattedMacro, macroSlice } from '../../src/editor/keyboard-macros.js';
import { settings } from '../../src/editor/settings.js';

const mark = (name: string, attrs?: Record<string, unknown>) => schema.marks[name]!.create(attrs);
const para = (...runs: PMNode[]) => schema.nodes['paragraph']!.create(null, runs);
const docOf = (...children: PMNode[]) => schema.nodes['doc']!.createChecked(null, children);

/** An inline macro: "cf." underlined, "Smith 24" emphasized, "x" highlighted. */
function inlineMacroJson(): unknown {
  const d = docOf(
    para(
      schema.text('cf. ', [mark('underline_mark')]),
      schema.text('Smith 24', [mark('emphasis_mark')]),
      schema.text(' x', [mark('highlight', { color: 'yellow' })]),
    ),
  );
  return d.slice(1, d.content.size - 1).toJSON();
}

/** A block macro: a card (tag + body) so the styles come with it. */
function cardMacroJson(): unknown {
  const card = schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag line')),
    schema.nodes['card_body']!.create(null, schema.text('Body text', [mark('underline_mark')])),
  ]);
  const d = docOf(card);
  return d.slice(0, d.content.size).toJSON();
}

function press(key: string, macros: Parameters<typeof buildMacroKeymap>[0], start: PMNode) {
  const km = buildMacroKeymap(macros);
  let state = EditorState.create({ schema, doc: start });
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
  let next: EditorState | null = null;
  let meta: unknown;
  const ok = km[key]!(state, (tr) => {
    next = state.apply(tr);
    meta = tr.getMeta('cm-repeat-set');
  });
  return { ok, doc: next ? (next as EditorState).doc : null, meta };
}

const marksAt = (doc: PMNode, needle: string): string[] => {
  let found: string[] = [];
  doc.descendants((n) => {
    if (n.isText && n.text!.includes(needle)) found = n.marks.map((m) => m.type.name);
    return true;
  });
  return found;
};

describe('formatted macros', () => {
  it('types its text with the marks it was saved with', () => {
    const { ok, doc } = press(
      'Mod-j',
      [{ id: 'a', key: 'Mod-j', text: 'cf. Smith 24 x', contentJson: inlineMacroJson() }],
      docOf(para(schema.text('before '))),
    );
    expect(ok).toBe(true);
    expect(doc!.textContent).toBe('before cf. Smith 24 x');
    expect(marksAt(doc!, 'cf.')).toEqual(['underline_mark']);
    expect(marksAt(doc!, 'Smith 24')).toEqual(['emphasis_mark']);
    expect(marksAt(doc!, ' x')).toEqual(['highlight']);
    // The text typed before it keeps no marks.
    expect(marksAt(doc!, 'before')).toEqual([]);
  });

  it('can type styled blocks: a card with its tag and underlined body', () => {
    const { doc } = press(
      'Mod-k',
      [{ id: 'a', key: 'Mod-k', text: 'Tag line\nBody text', contentJson: cardMacroJson() }],
      docOf(para()),
    );
    const names: string[] = [];
    doc!.descendants((n) => {
      if (n.isBlock) names.push(n.type.name);
      return true;
    });
    expect(names).toContain('card');
    expect(names).toContain('tag');
    expect(names).toContain('card_body');
    expect(marksAt(doc!, 'Body text')).toEqual(['underline_mark']);
  });

  it('is repeated by Word-style Repeat as a paste of the same slice', () => {
    const { meta } = press(
      'Mod-j',
      [{ id: 'a', key: 'Mod-j', text: 'x', contentJson: inlineMacroJson() }],
      docOf(para()),
    );
    expect(meta).toMatchObject({ kind: 'paste' });
  });

  it('falls back to the plain text when its content is damaged', () => {
    const { doc } = press(
      'Mod-j',
      [{ id: 'a', key: 'Mod-j', text: 'fallback', contentJson: { content: [{ type: 'nope' }] } }],
      docOf(para()),
    );
    expect(doc!.textContent).toBe('fallback');
    expect(marksAt(doc!, 'fallback')).toEqual([]);
  });

  it('a macro with damaged content and no text is skipped', () => {
    expect(Object.keys(buildMacroKeymap([{ id: 'a', key: 'F2', text: '', contentJson: { content: [{ type: 'nope' }] } }]))).toEqual([]);
  });

  it('knows which macros carry formatting', () => {
    expect(isFormattedMacro({ contentJson: inlineMacroJson() })).toBe(true);
    expect(isFormattedMacro({})).toBe(false);
    expect(isFormattedMacro({ contentJson: { content: [{ type: 'nope' }] } })).toBe(false);
    expect(macroSlice({ contentJson: inlineMacroJson() })!.size).toBeGreaterThan(0);
  });

  it('plain-text macros are unchanged', () => {
    const { doc, meta } = press('Mod-j', [{ id: 'a', key: 'Mod-j', text: 'cf.' }], docOf(para(schema.text('a'))));
    expect(doc!.textContent).toBe('acf.');
    expect(meta).toBeUndefined();
  });
});

describe('formatted macros in settings', () => {
  it('keeps contentJson through a save and reload, and drops junk', () => {
    const json = inlineMacroJson();
    settings.set('keyboardMacros', [
      { id: 'a', key: 'Mod-j', text: 'x', contentJson: json },
      { id: 'b', key: '', text: 'y', contentJson: 'not an object' as unknown },
      { id: 'c', key: '', text: 'z', contentJson: ['array'] as unknown },
    ]);
    const stored = JSON.parse(JSON.stringify(settings.get('keyboardMacros')));
    expect(stored[0].contentJson).toEqual(json);
    settings.set('keyboardMacros', []);
  });
});
