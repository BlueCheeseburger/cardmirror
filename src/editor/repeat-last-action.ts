/**
 * Word-style Repeat (design call 2026-09-09): with the `repeatWithModY`
 * setting on, Mod-Y with nothing left to redo re-runs the last editing
 * action at the current selection. Redo always takes precedence; the
 * setting off leaves Mod-Y exactly as before.
 *
 * What counts as "the last action":
 *   - typing — the last contiguous burst of typed text (a new burst
 *     starts whenever the caret moves or anything else happens);
 *   - Backspace / Delete — repeated as one more press of the same key
 *     (Word's Repeat Clear), not as "delete the same text";
 *   - paste — the same slice again, replacing the selection;
 *   - a ribbon / keyboard command that changed the document (bold, a
 *     structural style, a highlight, condense…) — re-run by id, which
 *     covers user overrides and macros bound to the same command.
 * Anything else that changes the document (drag/drop, autocorrect's own
 * fix-ups, remote edits) clears the record rather than being replayed
 * wrong. Undo/redo leave it alone, so after undoing and redoing
 * everything Mod-Y repeats the last action again, as in Word.
 *
 * The recorder is a plugin placed ahead of the paste, undo and
 * Backspace keymaps so its hooks see every event first; each hook
 * records and returns false, letting the real handlers run. Command
 * runs are reported by the command runner (`noteCommandRun`). State is
 * per view (a pane in three-pane).
 */
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Slice } from 'prosemirror-model';
import { deleteSelection, joinBackward, joinForward, selectNodeBackward, selectNodeForward } from 'prosemirror-commands';

export type LastAction =
  | { kind: 'typing'; text: string; /** doc position the burst ends at */ end: number }
  | { kind: 'delete'; key: 'Backspace' | 'Delete' }
  | { kind: 'paste'; slice: Slice }
  | { kind: 'command'; id: string };

interface RecorderState {
  last: LastAction | null;
}

export const repeatLastActionKey = new PluginKey<RecorderState>('cm-repeat-last-action');

/** What the hooks announced for the transaction about to be dispatched
 *  (consumed by the plugin's apply). Module-level because the hook and
 *  the dispatch happen synchronously back to back. */
let announced: { kind: 'typing'; text: string } | { kind: 'delete'; key: 'Backspace' | 'Delete' } | { kind: 'paste'; slice: Slice } | null = null;
/** Command run in progress (set by the command runner around the call). */
let commandInProgress: string | null = null;
/** True while `repeatLastAction` itself dispatches — its transactions
 *  must not clear the record (and its typing must not double-record). */
let replaying = false;

const isNeutral = (tr: Transaction): boolean =>
  tr.getMeta('addToHistory') === false ||
  !!tr.getMeta('appendedTransaction') ||
  tr.getMeta('history$') !== undefined ||
  !!tr.getMeta('loro-undo') ||
  !!tr.getMeta('cm-repeat-replay');

/** The recorder plugin. Put it FIRST among editing plugins. */
export function repeatLastActionPlugin(): Plugin<RecorderState> {
  return new Plugin<RecorderState>({
    key: repeatLastActionKey,
    state: {
      init: () => ({ last: null }),
      apply(tr, prev) {
        const set = tr.getMeta('cm-repeat-set') as LastAction | undefined;
        if (set) return { last: set };
        if (replaying) return prev;
        if (tr.getMeta('cm-repeat-clear')) return { last: null };
        if (commandInProgress !== null) {
          // The runner reports the id once it has seen the doc change;
          // until then leave the record alone (a command may dispatch
          // several transactions).
          return prev;
        }
        const a = announced;
        if (a) {
          announced = null;
          if (a.kind === 'typing') {
            const end = tr.selection.from;
            const prevTyping = prev.last?.kind === 'typing' ? prev.last : null;
            // Contiguous with the previous burst → extend it.
            const text = prevTyping && prevTyping.end === end - a.text.length ? prevTyping.text + a.text : a.text;
            return { last: { kind: 'typing', text, end } };
          }
          return { last: a };
        }
        if (!tr.docChanged) {
          // A caret move ends a typing burst (the next keystroke starts a
          // new one) but keeps the record: Repeat still types the burst.
          if (prev.last?.kind === 'typing' && tr.selectionSet && tr.selection.from !== prev.last.end) {
            return { last: { ...prev.last, end: -1 } };
          }
          return prev;
        }
        if (isNeutral(tr)) return prev;
        // Some other document change: don't guess.
        return { last: null };
      },
    },
    props: {
      handleTextInput(_view, _from, _to, text) {
        if (!replaying) announced = { kind: 'typing', text };
        return false;
      },
      handlePaste(_view, _event, slice) {
        if (!replaying) announced = { kind: 'paste', slice };
        return false;
      },
      handleKeyDown(_view, event) {
        if (replaying) return false;
        if ((event.key === 'Backspace' || event.key === 'Delete') && !event.metaKey && !event.ctrlKey && !event.altKey) {
          announced = { kind: 'delete', key: event.key };
        }
        return false;
      },
    },
  });
}

