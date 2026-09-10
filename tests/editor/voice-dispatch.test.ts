/**
 * Voice v2 dispatcher: the fourteen words against the existing command
 * layer. Mark words mark a selection or arm the sticky pen; `bare` clears
 * or disarms; `card` inserts a fresh card after the current one; `delete`
 * needs a selection; `undo` goes through the editor's own undo path.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { history } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { applyVoiceCommand, type DispatchDeps } from '../../src/editor/voice/dispatch.js';
import { voicePlugin, voicePluginKey } from '../../src/editor/voice/plugin.js';
import type { RibbonContext } from '../../src/editor/ribbon-commands.js';
import type { VoiceEvent } from '../../src/editor/voice/types';

function card(tag: string, body: string): PMNode {
  return schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(tag)),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
}
function makeView(body = 'alpha bravo charlie') {
  const doc = schema.nodes['doc']!.create(null, [card('Tag one', body)]);
  let state = EditorState.create({ doc, plugins: [history(), voicePlugin()] });
  const view = {
    get state() { return state; },
    dispatch(tr: Transaction) { state = state.apply(tr); },
  };
  const bodyStart = 1 + doc.child(0).child(0).nodeSize + 1;
  return { view, bodyStart };
}
const hints: string[] = [];
const deps: DispatchDeps = { ribbonCtx: undefined as unknown as RibbonContext, ui: { echo() {}, hint: (t) => hints.push(t) } };
const cmd = (verb: string, id = 1): Extract<VoiceEvent, { kind: 'command' }> => ({ utteranceId: id, mode: 'command', raw: verb, tEndOfSpeech: 0, tParse: 0, kind: 'command', verb });

describe('voice dispatch', () => {
  it('a mark word with a selection marks it', async () => {
    const { view, bodyStart } = makeView();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart, bodyStart + 5)));
    await applyVoiceCommand(view, cmd('line'), deps);
    expect(view.state.doc.rangeHasMark(bodyStart, bodyStart + 5, schema.marks['underline_mark']!)).toBe(true);
    await applyVoiceCommand(view, cmd('glow', 2), deps);
    expect(view.state.doc.rangeHasMark(bodyStart, bodyStart + 5, schema.marks['highlight']!)).toBe(true);
    await applyVoiceCommand(view, cmd('bare', 3), deps);
    expect(view.state.doc.rangeHasMark(bodyStart, bodyStart + 5, schema.marks['underline_mark']!)).toBe(false);
    expect(view.state.doc.rangeHasMark(bodyStart, bodyStart + 5, schema.marks['highlight']!)).toBe(false);
  });

  it('a mark word with no selection arms the sticky pen; again disarms; bare disarms', async () => {
    const { view, bodyStart } = makeView();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart)));
    await applyVoiceCommand(view, cmd('box'), deps);
    expect(voicePluginKey.getState(view.state)?.pen).toBe('emphasis');
    await applyVoiceCommand(view, cmd('box', 2), deps);
    expect(voicePluginKey.getState(view.state)?.pen).toBeNull();
    await applyVoiceCommand(view, cmd('line', 3), deps);
    await applyVoiceCommand(view, cmd('bare', 4), deps);
    expect(voicePluginKey.getState(view.state)?.pen).toBeNull();
  });

  it('card inserts a fresh card after the current one and lands in its tag', async () => {
    const { view, bodyStart } = makeView();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart)));
    await applyVoiceCommand(view, cmd('card'), deps);
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.child(1).type.name).toBe('card');
    expect(view.state.doc.child(1).firstChild!.attrs['id']).toBeTruthy();
    expect(view.state.selection.$from.parent.type.name).toBe('tag');
  });

  it('delete and replace need a selection; delete removes it', async () => {
    const { view, bodyStart } = makeView();
    hints.length = 0;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart)));
    await applyVoiceCommand(view, cmd('delete'), deps);
    expect(hints.length).toBe(1);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart, bodyStart + 6)));
    await applyVoiceCommand(view, cmd('delete', 2), deps);
    expect(view.state.doc.child(0).child(1).textContent).toBe('bravo charlie');
  });

  it('undo goes through the supplied editor undo path', async () => {
    const { view } = makeView();
    let called = 0;
    await applyVoiceCommand(view, cmd('undo'), { ...deps, undo: () => { called++; return true; } });
    expect(called).toBe(1);
  });
});
