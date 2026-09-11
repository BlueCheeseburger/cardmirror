/**
 * Verbs that are pure ribbon pass-throughs route to the right command
 * id: `chunk` → Select Current Heading, `ship` → Send to Speech (At End).
 * The ribbon layer is wrapped (not replaced) so mark words still run the
 * real thing; only the two ids under test are recorded and stubbed.
 */
import { describe, it, expect, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { history } from 'prosemirror-history';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { voicePlugin } from '../../src/editor/voice/plugin.js';
import type { RibbonContext } from '../../src/editor/ribbon-commands.js';
import type { VoiceEvent } from '../../src/editor/voice/types';

const recorded = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('../../src/editor/ribbon-commands.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/editor/ribbon-commands.js')>();
  return {
    ...mod,
    getRibbonCommand: (id: string, ctx: RibbonContext) => {
      recorded.ids.push(id);
      if (id === 'sendToSpeechAtEnd') return () => true;
      return mod.getRibbonCommand(id as never, ctx);
    },
  };
});
const { applyVoiceCommand } = await import('../../src/editor/voice/dispatch.js');
const { matchCommand } = await import('../../src/editor/voice/vocabulary.js');

function makeView() {
  const doc = schema.nodes['doc']!.create(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag one')),
      schema.nodes['card_body']!.create(null, schema.text('alpha bravo charlie')),
    ]),
  ]);
  let state = EditorState.create({ doc, plugins: [history(), voicePlugin()] });
  const bodyStart = 1 + doc.child(0).child(0).nodeSize + 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, bodyStart + 3)));
  return { get state() { return state; }, dispatch(tr: Transaction) { state = state.apply(tr); } };
}
const deps = { ribbonCtx: undefined as unknown as RibbonContext, ui: { echo() {}, hint() {} } };
const cmd = (verb: string): Extract<VoiceEvent, { kind: 'command' }> =>
  ({ utteranceId: 1, mode: 'command', raw: verb, tEndOfSpeech: 0, tParse: 0, kind: 'command', verb });

describe('voice dispatch routing', () => {
  it('chunk runs Select Current Heading and ship runs Send to Speech (At End)', async () => {
    const view = makeView();
    recorded.ids.length = 0;
    await applyVoiceCommand(view, cmd('chunk'), deps);
    expect(recorded.ids).toContain('selectCurrentHeading');
    await applyVoiceCommand(view, cmd('ship'), deps);
    expect(recorded.ids).toContain('sendToSpeechAtEnd');
  });

  it('the new words and their homophones match as whole utterances only', () => {
    expect(matchCommand('chunk', null)).toBe('chunk');
    expect(matchCommand('chuck', null)).toBe('chunk');
    expect(matchCommand('ship', null)).toBe('ship');
    expect(matchCommand('chip', null)).toBe('ship');
    expect(matchCommand('ship it', null)).toBeNull();
    expect(matchCommand('shrink', null), 'no cross-talk with the nearest existing word').toBe('shrink');
  });
});
