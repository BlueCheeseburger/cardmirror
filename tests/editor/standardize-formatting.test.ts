import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { planStandardizeFormatting } from '../../src/editor/standardize-formatting.js';
import { shrinkText } from '../../src/editor/ribbon-commands.js';
import { condenseMerge } from '../../src/editor/condense.js';

const m = schema.marks;
const n = schema.nodes;
const shrink = shrinkText(
  () => 11,
  () => 11,
  () => false,
  () => [],
);
const deps = { highlightColor: () => 'yellow' as string | null, shrink };

const t = (text: string, ...marks: any[]) => schema.text(text, marks);
const body = (...c: any[]) => n['card_body']!.create(null, c);
const tag = (text: string, ...marks: any[]) => n['tag']!.create({ id: newHeadingId() }, t(text, ...marks));
const card = (...c: any[]) => n['card']!.createChecked(null, c);
const docOf = (...c: any[]) => n['doc']!.createChecked(null, c);
const font = (name: string) => m['font_family']!.create({ name });
const size = (pt: number) => m['font_size']!.create({ size: pt * 2, origin: null });
const hl = (color: string) => m['highlight']!.create({ color });
const ul = () => m['underline_mark']!.create();
const bold = () => m['bold']!.create();
const condense = condenseMerge({ withPilcrows: false, headingMode: 'respect' });

function markNames(doc: any, text: string): string[] {
  let out: string[] = [];
  doc.descendants((nd: any) => {
    if (nd.isText && nd.text.includes(text)) out = nd.marks.map((k: any) => k.type.name + (k.attrs.color ? ':' + k.attrs.color : ''));
    return true;
  });
  return out;
}

describe('Standardize Formatting', () => {
  const messy = docOf(
    card(
      tag('A tag', font('Comic Sans')),
      body(t('read this', ul(), hl('green'), font('Arial'), size(14)), t(' and this unread', font('Arial'), size(14)), t(' erased', hl('white'))),
    ),
  );

  it('plans every step over the whole document when nothing is selected, and applies as one transaction', () => {
    const state = EditorState.create({ doc: messy });
    const plan = planStandardizeFormatting(state, deps)!;
    expect(plan).not.toBeNull();
    const ids = plan.steps.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['text', 'fonts', 'sizes', 'highlight']));
    const after = state.apply(plan.tr).doc;
    // body fonts and the odd space are gone, the tag keeps its own font
    expect(markNames(after, 'read this')).not.toContain('font_family');
    expect(after.textContent).not.toContain(' ');
    expect(markNames(after, 'A tag')).toContain('font_family');
    // green becomes the default color, an erased (white) highlight stays erased
    expect(markNames(after, 'read this')).toContain('highlight:yellow');
    expect(markNames(after, 'erased')).toContain('highlight:white');
    // the unread text is shrunk again from a clean base
    expect(markNames(after, 'unread')).toContain('font_size');
    expect(markNames(after, 'read this')).not.toContain('font_size');
  });

  it('only touches the selection when there is one', () => {
    const state = EditorState.create({ doc: messy });
    // select just the tag: body must not change
    const tagStart = 2;
    
    const s2 = state.apply(state.tr.setSelection(TextSelection.create(state.doc, tagStart, tagStart + 4)));
    const plan = planStandardizeFormatting(s2, deps);
    expect(plan).toBeNull();
  });

  it('returns null when the document is already standard', () => {
    const clean = docOf(card(tag('T'), body(t('plain'), t(' read', ul(), hl('yellow')))));
    const state = EditorState.create({ doc: clean });
    const plan = planStandardizeFormatting(state, { ...deps, shrink: () => false });
    expect(plan).toBeNull();
  });

  it('skips the highlight step when there is no default color', () => {
    const state = EditorState.create({ doc: messy });
    const plan = planStandardizeFormatting(state, { ...deps, highlightColor: () => null })!;
    expect(plan.steps.map((s) => s.id)).not.toContain('highlight');
    expect(markNames(state.apply(plan.tr).doc, 'read this')).toContain('highlight:green');
  });

  it('makes bold words inside underlined card text Emphasis, and leaves other bold alone', () => {
    const doc = docOf(
      card(
        tag('T'),
        body(t('plain '), t('both', bold(), ul()), t(' and '), t('bold only', bold()), t(' and '), t('under only', ul())),
      ),
    );
    const state = EditorState.create({ doc });
    const plan = planStandardizeFormatting(state, { ...deps, shrink: () => false })!;
    expect(plan.steps.map((x) => x.id)).toEqual(['emphasis']);
    const after = state.apply(plan.tr).doc;
    expect(markNames(after, 'both')).toEqual(['emphasis_mark']); // not bold, not underlined any more
    expect(markNames(after, 'bold only')).toEqual(['bold']);
    expect(markNames(after, 'under only')).toEqual(['underline_mark']);
  });

  it('condenses every card with the ordinary condense command, one card at a time', () => {
    const doc = docOf(
      card(tag('One'), body(t('first paragraph')), body(t('second paragraph'))),
      card(tag('Two'), body(t('third paragraph')), body(t('fourth paragraph'))),
    );
    const state = EditorState.create({ doc });
    const plan = planStandardizeFormatting(state, { ...deps, shrink: () => false, condense })!;
    expect(plan.steps.map((x) => x.id)).toEqual(['condense']);
    const after = state.apply(plan.tr).doc;
    const bodies: string[] = [];
    after.descendants((nd) => {
      if (nd.type.name === 'card_body') bodies.push(nd.textContent);
      return true;
    });
    expect(bodies).toEqual(['first paragraph second paragraph', 'third paragraph fourth paragraph']);
    // the whole run is one transaction
    expect(plan.tr.docChanged).toBe(true);
  });

  it('only condenses the cards the selection touches', () => {
    const doc = docOf(
      card(tag('One'), body(t('first paragraph')), body(t('second paragraph'))),
      card(tag('Two'), body(t('third paragraph')), body(t('fourth paragraph'))),
    );
    const base = EditorState.create({ doc });
    // select inside the first card's first body only
    const inFirst = base.doc.resolve(6);
    const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, inFirst.pos, inFirst.pos + 3)));
    const plan = planStandardizeFormatting(state, { ...deps, shrink: () => false, condense })!;
    const bodies: string[] = [];
    state.apply(plan.tr).doc.descendants((nd) => {
      if (nd.type.name === 'card_body') bodies.push(nd.textContent);
      return true;
    });
    expect(bodies).toEqual(['first paragraph second paragraph', 'third paragraph', 'fourth paragraph']);
  });
});
