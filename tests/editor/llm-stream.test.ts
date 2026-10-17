/**
 * Streaming replies (`LlmRequest.onText`) for all three providers, against
 * fake server-sent-event bodies. `fetch` is stubbed: no network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLlm } from '../../src/editor/ai/llm.js';
import { settings } from '../../src/editor/settings.js';

function sse(events: unknown[], chunkAt = 7): Response {
  const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  // Split mid-event to prove the reader buffers across chunks.
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += chunkAt) c.enqueue(bytes.slice(i, i + chunkAt));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  settings.set('aiProvider', 'anthropic');
  settings.set('openrouterModel', '');
});

describe('streaming', () => {
  it('Anthropic: text deltas arrive in order and the stop reason is kept', async () => {
    settings.set('aiProvider', 'anthropic');
    fetchMock.mockResolvedValueOnce(
      sse([
        { type: 'message_start' },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
        { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
        { type: 'message_stop' },
      ]),
    );
    const seen: string[] = [];
    const reply = await callLlm({ apiKey: 'k', messages: [{ role: 'user', content: 'x' }], onText: (t) => seen.push(t) });
    expect(seen).toEqual(['Hel', 'Hello']);
    expect(reply).toEqual({ text: 'Hello', stopReason: 'max_tokens' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).stream).toBe(true);
  });

  it('Gemini: uses the SSE endpoint, skips thought parts, maps MAX_TOKENS', async () => {
    settings.set('aiProvider', 'gemini');
    fetchMock.mockResolvedValueOnce(
      sse([
        { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: '{"a":' }] } }] },
        { candidates: [{ content: { parts: [{ text: '1}' }] }, finishReason: 'MAX_TOKENS' }] },
      ]),
    );
    const seen: string[] = [];
    const reply = await callLlm({ apiKey: 'k', model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'x' }], onText: (t) => seen.push(t) });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/:streamGenerateContent\?alt=sse$/);
    expect(seen).toEqual(['{"a":', '{"a":1}']);
    expect(reply).toEqual({ text: '{"a":1}', stopReason: 'max_tokens' });
  });

  it('Gemini: a safety stop still throws the refusal', async () => {
    settings.set('aiProvider', 'gemini');
    fetchMock.mockResolvedValueOnce(sse([{ candidates: [{ finishReason: 'SAFETY' }] }]));
    await expect(
      callLlm({ apiKey: 'k', model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'x' }], onText: () => {} }),
    ).rejects.toMatchObject({ kind: 'refusal' });
  });

  it('OpenRouter: deltas, [DONE], and the length finish reason', async () => {
    settings.set('aiProvider', 'openrouter');
    settings.set('openrouterModel', 'anthropic/claude-sonnet-4.6');
    fetchMock.mockResolvedValueOnce(
      sse([
        { choices: [{ delta: { content: 'a' } }] },
        { choices: [{ delta: { content: 'b' }, finish_reason: 'length' }] },
        '[DONE]',
      ]),
    );
    const seen: string[] = [];
    const reply = await callLlm({ apiKey: 'k', messages: [{ role: 'user', content: 'x' }], onText: (t) => seen.push(t) });
    expect(seen).toEqual(['a', 'ab']);
    expect(reply.text).toBe('ab');
    expect(reply.stopReason).toBe('max_tokens');
  });

  it('without onText nothing changes: a plain JSON request', async () => {
    settings.set('aiProvider', 'anthropic');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }), { status: 200 }),
    );
    const reply = await callLlm({ apiKey: 'k', messages: [{ role: 'user', content: 'x' }] });
    expect(reply.text).toBe('hi');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).stream).toBeUndefined();
  });
});
