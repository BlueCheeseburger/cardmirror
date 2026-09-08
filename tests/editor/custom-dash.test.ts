import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema, newHeadingId } from '../../src/schema/index.js';
import type { Node as PMNode } from 'prosemirror-model';
import { customDashPlugin, dashOutput } from '../../src/editor/custom-dash-plugin.js';
import { settings } from '../../src/editor/settings.js';

const tag = (t: string) => schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(t));
const cardBody = (t: string) => schema.nodes['card_body']!.create(null, schema.text(t));
const card = (...k: PMNode[]) => schema.nodes['card']!.createChecked(null, k);
const doc = (...k: PMNode[]) => schema.nodes['doc']!.createChecked(null, k);

function bodyText(d: PMNode): string {
  let out = '';
  d.descendants((node) => {
    if (node.type.name === 'card_body') out = node.textContent;
  });
  return out;
}

type Plugin = ReturnType<typeof customDashPlugin>;
type Props = {
  handleTextInput: (v: unknown, from: number, to: number, text: string) => boolean;
  handleKeyDown: (v: unknown, e: Record<string, unknown>) => boolean;
};

/** A live mini-editor over `body` with the cursor at the end of the card_body. */
function makeView(body: string) {
  const d = doc(card(tag('T'), cardBody(body)));
  const plugin = customDashPlugin();
  let state = EditorState.create({ doc: d, plugins: [plugin] });
  let end = 0;
  d.descendants((node, pos) => {
    if (node.type.name === 'card_body') end = pos + 1 + node.content.size;
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: unknown) {
      state = state.apply(tr as never);
    },
  };
  const props = plugin.props as unknown as Props;
  return {
    typeHyphen: () => {
      const from = view.state.selection.from;
      return props.handleTextInput(view, from, from, '-');
    },
    typeChar: (c: string) => {
      const from = view.state.selection.from;
      return props.handleTextInput(view, from, from, c);
    },
    backspace: () =>
      props.handleKeyDown(view, {
        key: 'Backspace',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    body: () => bodyText(view.state.doc),
  };
}

function configure(
  enabled: boolean,
  style: 'en' | 'en-spaced' | 'em' | 'em-spaced' = 'em',
  trigger: '---' | '--' = '---',
) {
  settings.set('customDashEnabled', enabled);
  settings.set('customDashStyle', style);
  settings.set('customDashTrigger', trigger);
  settings.set('customDashOtherEnabled', false);
}

function configureBoth(
  primaryStyle: 'en' | 'en-spaced' | 'em' | 'em-spaced',
  primaryTrigger: '---' | '--',
  otherStyle: 'en' | 'en-spaced' | 'em' | 'em-spaced',
) {
  settings.set('customDashEnabled', true);
  settings.set('customDashStyle', primaryStyle);
  settings.set('customDashTrigger', primaryTrigger);
  settings.set('customDashOtherEnabled', true);
  settings.set('customDashOtherStyle', otherStyle);
}

describe('dashOutput', () => {
  it('maps the style to its literal', () => {
    configure(true, 'en');
    expect(dashOutput()).toBe('–');
    configure(true, 'em-spaced');
    expect(dashOutput()).toBe(' — ');
  });
});

describe('custom dash plugin', () => {
  it('converts on the third hyphen (em dash)', () => {
    configure(true, 'em');
    const v = makeView('a--');
    expect(v.typeHyphen()).toBe(true);
    expect(v.body()).toBe('a—'); // three hyphens collapse to one em dash
  });

  it('converts to an en dash with surrounding spaces for a spaced style', () => {
    configure(true, 'en-spaced');
    const v = makeView('word--');
    expect(v.typeHyphen()).toBe(true);
    expect(v.body()).toBe('word – ');
  });

  it('Backspace immediately after reverts to the literal ---', () => {
    configure(true, 'em');
    const v = makeView('a--');
    v.typeHyphen();
    expect(v.body()).toBe('a—');
    expect(v.backspace()).toBe(true);
    expect(v.body()).toBe('a---');
  });

  it('does nothing when disabled', () => {
    configure(false);
    const v = makeView('a--');
    expect(v.typeHyphen()).toBe(false);
    expect(v.body()).toBe('a--'); // handler declined; default would insert the hyphen
  });

  it('does not fire on the second hyphen (only -- present)', () => {
    configure(true, 'em');
    const v = makeView('a-');
    expect(v.typeHyphen()).toBe(false);
  });

  it('does not fire without two preceding hyphens', () => {
    configure(true, 'em');
    expect(makeView('ab').typeHyphen()).toBe(false);
  });
});

describe('custom dash with the "--" trigger', () => {
  it('converts on the second hyphen', () => {
    configure(true, 'em', '--');
    const v = makeView('a -');
    expect(v.typeHyphen()).toBe(true);
    expect(v.body()).toBe('a \u2014');
  });

  it('Backspace immediately after reverts to the literal --', () => {
    configure(true, 'em', '--');
    const v = makeView('a -');
    v.typeHyphen();
    expect(v.backspace()).toBe(true);
    expect(v.body()).toBe('a --');
  });

  it('does not fire mid-hyphen-run (pasted hyphens before the pair)', () => {
    configure(true, 'em', '--');
    const v = makeView('a ---');
    expect(v.typeHyphen()).toBe(false);
    expect(v.body()).toBe('a ---');
  });

  it('does not fire on the first hyphen', () => {
    configure(true, 'em', '--');
    const v = makeView('a ');
    expect(v.typeHyphen()).toBe(false);
  });

  it('"---" trigger still ignores the second hyphen', () => {
    configure(true, 'em', '---');
    const v = makeView('a -');
    expect(v.typeHyphen()).toBe(false);
  });
});

describe('custom dash with both triggers active', () => {
  it('a third hyphen completes the "---" rule, not the deferred "--" one', () => {
    configureBoth('em', '---', 'en');
    const v = makeView('a--');
    expect(v.typeHyphen()).toBe(true);
    expect(v.body()).toBe('a—');
  });

  it('a non-hyphen character after exactly two hyphens completes the "--" rule', () => {
    configureBoth('em', '---', 'en');
    const v = makeView('a--');
    expect(v.typeChar(' ')).toBe(true);
    expect(v.body()).toBe('a– '); // en dash, then the space that completed it
  });

  it('the second hyphen alone does not convert while a third could still land', () => {
    configureBoth('em', '---', 'en');
    const v = makeView('a-');
    expect(v.typeHyphen()).toBe(false); // still just "a--", not yet converted
    expect(v.body()).toBe('a-');
  });

  it('Backspace right after the deferred "--" completion reverts to "--" + the char', () => {
    configureBoth('em', '---', 'en');
    const v = makeView('a--');
    v.typeChar('x');
    expect(v.body()).toBe('a–x');
    expect(v.backspace()).toBe(true);
    expect(v.body()).toBe('a--x');
  });

  it('does not fire the deferred rule inside a longer hyphen run', () => {
    configureBoth('em', '---', 'en');
    const v = makeView('a----'); // four hyphens: the last two are mid-run
    expect(v.typeChar('x')).toBe(false);
    expect(v.body()).toBe('a----');
  });

  it('roles are symmetric: "--" as the PRIMARY trigger still defers when "---" is the secondary', () => {
    configureBoth('en', '--', 'em');
    const v = makeView('a--');
    // Third hyphen still completes "---" (now the secondary rule)...
    expect(v.typeHyphen()).toBe(true);
    expect(v.body()).toBe('a—');
  });

  it('roles are symmetric: the deferred "--" completion uses whichever style is configured for it', () => {
    configureBoth('en', '--', 'em');
    const v = makeView('a--');
    expect(v.typeChar(' ')).toBe(true);
    expect(v.body()).toBe('a– '); // "--" is the primary rule here, styled 'en'
  });

  it('only the primary rule fires when the secondary is off (unchanged from single-trigger mode)', () => {
    configure(true, 'em', '--');
    const v = makeView('a-');
    expect(v.typeHyphen()).toBe(true); // eager on the second hyphen, no deferral
    expect(v.body()).toBe('a—');
  });
});
