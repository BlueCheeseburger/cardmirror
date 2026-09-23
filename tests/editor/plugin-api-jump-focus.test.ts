// @vitest-environment jsdom
/**
 * jumpToSource raises the window after a jump that resolves locally
 * (the broadcast path raises its own winner in main). The caller is
 * always another app, so CardMirror is in the background.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';

const host = { focusSelf: vi.fn(async () => {}), pluginJump: vi.fn() };
vi.mock('../../src/editor/host/index.js', () => ({ getElectronHost: () => host }));
const jumpToTokenInView = vi.fn();
vi.mock('../../src/editor/plugin-jump.js', () => ({
  jumpToTokenInView: (...args: unknown[]) => jumpToTokenInView(...args),
}));

import { createPluginApi } from '../../src/editor/plugin-api.js';
import { mintSourceToken } from '../../src/editor/plugin-source-token.js';

const token = mintSourceToken({ docId: 'd1', docTitle: 'T', headingId: 'h1', anchor: null });
const view = {} as EditorView;

function api() {
  return createPluginApi('demo', {
    appVersion: '0.0.0-test',
    getView: () => view,
    findViewForDocId: (id) => (id === 'd1' ? view : null),
    getDocIdentity: () => ({ docId: 'd1', docTitle: 'T' }),
    ensureDocId: () => 'd1',
  });
}

afterEach(() => vi.clearAllMocks());

describe('jumpToSource window raising', () => {
  it('raises this window when the jump lands locally', async () => {
    jumpToTokenInView.mockReturnValue({ ok: true });
    expect(await api().jumpToSource(token)).toEqual({ ok: true });
    expect(host.focusSelf).toHaveBeenCalledTimes(1);
    expect(host.pluginJump).not.toHaveBeenCalled();
  });

  it('does not raise the window when the local jump fails', async () => {
    jumpToTokenInView.mockReturnValue({ ok: false, error: 'not-found', docTitle: 'T' });
    expect((await api().jumpToSource(token)).ok).toBe(false);
    expect(host.focusSelf).not.toHaveBeenCalled();
  });

  it('leaves raising to main when the jump goes through the broadcast', async () => {
    jumpToTokenInView.mockReturnValue('not-mine');
    host.pluginJump.mockResolvedValue({ ok: true });
    expect(await api().jumpToSource(token)).toEqual({ ok: true });
    expect(host.pluginJump).toHaveBeenCalledWith(token);
    expect(host.focusSelf).not.toHaveBeenCalled();
  });
});
