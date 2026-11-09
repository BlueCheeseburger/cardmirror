// @vitest-environment jsdom
/**
 * insertSpeechSlice placement matrix — a sent card must land as a clean
 * top-level sibling in the receiving doc, NEVER splitting a host card.
 * Every card split forces ProseMirror to synthesize the schema-required
 * leading `tag`, which the user sees as blank tag lines ("2-3 blank F7
 * lines after the card" — field report, 2026-07-11: a leftover RANGE
 * selection in the speech doc raw-inserted the slice mid-text).
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undoDepth } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { takeSendSlice, insertSpeechSlice } from '../../src/editor/speech-doc-send.js';

function card(tagText: string, bodyText: string): PMNode {
  return schema.nodes['card']!.create(null, [
    schema.nodes['tag']!.create(null, tagText ? schema.text(tagText) : undefined),
    schema.nodes['card_body']!.create(null, bodyText ? schema.text(bodyText) : undefined),
  ]);
}
function para(text = ''): PMNode {
  return schema.nodes['paragraph']!.create(null, text ? schema.text(text) : undefined);
}
function mkView(doc: PMNode): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, { state: EditorState.create({ doc, schema }) });
}
function countEmptyTags(doc: PMNode): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === 'tag' && node.content.size === 0) n++;
    return true;
  });
  return n;
}
function cardCount(doc: PMNode): number {
  let n = 0;
  doc.forEach((c) => {
    if (c.type.name === 'card') n++;
  });
  return n;
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

/** The tilde slice: caret inside a single card's body → whole-card slice. */
function takeSingleCardSlice(): ReturnType<typeof takeSendSlice> {
  const src = mkView(
    schema.nodes['doc']!.create(null, [card('MY TAG', 'card body words'), para('after')]),
  );
  let bodyPos = -1;
  src.state.doc.descendants((n, p) => {
    if (n.type.name === 'card_body' && bodyPos < 0) bodyPos = p + 2;
    return true;
  });
  src.dispatch(src.state.tr.setSelection(TextSelection.create(src.state.doc, bodyPos)));
  const slice = takeSendSlice(src);
  src.destroy();
  return slice;
}

