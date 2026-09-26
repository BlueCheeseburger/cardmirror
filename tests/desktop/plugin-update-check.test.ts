/**
 * Automatic plugin update checks (fork): which installed plugins get
 * checked, what counts as an update, and installing the lot from the
 * update chip.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyPluginUpdates,
  describePluginUpdates,
  findPluginUpdates,
  type PluginUpdate,
} from '../../apps/desktop/src/plugin-update-check.js';
import type { InstalledPluginInfo } from '../../apps/desktop/src/plugin-manager.js';

const plugin = (over: Partial<InstalledPluginInfo>): InstalledPluginInfo =>
  ({ id: 'p', name: 'P', version: '1.0.0', repo: 'o/p', ...over }) as InstalledPluginInfo;

describe('findPluginUpdates', () => {
  it('lists plugins with a newer release and skips the rest', async () => {
    const check = vi.fn(async (id: string) => {
      if (id === 'boom') throw new Error('offline');
      if (id === 'bad') return { ok: false as const, error: 'No releases found.' };
      return { ok: true as const, latest: id === 'new' ? '2.0.0' : '1.0.0', hasUpdate: id === 'new' };
    });
    const found = await findPluginUpdates(
      [
        plugin({ id: 'new', name: 'New' }),
        plugin({ id: 'same', name: 'Same' }),
        plugin({ id: 'bad' }),
        plugin({ id: 'boom' }),
        plugin({ id: 'local', repo: undefined }),
        plugin({ id: 'old-app', incompatible: '9.0.0' }),
      ],
      check,
    );
    expect(found).toEqual([{ id: 'new', name: 'New', repo: 'o/p', current: '1.0.0', latest: '2.0.0' }]);
    // No repo and incompatible plugins are never checked.
    expect(check.mock.calls.map((c) => c[0])).toEqual(['new', 'same', 'bad', 'boom']);
  });
});

describe('applyPluginUpdates', () => {
  const u = (id: string): PluginUpdate => ({ id, name: id.toUpperCase(), repo: `o/${id}`, current: '1.0.0', latest: '1.1.0' });

  it('inspects then commits each, and reports what failed', async () => {
    const inspect = vi.fn(async (repo: string) =>
      repo === 'o/blocked' ? { ok: false as const, error: 'Not on the list.' } : { ok: true as const, pending: `t-${repo}` },
    );
    const commit = vi.fn(async (token: string) =>
      token === 't-o/disk' ? { ok: false as const, error: 'Disk full.' } : { ok: true as const },
    );
    const r = await applyPluginUpdates([u('a'), u('blocked'), u('disk')], inspect, commit);
    expect(r.updated.map((x) => x.id)).toEqual(['a']);
    expect(r.failed.map((f) => [f.update.id, f.error])).toEqual([
      ['blocked', 'Not on the list.'],
      ['disk', 'Disk full.'],
    ]);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('describes the updates for the confirm dialog', () => {
    expect(describePluginUpdates([u('a'), u('b')])).toBe('A: v1.0.0 → v1.1.0\nB: v1.0.0 → v1.1.0');
  });
});
