import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveAiModel,
  DEFAULT_MODEL,
  DEFAULT_GEMINI_MODEL,
  activeApiKey,
  aiConfigured,
  callLlm,
  LlmError,
} from '../../src/editor/ai/llm.js';
import { settings } from '../../src/editor/settings.js';

describe('resolveAiModel (custom model override)', () => {
  afterEach(() => settings.set('aiModelOverride', ''));

  it('uses the default when no override is set', () => {
    settings.set('aiModelOverride', '');
    expect(resolveAiModel()).toBe(DEFAULT_MODEL);
  });

  it('uses a well-formed override verbatim', () => {
    settings.set('aiModelOverride', 'claude-opus-4-8');
    expect(resolveAiModel()).toBe('claude-opus-4-8');
  });

  it('reverts to the default on a malformed override', () => {
    for (const bad of ['  ', 'x', 'has space', 'bad/slash']) {
      settings.set('aiModelOverride', bad);
      expect(resolveAiModel(), `bad="${bad}"`).toBe(DEFAULT_MODEL);
    }
  });

  it('trims surrounding whitespace', () => {
    settings.set('aiModelOverride', '  claude-sonnet-4-6  ');
    expect(resolveAiModel()).toBe('claude-sonnet-4-6');
  });
});

describe('resolveAiModel (OpenRouter provider)', () => {
  afterEach(() => {
    settings.set('aiProvider', 'anthropic');
    settings.set('openrouterModel', '');
  });

  it('returns the openrouterModel verbatim when provider is openrouter', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('openrouterModel', 'anthropic/claude-sonnet-4-6');
    expect(resolveAiModel()).toBe('anthropic/claude-sonnet-4-6');
  });

  it('accepts model ids with slashes (provider/model format)', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('openrouterModel', 'anthropic/claude-sonnet-4-6');
    expect(resolveAiModel()).toBe('anthropic/claude-sonnet-4-6');
  });

  it('trims whitespace from openrouterModel', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('openrouterModel', '  anthropic/claude-sonnet-4-6  ');
    expect(resolveAiModel()).toBe('anthropic/claude-sonnet-4-6');
  });

  it('returns empty string when openrouterModel is empty', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('openrouterModel', '');
    expect(resolveAiModel()).toBe('');
  });

  it('ignores aiModelOverride when provider is openrouter', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('openrouterModel', 'mistral/mistral-7b');
    settings.set('aiModelOverride', 'claude-opus-4-8');
    expect(resolveAiModel()).toBe('mistral/mistral-7b');
  });
});

describe('resolveAiModel (Gemini provider)', () => {
  afterEach(() => {
    settings.set('aiProvider', 'anthropic');
    settings.set('geminiModel', '');
  });

  it('uses the Gemini default when no override is set', () => {
    settings.set('aiProvider', 'gemini');
    settings.set('geminiModel', '');
    expect(resolveAiModel()).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('uses a well-formed Gemini override verbatim', () => {
    settings.set('aiProvider', 'gemini');
    settings.set('geminiModel', 'gemini-2.5-pro');
    expect(resolveAiModel()).toBe('gemini-2.5-pro');
  });

  it('reverts to the Gemini default on a malformed override', () => {
    settings.set('aiProvider', 'gemini');
    for (const bad of ['  ', 'x', 'has space']) {
      settings.set('geminiModel', bad);
      expect(resolveAiModel(), `bad="${bad}"`).toBe(DEFAULT_GEMINI_MODEL);
    }
  });

  it('ignores aiModelOverride and openrouterModel when provider is gemini', () => {
    settings.set('aiProvider', 'gemini');
    settings.set('geminiModel', 'gemini-2.5-pro');
    settings.set('aiModelOverride', 'claude-opus-4-8');
    settings.set('openrouterModel', 'mistral/mistral-7b');
    expect(resolveAiModel()).toBe('gemini-2.5-pro');
    settings.set('aiModelOverride', '');
    settings.set('openrouterModel', '');
  });
});

describe('activeApiKey', () => {
  afterEach(() => {
    settings.set('aiProvider', 'anthropic');
    settings.set('anthropicApiKey', '');
    settings.set('openrouterApiKey', '');
    settings.set('geminiApiKey', '');
  });

  it('returns the anthropicApiKey by default (when provider is anthropic)', () => {
    settings.set('aiProvider', 'anthropic');
    settings.set('anthropicApiKey', 'sk-ant-test-key-123');
    expect(activeApiKey()).toBe('sk-ant-test-key-123');
  });

  it('returns the openrouterApiKey when provider is openrouter', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('openrouterApiKey', 'sk-or-test-key-456');
    expect(activeApiKey()).toBe('sk-or-test-key-456');
  });

  it('trims whitespace from anthropic key', () => {
    settings.set('aiProvider', 'anthropic');
    settings.set('anthropicApiKey', '  sk-ant-test-key-123  ');
    expect(activeApiKey()).toBe('sk-ant-test-key-123');
  });

  it('trims whitespace from openrouter key', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('openrouterApiKey', '  sk-or-test-key-456  ');
    expect(activeApiKey()).toBe('sk-or-test-key-456');
  });

  it('ignores the openrouter key when provider is anthropic', () => {
    settings.set('aiProvider', 'anthropic');
    settings.set('anthropicApiKey', 'sk-ant-active');
    settings.set('openrouterApiKey', 'sk-or-ignored');
    expect(activeApiKey()).toBe('sk-ant-active');
  });

  it('ignores the anthropic key when provider is openrouter', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('anthropicApiKey', 'sk-ant-ignored');
    settings.set('openrouterApiKey', 'sk-or-active');
    expect(activeApiKey()).toBe('sk-or-active');
  });

  it('returns the geminiApiKey when provider is gemini', () => {
    settings.set('aiProvider', 'gemini');
    settings.set('geminiApiKey', 'AIza-test-key-789');
    expect(activeApiKey()).toBe('AIza-test-key-789');
  });

  it('trims whitespace from gemini key', () => {
    settings.set('aiProvider', 'gemini');
    settings.set('geminiApiKey', '  AIza-test-key-789  ');
    expect(activeApiKey()).toBe('AIza-test-key-789');
  });

  it('ignores the gemini key when provider is anthropic', () => {
    settings.set('aiProvider', 'anthropic');
    settings.set('anthropicApiKey', 'sk-ant-active');
    settings.set('geminiApiKey', 'AIza-ignored');
    expect(activeApiKey()).toBe('sk-ant-active');
  });

  it('returns empty string when the active provider has no key', () => {
    settings.set('aiProvider', 'anthropic');
    settings.set('anthropicApiKey', '');
    expect(activeApiKey()).toBe('');
  });
});