describe('insertSpeechSlice placement', () => {
  it('a whole-card slice is closed (node boundaries)', () => {
    const slice = takeSingleCardSlice()!;
    expect(slice.openStart).toBe(0);
    expect(slice.openEnd).toBe(0);
  });

  it('never synthesizes empty tags, across target shapes', async () => {
    const slice = takeSingleCardSlice()!;
    const targets: Array<[string, () => EditorView, boolean]> = [
      ['empty doc, atEnd', () => mkView(schema.nodes['doc']!.create(null, [para()])), true],
      [
        'caret on a blank line (fill)',
        () => {
          const v = mkView(schema.nodes['doc']!.create(null, [card('EXIST', 'stuff'), para()]));
          v.dispatch(
            v.state.tr.setSelection(TextSelection.create(v.state.doc, v.state.doc.content.size - 1)),
          );
          return v;
        },
        false,
      ],
      [
        'caret inside an existing card (snaps to boundary)',
        () => {
          const v = mkView(
            schema.nodes['doc']!.create(null, [card('EXIST', 'stuff here'), para('tail')]),
          );
          let bp = -1;
          v.state.doc.descendants((n, p) => {
            if (n.type.name === 'card_body' && bp < 0) bp = p + 3;
            return true;
          });
          v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, bp)));
          return v;
        },
        false,
      ],
      ['atEnd with non-empty last child', () => mkView(schema.nodes['doc']!.create(null, [para('existing')])), true],
      [
        'RANGE selection inside an existing card (the field bug)',
        () => {
          const v = mkView(
            schema.nodes['doc']!.create(null, [card('EXIST', 'stuff here'), para('tail')]),
          );
          let bp = -1;
          v.state.doc.descendants((n, p) => {
            if (n.type.name === 'card_body' && bp < 0) bp = p + 2;
            return true;
          });
          v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, bp, bp + 4)));
          return v;
        },
        false,
      ],
      [
        'caret on a BLANK line inside a card (the tilde "2 empty tag headers" bug)',
        () => {
          // Host card with an empty card_body line mid-card — the old fill
          // branch replaced that line in place, splitting the host card
          // (one synthesized tag) and then splitting the tail half again
          // with the trailer paragraph (the second one).
          const v = mkView(
            schema.nodes['doc']!.create(null, [
              schema.nodes['card']!.create(null, [
                schema.nodes['tag']!.create(null, schema.text('HOST')),
                schema.nodes['card_body']!.create(null, schema.text('before')),
                schema.nodes['card_body']!.create(),
                schema.nodes['card_body']!.create(null, schema.text('after')),
              ]),
            ]),
          );
          let blankPos = -1;
          v.state.doc.descendants((n, p) => {
            if (n.type.name === 'card_body' && n.content.size === 0) blankPos = p;
            return true;
          });
          v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, blankPos + 1)));
          return v;
        },
        false,
      ],
      [
        'caret in an EMPTY TAG of an existing card',
        () => {
          const v = mkView(
            schema.nodes['doc']!.create(null, [
              card('FULL', 'body'),
              schema.nodes['card']!.create(null, [
                schema.nodes['tag']!.create(),
                schema.nodes['card_body']!.create(),
              ]),
            ]),
          );
          let tagPos = -1;
          v.state.doc.descendants((n, p) => {
            if (n.type.name === 'tag' && n.content.size === 0) tagPos = p;
            return true;
          });
          v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, tagPos + 1)));
          return v;
        },
        false,
      ],
    ];
    for (const [name, mk, atEnd] of targets) {
      const v = mk();
      const cardsBefore = cardCount(v.state.doc);
      // Delta, not absolute: one target starts with an (intentional)
      // empty-tag card — the insert must not ADD any.
      const emptyTagsBefore = countEmptyTags(v.state.doc);
      insertSpeechSlice(v, slice, atEnd);
      await settle();
      expect(countEmptyTags(v.state.doc), `${name}: empty tags`).toBe(emptyTagsBefore);
      // Exactly ONE card added — the sent one; a split would add fragments.
      expect(cardCount(v.state.doc), `${name}: card count`).toBe(cardsBefore + 1);
      v.destroy();
    }
  });

  it('a split can no longer mint numbered phantom cards (the numbering variant)', async () => {
    // The synthesized split halves copied the HOST card's attrs — in a
    // speech doc built from numbered sends, the phantom blank tags came
    // out numbered. With the fill narrowed, no card but the host may
    // carry its numRole.
    const slice = takeSingleCardSlice()!;
    const v = mkView(
      schema.nodes['doc']!.create(null, [
        schema.nodes['card']!.create({ numRole: 'number' }, [
          schema.nodes['tag']!.create(null, schema.text('NUMBERED HOST')),
          schema.nodes['card_body']!.create(null, schema.text('before')),
          schema.nodes['card_body']!.create(),
          schema.nodes['card_body']!.create(null, schema.text('after')),
        ]),
      ]),
    );
    let blankPos = -1;
    v.state.doc.descendants((n, p) => {
      if (n.type.name === 'card_body' && n.content.size === 0) blankPos = p;
      return true;
    });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, blankPos + 1)));
    insertSpeechSlice(v, slice, false);
    await settle();
    const roles: string[] = [];
    v.state.doc.forEach((c) => {
      if (c.type.name === 'card') roles.push(String(c.attrs['numRole']));
    });
    // Host + the sent card, nothing else (the snap may land the card on
    // either side of the host, so order-insensitive).
    expect([...roles].sort()).toEqual(['none', 'number']);
    v.destroy();
  });

  it('a failing insert alerts instead of silently losing the card', async () => {
    // The insert runs in a 0 ms defer, unreachable by any caller try/catch —
    // and on a cross-window send the sender is told "delivered" before the
    // receiving window inserts. A throw here used to be a silently lost card
    // (fail-safe hardening, 2026-07-12).
    const slice = takeSingleCardSlice();
    expect(slice).not.toBeNull();
    const dest = mkView(schema.nodes['doc']!.create(null, [para()]));
    (dest as unknown as { dispatch: () => void }).dispatch = () => {
      throw new Error('boom mid-insert');
    };
    insertSpeechSlice(dest, slice!, true);
    await settle();
    const dialogs = [...document.querySelectorAll('.pmd-route-dialog')];
    expect(dialogs.some((el) => el.textContent?.includes("Couldn't insert the card"))).toBe(true);
    expect(dialogs.some((el) => el.textContent?.includes('boom mid-insert'))).toBe(true);
    // Dismiss via the alert's OK so its document-level listeners unregister.
    document.querySelector<HTMLButtonElement>('.pmd-text-prompt-ok')?.click();
    document.querySelectorAll('.pmd-route-overlay').forEach((o) => o.remove());
    dest.destroy();
  });

  it('a destroyed destination view is a silent no-op, not a crash or an alert', async () => {
    const slice = takeSingleCardSlice();
    const dest = mkView(schema.nodes['doc']!.create(null, [para()]));
    insertSpeechSlice(dest, slice!, true);
    dest.destroy(); // closed within the 0 ms defer window
    await settle();
    expect(document.querySelector('.pmd-route-dialog')).toBeNull();
  });
});

