// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

import { showToast } from '../../src/editor/toast.js';
import {
  installPluginRegistry,
  registerPluginDefinition,
  pluginCommandIds,
  pluginCommandLabel,
  pluginDefaultKey,
  pluginSettingsDefs,
  runPluginCommand,
  registeredPlugins,
  resetPluginRegistryForTests,
  unregisterPlugin,
  type PluginDefinition,
} from '../../src/editor/plugin-registry.js';
import type { CardMirrorPluginApi } from '../../src/editor/plugin-api.js';

const stubApi = { showToast: () => {} } as unknown as CardMirrorPluginApi;

function def(over: Partial<PluginDefinition> = {}): PluginDefinition {
  return {
    id: 'demo',
    name: 'Demo',
    apiVersion: 1,
    commands: [
      { id: 'demo.hello', label: 'Say Hello', keywords: ['greet'], defaultKey: 'Mod-Alt-h', run: () => {} },
    ],
    ...over,
  };
}

afterEach(() => resetPluginRegistryForTests());

describe('plugin registry', () => {
  it('registers via the window global and exposes commands', () => {
    installPluginRegistry(() => stubApi);
    window.__registerCardMirrorPlugin!(def());
    expect(pluginCommandIds()).toEqual(['demo.hello']);
    expect(pluginCommandLabel('demo.hello')).toBe('Say Hello');
    expect(pluginDefaultKey('demo.hello')).toBe('Mod-Alt-h');
    expect(registeredPlugins()).toEqual([{ id: 'demo', name: 'Demo' }]);
  });
  it('rejects an unknown apiVersion', () => {
    installPluginRegistry(() => stubApi);
    const res = registerPluginDefinition(def({ apiVersion: 2 }));
    expect(res.ok).toBe(false);
    expect(pluginCommandIds()).toEqual([]);
  });
  it('rejects command ids without the plugin-id prefix', () => {
    installPluginRegistry(() => stubApi);
    const bad = def();
    bad.commands[0]!.id = 'other.hello';
    expect(registerPluginDefinition(bad).ok).toBe(false);
  });
  it('re-registering the same definition is a no-op success', () => {
    installPluginRegistry(() => stubApi);
    expect(registerPluginDefinition(def()).ok).toBe(true);
    expect(registerPluginDefinition(def()).ok).toBe(true);
    expect(pluginCommandIds()).toEqual(['demo.hello']);
    expect(registeredPlugins()).toEqual([{ id: 'demo', name: 'Demo' }]);
  });
  it('re-registering with different commands still rejects', () => {
    installPluginRegistry(() => stubApi);
    expect(registerPluginDefinition(def()).ok).toBe(true);
    const d2 = def();
    d2.commands.push({ id: 'demo.extra', label: 'Extra', run: () => {} });
    expect(registerPluginDefinition(d2).ok).toBe(false);
    expect(pluginCommandIds()).toEqual(['demo.hello']);
  });
  it('rejects duplicate command ids within one definition', () => {
    installPluginRegistry(() => stubApi);
    const d = def();
    d.commands.push({ ...d.commands[0]! });
    expect(registerPluginDefinition(d).ok).toBe(false);
    expect(pluginCommandIds()).toEqual([]);
  });
  it('runs a command with the per-plugin api and survives a throwing run', () => {
    installPluginRegistry(() => stubApi);
    const run = vi.fn(() => {
      throw new Error('boom');
    });
    const d = def();
    d.commands[0]!.run = run;
    registerPluginDefinition(d);
    expect(runPluginCommand('demo.hello')).toBe(true);
    expect(run).toHaveBeenCalledWith(stubApi);
    expect(runPluginCommand('missing.cmd')).toBe(false);
  });
  it('rejects non-string keywords and defaultKey types', () => {
    installPluginRegistry(() => stubApi);
    const k = def();
    (k.commands[0] as any).keywords = 42;
    expect(registerPluginDefinition(k).ok).toBe(false);
    const d = def();
    (d.commands[0] as any).defaultKey = 42;
    expect(registerPluginDefinition(d).ok).toBe(false);
    expect(pluginCommandIds()).toEqual([]);
  });
  it('rejects a malformed plugin id and a missing name', () => {
    installPluginRegistry(() => stubApi);
    expect(registerPluginDefinition(def({ id: 'a.b' } as any)).ok).toBe(false);
    expect(registerPluginDefinition(def({ name: '' } as any)).ok).toBe(false);
  });
  it('is immune to getter-swapped command arrays', () => {
    installPluginRegistry(() => stubApi);
    const clean = [{ id: 'demo.ok', label: 'Ok', run: () => {} }];
    const dirty = [{ id: 'other.hijack', label: 'Bad', run: () => {} }];
    let reads = 0;
    const d: any = { id: 'demo', name: 'Demo', apiVersion: 1 };
    Object.defineProperty(d, 'commands', { get: () => (reads++ === 0 ? clean : dirty) });
    registerPluginDefinition(d);
    expect(pluginCommandIds().includes('other.hijack')).toBe(false);
  });
  it('is immune to a stateful per-field getter swapping id after validation', () => {
    installPluginRegistry(() => stubApi);
    let reads = 0;
    const c: any = { label: 'Ok', run: () => {} };
    Object.defineProperty(c, 'id', { get: () => (reads++ === 0 ? 'demo.ok' : 'other.hijack') });
    const d: any = { id: 'demo', name: 'Demo', apiVersion: 1, commands: [c] };
    registerPluginDefinition(d);
    expect(pluginCommandIds().includes('other.hijack')).toBe(false);
    expect(pluginCommandIds().includes('demo.ok')).toBe(true);
  });
  it('toasts when an async run rejects', async () => {
    installPluginRegistry(() => stubApi);
    const d = def();
    d.commands[0]!.run = () => Promise.reject(new Error('boom'));
    registerPluginDefinition(d);
    expect(runPluginCommand('demo.hello')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Demo'));
  });
});

describe('activate lifecycle hook', () => {
  it('calls activate once with the plugin api on first registration, not on the re-enable no-op', () => {
    const api = { showToast: () => {} } as unknown as CardMirrorPluginApi;
    installPluginRegistry(() => api);
    const activate = vi.fn();
    expect(registerPluginDefinition(def({ activate })).ok).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(api);
    expect(registerPluginDefinition(def({ activate })).ok).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('calls the returned disposer on unregister', () => {
    installPluginRegistry(() => stubApi);
    const dispose = vi.fn();
    registerPluginDefinition(def({ activate: () => dispose }));
    expect(dispose).not.toHaveBeenCalled();
    unregisterPlugin('demo');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('a throwing activate toasts but keeps the plugin and its commands registered', () => {
    installPluginRegistry(() => stubApi);
    const res = registerPluginDefinition(
      def({
        activate: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(res.ok).toBe(true);
    expect(pluginCommandIds()).toContain('demo.hello');
    expect(showToast).toHaveBeenCalledWith('Demo: activate failed — boom');
  });

  it('toasts when an async activate rejects', async () => {
    installPluginRegistry(() => stubApi);
    registerPluginDefinition(def({ activate: () => Promise.reject(new Error('late')) }));
    await Promise.resolve();
    await Promise.resolve();
    expect(showToast).toHaveBeenCalledWith('Demo: activate failed — late');
  });

  it('rejects a non-function activate', () => {
    installPluginRegistry(() => stubApi);
    const res = registerPluginDefinition(def({ activate: 42 as unknown as PluginDefinition['activate'] }));
    expect(res).toEqual({ ok: false, error: 'activate must be a function' });
  });

  it('a throwing disposer does not block unregistering', () => {
    installPluginRegistry(() => stubApi);
    registerPluginDefinition(
      def({
        activate: () => () => {
          throw new Error('nope');
        },
      }),
    );
    expect(unregisterPlugin('demo')).toEqual(['demo.hello']);
    expect(registeredPlugins()).toEqual([]);
  });
});

describe('plugin settings declarations', () => {
  const SETTINGS = [
    { key: 'auto-send', label: 'Auto-send', type: 'boolean' as const, default: true },
    { key: 'endpoint', label: 'Endpoint', type: 'text' as const, default: '', description: 'Where to post' },
    { key: 'batch', label: 'Batch size', type: 'number' as const, default: 5 },
    { key: 'mode', label: 'Mode', type: 'select' as const, default: 'fast', options: ['fast', 'careful'] },
  ];

  it('registers all four setting types and snapshots them', () => {
    installPluginRegistry(() => stubApi);
    expect(registerPluginDefinition(def({ settings: [...SETTINGS] })).ok).toBe(true);
    const defs = pluginSettingsDefs('demo');
    expect(defs.map((d) => d.key)).toEqual(['auto-send', 'endpoint', 'batch', 'mode']);
    expect(defs[3]!.options).toEqual(['fast', 'careful']);
    expect(defs[1]!.description).toBe('Where to post');
  });

  it('returns [] for a plugin without settings or not registered', () => {
    installPluginRegistry(() => stubApi);
    expect(registerPluginDefinition(def()).ok).toBe(true);
    expect(pluginSettingsDefs('demo')).toEqual([]);
    expect(pluginSettingsDefs('ghost')).toEqual([]);
  });

  it('defs vanish when the plugin unregisters', () => {
    installPluginRegistry(() => stubApi);
    registerPluginDefinition(def({ settings: [SETTINGS[0]!] }));
    expect(pluginSettingsDefs('demo').length).toBe(1);
    unregisterPlugin('demo');
    expect(pluginSettingsDefs('demo')).toEqual([]);
  });

  it('rejects every off-shape settings declaration', () => {
    installPluginRegistry(() => stubApi);
    const bad: unknown[] = [
      'not-an-array',
      [{ key: 'bad key!', label: 'X', type: 'boolean', default: true }],
      [{ key: 'a', label: 'A', type: 'boolean', default: true }, { key: 'a', label: 'B', type: 'boolean', default: false }],
      [{ key: 'a', label: '', type: 'boolean', default: true }],
      [{ key: 'a', label: 'A', type: 'color', default: '#fff' }],
      [{ key: 'a', label: 'A', type: 'select', default: 'x' }],
      [{ key: 'a', label: 'A', type: 'select', default: 'x', options: [] }],
      [{ key: 'a', label: 'A', type: 'select', default: 'z', options: ['x', 'y'] }],
      [{ key: 'a', label: 'A', type: 'boolean', default: true, options: ['x'] }],
      [{ key: 'a', label: 'A', type: 'boolean', default: 'yes' }],
      [{ key: 'a', label: 'A', type: 'number', default: Number.NaN }],
      [{ key: 'a', label: 'A', type: 'text', default: 7 }],
      [{ key: 'a', label: 'A', type: 'multiline', default: 7 }],
      [{ key: 'a', label: 'A', type: 'multiline', default: 'x', options: ['a'] }],
      [{ key: 'a', label: 'A', type: 'boolean', default: true, description: 42 }],
      [null],
    ];
    for (const settings of bad) {
      const res = registerPluginDefinition(def({ settings: settings as never }));
      expect(res.ok, JSON.stringify(settings)).toBe(false);
    }
    // Every rejection is whole-definition: nothing registered at all.
    expect(pluginCommandIds()).toEqual([]);
  });

  it('snapshots are immune to post-registration mutation of the definition', () => {
    installPluginRegistry(() => stubApi);
    const settings = [{ key: 'a', label: 'A', type: 'boolean' as const, default: true }];
    registerPluginDefinition(def({ settings }));
    settings[0]!.label = 'HIJACKED';
    (settings as unknown[]).push({ key: 'b', label: 'B', type: 'boolean', default: false });
    const defs = pluginSettingsDefs('demo');
    expect(defs.length).toBe(1);
    expect(defs[0]!.label).toBe('A');
  });

  it('the re-enable no-op refreshes settings snapshots (dev reload path)', () => {
    installPluginRegistry(() => stubApi);
    registerPluginDefinition(def({ settings: [{ key: 'a', label: 'Old', type: 'boolean', default: true }] }));
    const res = registerPluginDefinition(def({ settings: [{ key: 'a', label: 'New', type: 'boolean', default: true }] }));
    expect(res.ok).toBe(true);
    expect(pluginSettingsDefs('demo')[0]!.label).toBe('New');
  });
});

describe('multiline settings', () => {
  it('accepts a multiline declaration with a string default', () => {
    installPluginRegistry(() => stubApi);
    const ok = registerPluginDefinition(
      def({
        settings: [
          { key: 'keywords', label: 'Keywords', type: 'multiline', default: 'a\nb\nc' },
          { key: 'phrases', label: 'Phrases', type: 'multiline', default: '' },
        ],
      }),
    );
    expect(ok.ok).toBe(true);
    const defs = pluginSettingsDefs('demo');
    expect(defs.map((d) => d.type)).toEqual(['multiline', 'multiline']);
    expect(defs[0]!.default).toBe('a\nb\nc');
  });
});