describe('aiConfigured', () => {
  afterEach(() => {
    settings.set('aiProvider', 'anthropic');
    settings.set('aiFeaturesEnabled', false);
    settings.set('anthropicApiKey', '');
    settings.set('openrouterApiKey', '');
    settings.set('geminiApiKey', '');
  });

  it('returns false when aiFeaturesEnabled is false, even with a key', () => {
    settings.set('aiFeaturesEnabled', false);
    settings.set('anthropicApiKey', 'sk-ant-test-key-123');
    expect(aiConfigured()).toBe(false);
  });

  it('returns false when enabled but no anthropic key is set', () => {
    settings.set('aiProvider', 'anthropic');
    settings.set('aiFeaturesEnabled', true);
    settings.set('anthropicApiKey', '');
    expect(aiConfigured()).toBe(false);
  });

  it('returns false when enabled but no openrouter key is set', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('aiFeaturesEnabled', true);
    settings.set('openrouterApiKey', '');
    expect(aiConfigured()).toBe(false);
  });

  it('returns true when enabled and anthropic key is set', () => {
    settings.set('aiProvider', 'anthropic');
    settings.set('aiFeaturesEnabled', true);
    settings.set('anthropicApiKey', 'sk-ant-test-key-123');
    expect(aiConfigured()).toBe(true);
  });

  it('returns true when enabled and openrouter key is set', () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('aiFeaturesEnabled', true);
    settings.set('openrouterApiKey', 'sk-or-test-key-456');
    expect(aiConfigured()).toBe(true);
  });

  it('returns false when enabled but no gemini key is set', () => {
    settings.set('aiProvider', 'gemini');
    settings.set('aiFeaturesEnabled', true);
    settings.set('geminiApiKey', '');
    expect(aiConfigured()).toBe(false);
  });

  it('returns true when enabled and gemini key is set', () => {
    settings.set('aiProvider', 'gemini');
    settings.set('aiFeaturesEnabled', true);
    settings.set('geminiApiKey', 'AIza-test-key-789');
    expect(aiConfigured()).toBe(true);
  });

  it('returns false when enabled but key is only whitespace', () => {
    settings.set('aiProvider', 'anthropic');
    settings.set('aiFeaturesEnabled', true);
    settings.set('anthropicApiKey', '   ');
    expect(aiConfigured()).toBe(false);
  });

  it('ignores the inactive provider key', () => {
    settings.set('aiProvider', 'anthropic');
    settings.set('aiFeaturesEnabled', true);
    settings.set('anthropicApiKey', 'sk-ant-test-key-123');
    settings.set('openrouterApiKey', ''); // inactive provider's key
    expect(aiConfigured()).toBe(true);
  });
});

describe('callLlm (OpenRouter empty-model guard)', () => {
  afterEach(() => {
    settings.set('aiProvider', 'anthropic');
    settings.set('openrouterApiKey', '');
    settings.set('openrouterModel', '');
    settings.set('aiFeaturesEnabled', false);
  });

  it('callLlm rejects with a model-kind LlmError when OpenRouter has no model set', async () => {
    settings.set('aiFeaturesEnabled', true);
    settings.set('aiProvider', 'openrouter');
    settings.set('openrouterApiKey', 'sk-test');
    settings.set('openrouterModel', '');
    await expect(
      callLlm({ apiKey: 'sk-test', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(LlmError);
    await expect(
      callLlm({ apiKey: 'sk-test', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ kind: 'model' });
  });
});
