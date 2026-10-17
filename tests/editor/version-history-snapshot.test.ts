// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls: Uint8Array[] = [];
vi.mock('../../src/editor/host/index.js', () => ({
  getElectronHost: () => ({
    historySnapshot: async (_id: string, b: Uint8Array) => {
      calls.push(b);
      return { stored: true };
    },
  }),
}));

import { maybeSnapshotVersion } from '../../src/editor/version-history.js';
import { settings } from '../../src/editor/settings.js';

beforeEach(() => {
  calls.length = 0;
  settings.set('versionHistory', 'standard');
});

describe('maybeSnapshotVersion', () => {
  it('stores bytes it is given', async () => {
    maybeSnapshotVersion('doc-a', new Uint8Array([1, 2, 3]), 'manual');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
  });
  it('only builds deferred bytes when the throttle lets the snapshot through', async () => {
    let built = 0;
    const make = async (): Promise<Uint8Array> => {
      built++;
      return new Uint8Array([9]);
    };
    maybeSnapshotVersion('doc-b', make, 'auto');
    maybeSnapshotVersion('doc-b', make, 'auto'); // inside the minimum interval
    await new Promise((r) => setTimeout(r, 0));
    expect(built).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