describe('undo grouping of an insert', () => {
  function mkViewWithHistory(): EditorView {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new EditorView(host, {
      state: EditorState.create({ doc: schema.nodes['doc']!.create(null, [para()]), schema, plugins: [history()] }),
    });
  }
  const typeAtCaret = (v: EditorView): void =>
    v.dispatch(v.state.tr.insertText('typed', v.state.selection.from));

  it('keeps an after-insert hook\'s edits in the insert\'s own undo step (the Logos import and the palette rely on it)', async () => {
    const v = mkViewWithHistory();
    insertSpeechSlice(v, takeSingleCardSlice()!, true, (view) => typeAtCaret(view));
    await settle();
    expect(v.state.doc.textContent).toContain('typed');
    expect(undoDepth(v.state)).toBe(1);
  });

  it('with `undoable`, the hook\'s edits still share the insert\'s step', async () => {
    const v = mkViewWithHistory();
    insertSpeechSlice(v, takeSingleCardSlice()!, true, (view) => typeAtCaret(view), { undoable: true });
    await settle();
    expect(undoDepth(v.state)).toBe(1);
  });

  it('with `undoable`, typing straight afterwards starts a step of its own', async () => {
    const v = mkViewWithHistory();
    insertSpeechSlice(v, takeSingleCardSlice()!, true, undefined, { undoable: true });
    await settle();
    typeAtCaret(v);
    expect(undoDepth(v.state)).toBe(2);
  });

  it('without `undoable`, typing straight afterwards merges into the insert, as it always did', async () => {
    const v = mkViewWithHistory();
    insertSpeechSlice(v, takeSingleCardSlice()!, true);
    await settle();
    typeAtCaret(v);
    expect(undoDepth(v.state)).toBe(1);
  });

  it('hands the hook an undo handle only for an `undoable` insert into a doc that keeps history', async () => {
    const got: Array<boolean> = [];
    const plain = mkViewWithHistory();
    insertSpeechSlice(plain, takeSingleCardSlice()!, true, (_v, undo) => got.push(undo !== null));
    const undoable = mkViewWithHistory();
    insertSpeechSlice(undoable, takeSingleCardSlice()!, true, (_v, undo) => got.push(undo !== null), { undoable: true });
    const noHistory = mkView(schema.nodes['doc']!.create(null, [para()]));
    insertSpeechSlice(noHistory, takeSingleCardSlice()!, true, (_v, undo) => got.push(undo !== null), { undoable: true });
    await settle();
    expect(got).toEqual([false, true, false]);
  });
});
