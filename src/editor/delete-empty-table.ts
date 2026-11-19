/**
 * Backspace / Delete takes out a table that has nothing left in it.
 *
 * Emptying a table cell by cell (or deleting rows and columns until one cell is
 * left) strands the last, empty cell: a caret in it has nothing to delete, so
 * Backspace did nothing and the only way out was the table menu, which is
 * hidden when "Show additional formatting buttons" is off. Now, when the whole
 * table holds nothing but empty paragraphs:
 *   - the caret in a table of one cell, or
 *   - every cell selected (a cell selection over the whole table),
 * Backspace or Delete removes the table. A table with anything in it, or
 * several cells with just a caret in one, is left to the usual behaviour, so
 * a freshly inserted blank 3 × 3 table does not vanish at the first Backspace.
 */
import type { Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { CellSelection, deleteTable } from 'prosemirror-tables';

/** A cell holding only empty paragraphs. */
function isEmptyCell(cell: PMNode): boolean {
  let empty = true;
  cell.forEach((child) => {
    if (child.type.name !== 'paragraph' || child.content.size !== 0) empty = false;
  });
  return empty;
}

export const deleteEmptyTable: Command = (state, dispatch) => {
  const sel = state.selection;
  const $from = sel.$from;
  let table: PMNode | null = null;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.spec.tableRole === 'table') {
      table = node;
      break;
    }
  }
  if (!table) return false;
  let cells = 0;
  let allEmpty = true;
  table.forEach((row) =>
    row.forEach((cell) => {
      cells++;
      if (!isEmptyCell(cell)) allEmpty = false;
    }),
  );
  if (!allEmpty || cells === 0) return false;
  if (sel instanceof CellSelection) {
    let selected = 0;
    sel.forEachCell(() => selected++);
    if (selected !== cells) return false;
  } else if (!sel.empty || cells !== 1) {
    return false;
  }
  return deleteTable(state, dispatch);
};