/** Called by the command runner around a ribbon / keyboard command:
 *  `begin` before, `end` after with whether the document changed. */
export function noteCommandRun(id: string, phase: 'begin'): void;
export function noteCommandRun(id: string, phase: 'end', view: EditorView | null, docChanged: boolean): void;
export function noteCommandRun(id: string, phase: 'begin' | 'end', view?: EditorView | null, docChanged?: boolean): void {
  if (phase === 'begin') {
    commandInProgress = id;
    return;
  }
  commandInProgress = null;
  if (!docChanged || !view || REPEAT_EXCLUDED_COMMANDS.has(id)) return;
  view.dispatch(view.state.tr.setMeta('cm-repeat-set', { kind: 'command', id } satisfies LastAction).setMeta('addToHistory', false));
}

/** Commands that are never a "last action": undo/redo and Repeat itself. */
const REPEAT_EXCLUDED_COMMANDS: ReadonlySet<string> = new Set(['undo', 'redo', 'repeat']);

/** Delete one character before / after an empty selection inside a
 *  textblock (surrogate pairs as one), the browser's own Backspace /
 *  Delete on text. False at a block boundary so the join commands run. */
const deleteCharBackward: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset === 0 || !$from.parent.isTextblock) return false;
  const before = $from.parent.textBetween(0, $from.parentOffset, '\ufffc', '\ufffc');
  const cp = before.codePointAt(before.length - 1) ?? 0;
  const width = cp > 0xffff ? 2 : 1;
  if (before.charCodeAt(before.length - 1) >= 0xdc00 && before.charCodeAt(before.length - 1) <= 0xdfff && before.length >= 2) {
    dispatch?.(state.tr.delete($from.pos - 2, $from.pos));
    return true;
  }
  dispatch?.(state.tr.delete($from.pos - width, $from.pos));
  return true;
};
const deleteCharForward: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset >= $from.parent.content.size) return false;
  const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '\ufffc', '\ufffc');
  const cp = after.codePointAt(0) ?? 0;
  dispatch?.(state.tr.delete($from.pos, $from.pos + (cp > 0xffff ? 2 : 1)));
  return true;
};

export function lastActionOf(state: EditorState): LastAction | null {
  return repeatLastActionKey.getState(state)?.last ?? null;
}

/** Repeat the recorded action at the current selection. Returns true when
 *  something was replayed. `runCommand` re-runs a recorded command by id. */
export function repeatLastAction(
  view: EditorView,
  runCommand: (id: string) => void,
  keyDown: (view: EditorView, key: 'Backspace' | 'Delete') => boolean,
): boolean {
  const last = lastActionOf(view.state);
  if (!last) return false;
  replaying = true;
  try {
    switch (last.kind) {
      case 'typing': {
        const tr = view.state.tr.insertText(last.text).scrollIntoView().setMeta('cm-repeat-replay', true);
        view.dispatch(tr);
        // The replayed burst is the new "last": typing again continues it.
        view.dispatch(
          view.state.tr
            .setMeta('cm-repeat-set', { kind: 'typing', text: last.text, end: view.state.selection.from } satisfies LastAction)
            .setMeta('addToHistory', false),
        );
        return true;
      }
      case 'paste': {
        view.dispatch(view.state.tr.replaceSelection(last.slice).scrollIntoView().setMeta('cm-repeat-replay', true));
        return true;
      }
      case 'delete': {
        // One more press of the same key — through the app's own key
        // handlers (tag-boundary rules, node-select guards) when they
        // claim it, else the base behaviour. A plain character delete
        // is not a ProseMirror command at all (the browser edits the
        // DOM and PM reads it back), so replay it as an explicit step.
        if (keyDown(view, last.key)) return true;
        const cmd: Command =
          last.key === 'Backspace'
            ? (s, d, v) => deleteSelection(s, d) || deleteCharBackward(s, d) || joinBackward(s, d, v) || selectNodeBackward(s, d, v)
            : (s, d, v) => deleteSelection(s, d) || deleteCharForward(s, d) || joinForward(s, d, v) || selectNodeForward(s, d, v);
        return cmd(view.state, (tr) => view.dispatch(tr.setMeta('cm-repeat-replay', true)), view);
      }
      case 'command':
        runCommand(last.id);
        return true;
    }
  } finally {
    replaying = false;
  }
}
