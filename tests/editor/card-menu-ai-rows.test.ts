import { describe, it, expect, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { buildCardMenuSections } from '../../src/editor/card-menu-sections.js';

const n = schema.nodes;
const oneCard = n['doc']!.createChecked(null, [
  n['card']!.createChecked(null, [n['tag']!.create({ id: newHeadingId() }, schema.text('Tag'))]),
]);
const range = { from: 0, to: oneCard.content.size };

const host = (over: object = {}) => ({
  state: () => EditorState.create({ doc: oneCard }),
  ranges: () => [range],
  run: () => {},
  ...over,
});

describe('Card menu AI rows', () => {
  it('has no AI section unless the host offers it and AI is on', () => {
    expect(buildCardMenuSections(host()).some((s) => s.title === 'AI')).toBe(false);
    expect(
      buildCardMenuSections(host({ ai: () => {}, aiEnabled: () => false })).some((s) => s.title === 'AI'),
    ).toBe(false);
  });

  it('lists Cross-Ex Practice and Card Credibility, each passing the menu ranges', () => {
    const ai = vi.fn();
    const sections = buildCardMenuSections(host({ ai, aiEnabled: () => true }));
    const sec = sections.find((s) => s.title === 'AI')!;
    expect(sec.items.map((i) => i.label)).toEqual(['Cross-Ex Practice (AI)', 'Card Credibility (AI)']);
    sec.items[0]!.run(null as never);
    sec.items[1]!.run(null as never);
    expect(ai).toHaveBeenNthCalledWith(1, 'crossex', [range]);
    expect(ai).toHaveBeenNthCalledWith(2, 'cred', [range]);
  });
});
