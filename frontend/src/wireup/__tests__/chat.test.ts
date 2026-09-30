// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChatStatus, sendChat } from '../chatClient';

afterEach(() => vi.unstubAllGlobals());
describe('plain Wireup chat API client', () => {
  it('sends only messages to the new backend chat endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { role: 'assistant', content: 'Temperature monitor advice' }, model: 'test' })));
    vi.stubGlobal('fetch', fetch);
    const messages = [{ role: 'user' as const, content: 'Build an Arduino temperature monitor.' }];
    const answer = await sendChat(messages, new AbortController().signal);
    expect(answer.message.content).toBe('Temperature monitor advice');
    expect(fetch.mock.calls[0][0]).toBe('/api/ai/chat');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ messages });
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });
  it('preserves conversation history', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { role: 'assistant', content: 'Follow-up' }, model: 'test' })));
    vi.stubGlobal('fetch', fetch);
    const messages = [{ role: 'user' as const, content: 'First' }, { role: 'assistant' as const, content: 'Answer' }, { role: 'user' as const, content: 'Second' }];
    await sendChat(messages, new AbortController().signal);
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages).toEqual(messages);
  });
  it('returns sanitized backend errors and rejects invalid responses', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Provider authentication failed.' }), { status: 502 })).mockResolvedValueOnce(new Response(JSON.stringify({ message: { role: 'assistant', content: '' }, model: 'test' })));
    vi.stubGlobal('fetch', fetch);
    await expect(sendChat([{ role: 'user', content: 'hello' }], new AbortController().signal)).rejects.toThrow('Provider authentication failed.');
    await expect(sendChat([{ role: 'user', content: 'hello' }], new AbortController().signal)).rejects.toThrow();
  });
  it('validates limits and roles before network requests', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(sendChat([], new AbortController().signal)).rejects.toThrow();
    await expect(sendChat([{ role: 'user', content: ' ' }], new AbortController().signal)).rejects.toThrow();
    await expect(sendChat([{ role: 'assistant', content: 'answer' }], new AbortController().signal)).rejects.toThrow();
    await expect(sendChat(Array.from({ length: 33 }, () => ({ role: 'user' as const, content: 'x' })), new AbortController().signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('checks settings without claiming a provider connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: false, model: 'test', message: 'Set AI_API_KEY' }))));
    expect(await getChatStatus(new AbortController().signal)).toMatchObject({ configured: false });
  });
});
