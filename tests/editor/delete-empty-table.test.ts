// @vitest-environment jsdom
/**
 * Backspace / Delete removes a table with nothing left in it: the caret in a
 * table of one empty cell, or every cell of an all-empty table selected. A
 * table with content, or a blank multi-cell table with just a caret, is left alone.
 */
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { deleteEmptyTable } from '../../src/editor/delete-empty-table.js';

const n = schema.nodes;
const para = (t = ''): PMNode => n['paragraph']!.create(null, t ? [schema.text(t)] : []);
const cell = (t = ''): PMNode => n['table_cell']!.create(null, [para(t)]);
const table = (rows: string[][]): PMNode =>
  n['table']!.create(null, rows.map((r) => n['table_row']!.create(null, r.map((t) => cell(t)))));
const docOf = (...c: PMNode[]): PMNode => n['doc']!.createChecked(null, c);

/** Position of the `index`-th cell. */
function cellPos(doc: PMNode, index: number): number {
  let seen = -1;
  let out = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === 'table_cell') {
      seen++;
      if (seen === index) out = pos;
      return false;
    }
    return true;
  });
  return out;
}
const caretIn = (doc: PMNode, index: number): EditorState =>
  EditorState.create({ doc, selection: TextSelection.create(doc, cellPos(doc, index) + 2) });
function run(state: EditorState, cmd: Command = deleteEmptyTable): EditorState | null {
  let next: EditorState | null = null;
  return cmd(state, (tr) => {
    next = state.apply(tr);
  })
    ? next
    : null;
}
const tableCount = (doc: PMNode): number => {
  let c = 0;
  doc.descendants((node) => {
    if (node.type.name === 'table') c++;
  });
  return c;
};

describe('deleteEmptyTable', () => {
  it('removes a table of one empty cell when the caret is in it', () => {
    const next = run(caretIn(docOf(para('before'), table([['']]), para('after')), 0))!;
    expect(next).not.toBeNull();
    expect(tableCount(next.doc)).toBe(0);
    expect(next.doc.textContent).toBe('beforeafter');
    next.doc.check();
  });

  it('works when the table is the last thing in the document', () => {
    const next = run(caretIn(docOf(para('before'), table([['']])), 0))!;
    expect(tableCount(next.doc)).toBe(0);
    next.doc.check();
  });

  it('works when the table is the only thing in the document', () => {
    const next = run(caretIn(docOf(table([['']])), 0))!;
    expect(tableCount(next.doc)).toBe(0);
    next.doc.check();
  });

  it('leaves a one-cell table that has text in it', () => {
    expect(run(caretIn(docOf(para('x'), table([['hello']])), 0))).toBeNull();
  });

  it('leaves a blank multi-cell table alone when only a caret is in it', () => {
    expect(run(caretIn(docOf(para('x'), table([['', ''], ['', '']])), 0))).toBeNull();
  });

  it('removes an all-empty table when every cell is selected', () => {
    const doc = docOf(para('x'), table([['', ''], ['', '']]));
    const first = cellPos(doc, 0);
    const last = cellPos(doc, 3);
    const state = EditorState.create({
      doc,
      selection: new CellSelection(doc.resolve(first), doc.resolve(last)),
    });
    const next = run(state)!;
    expect(tableCount(next.doc)).toBe(0);
    next.doc.check();
  });

  it('leaves it when only some of the cells are selected', () => {
    const doc = docOf(para('x'), table([['', ''], ['', '']]));
    const state = EditorState.create({
      doc,
      selection: new CellSelection(doc.resolve(cellPos(doc, 0)), doc.resolve(cellPos(doc, 1))),
    });
    expect(run(state)).toBeNull();
  });

  it('leaves it when any cell has content, even with every cell selected', () => {
    const doc = docOf(para('x'), table([['', 'a'], ['', '']]));
    const state = EditorState.create({
      doc,
      selection: new CellSelection(doc.resolve(cellPos(doc, 0)), doc.resolve(cellPos(doc, 3))),
    });
    expect(run(state)).toBeNull();
  });

  it('does nothing outside a table, or with a range selected in the cell', () => {
    const outside = EditorState.create({ doc: docOf(para('hello'), table([['']])), selection: TextSelection.create(docOf(para('hello'), table([['']])), 2) });
    expect(run(outside)).toBeNull();
  });

  it('reports availability without dispatching', () => {
    expect(deleteEmptyTable(caretIn(docOf(para('x'), table([['']])), 0))).toBe(true);
    expect(deleteEmptyTable(caretIn(docOf(para('x'), table([['hi']])), 0))).toBe(false);
  });
});
