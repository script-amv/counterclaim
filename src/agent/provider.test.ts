import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider, type Message, type ToolDefinition } from './provider';

const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"demo"}', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_dispute', arguments: '{}' } }] } }], usage: { total_tokens: 125, cost: 0.0002 } }));
function setup(responses: (Response | Error)[], options: { model?: string; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  const fetcher = vi.fn(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error('Fake queue exhausted');
    return response;
  });
  const provider = new OpenRouterProvider({ apiKey: 'fake-model-key', fetch: fetcher, sleep: async () => {}, ...options });
  return { provider, fetcher };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const messages: Message[] = [{ role: 'system', content: 'Read-only sandbox facts.' }, { role: 'user', content: 'Investigate.' }];
const tools: ToolDefinition[] = [{ type: 'function', function: { name: 'get_dispute', description: 'Read current dispute', parameters: { type: 'object', properties: {} } } }];

describe('OpenRouter provider offline contract', () => {
  it('sends the complete chat contract with required tool parameters and returns usage/cost', async () => {
    vi.stubEnv('OPENROUTER_MODEL', '');
    const { provider, fetcher } = setup([reply()]);
    const result = await provider.complete(messages, tools, 999);
    expect(provider.model).toBe('deepseek/deepseek-v4-flash');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { Authorization: 'Bearer fake-model-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek/deepseek-v4-flash', messages, tools, max_tokens: 999, temperature: 0, provider: { require_parameters: true } }),
    });
    expect(result).toEqual({ content: '{"summary":"demo"}', toolCalls: [{ id: 'call-1', name: 'get_dispute', arguments: '{}' }], usage: { total_tokens: 125, cost: 0.0002 } });
  });
  it('uses the environment model, with explicit constructor model taking precedence', () => {
    vi.stubEnv('OPENROUTER_MODEL', 'test/environment-model');
    expect(setup([]).provider.model).toBe('test/environment-model');
    expect(setup([], { model: 'test/explicit-model' }).provider.model).toBe('test/explicit-model');
  });
  it.each([429, 500, 503, 599])('retries HTTP %s exactly once and returns success', async status => {
    const { provider, fetcher } = setup([new Response('private provider text', { status }), reply()]);
    await expect(provider.complete(messages, tools, 100)).resolves.toMatchObject({ usage: { total_tokens: 125 } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([429, 503])('stops after the second HTTP %s response without exposing response text', async status => {
    const { provider, fetcher } = setup([new Response('fake-model-key private@example.invalid', { status }), new Response('fake-model-key private@example.invalid', { status })]);
    await expect(provider.complete(messages, tools, 100)).rejects.toThrow('Model provider refused request');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 422])('does not retry HTTP %s', async status => {
    const { provider, fetcher } = setup([new Response('fake-model-key private@example.invalid', { status })]);
    await expect(provider.complete(messages, tools, 100)).rejects.toThrow('Model provider refused request');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry or reveal transport errors', async () => {
    const { provider, fetcher } = setup([new Error('fake-model-key private@example.invalid')]);
    await expect(provider.complete(messages, tools, 100)).rejects.toThrow('Model transport failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('configures a timeout for every attempt and supports injected timeout duration', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await setup([reply()]).provider.complete(messages, tools, 100);
    expect(timeout).toHaveBeenLastCalledWith(120000);
    await setup([new Response('', { status: 429 }), reply()], { timeoutMs: 20 }).provider.complete(messages, tools, 100);
    expect(timeout.mock.calls).toEqual([[120000], [20], [20]]);
  });
  it.each(['not JSON private@example.invalid', '{}', '{"choices":[]}', '{"choices":[{"message":{"content":42}}]}', '{"choices":[{"message":{"content":"demo"}}],"usage":{"total_tokens":-1}}'])('rejects invalid response safely without retry (%s)', async data => {
    const { provider, fetcher } = setup([new Response(data)]);
    await expect(provider.complete(messages, tools, 100)).rejects.toThrow('Invalid model response');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('suppresses errors when disposing a retryable response body', async () => {
    const response = new Response('', { status: 429 });
    vi.spyOn(response.body!, 'cancel').mockRejectedValue(new Error('fake-model-key private@example.invalid'));
    const { provider, fetcher } = setup([response, reply()]);
    await expect(provider.complete(messages, tools, 100)).resolves.toMatchObject({ usage: { total_tokens: 125 } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('fails closed without an API key', () => {
    expect(() => new OpenRouterProvider({ apiKey: '' })).toThrow('Model provider is not configured');
  });
});
it('rejects an oversized response before buffering its full body', async () => {
  const { provider, fetcher } = setup([new Response(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(1024 * 1024) } }] }))]);
  await expect(provider.complete(messages, tools, 100)).rejects.toThrow('Invalid model response'); expect(fetcher).toHaveBeenCalledOnce();
});

it('preserves preset routing and captures the actual provider', async () => {
  const { provider, fetcher } = setup([new Response(JSON.stringify({ provider: 'Mistral', choices: [{ message: { content: '{}' } }], usage: { total_tokens: 10, cost: 0 } }))], { model: '@preset/free-route' });
  const result = await provider.complete(messages, tools, 100);
  expect(JSON.parse((fetcher.mock.calls as unknown as [string, RequestInit][])[0]![1].body as string)).not.toHaveProperty('provider');
  expect(result.provider).toBe('Mistral');
});

it('honors Retry-After and records only numeric HTTP diagnostics', async () => {
  const sleep = vi.fn(async () => {});
  const { provider } = setup([new Response('private', { status: 429, headers: { 'Retry-After': '7' } }), reply()], { sleep });
  await provider.complete(messages, tools, 100);
  expect(sleep).toHaveBeenCalledWith(7000);
});
it.each([402, 429])('stops on allowance HTTP %s without retry or provider text', async status => {
  const { provider, fetcher } = setup([new Response(JSON.stringify({ error: { message: 'Daily free request quota exhausted private text' } }), { status })]);
  await expect(provider.complete(messages, tools, 100)).rejects.toMatchObject({ code: 'provider_refused', httpStatus: status, refusalKind: 'allowance' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not retry earlier than an excessive Retry-After', async () => {
  const { provider, fetcher } = setup([new Response('', { status: 429, headers: { 'Retry-After': '120' } })]);
  await expect(provider.complete(messages, tools, 100)).rejects.toMatchObject({ httpStatus: 429, refusalKind: 'rate_limit' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('honors an HTTP-date Retry-After', async () => {
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
  const sleep = vi.fn(async () => {});
  const retryAt = new Date(now + 12000).toUTCString();
  const { provider } = setup([new Response('', { status: 429, headers: { 'Retry-After': retryAt } }), reply()], { sleep });
  await provider.complete(messages, tools, 100);
  expect(sleep).toHaveBeenCalledWith(Date.parse(retryAt) - now);
});
it('reports retry exhaustion as numeric HTTP diagnostics without retaining provider content', async () => {
  const { provider } = setup([new Response('private', { status: 429 }), new Response('private', { status: 429 })]);
  const error = await provider.complete(messages, tools, 100).catch(e => e);
  expect(error).toMatchObject({ code: 'provider_refused', httpStatus: 429, refusalKind: 'rate_limit' });
  expect(JSON.stringify(error)).not.toContain('private');
});

it('stops on a plain-text daily allowance without exposing it', async () => {
  const { provider, fetcher } = setup([new Response('Daily quota exhausted private text', { status: 429 })]);
  await expect(provider.complete(messages, tools, 100)).rejects.toMatchObject({ httpStatus: 429, refusalKind: 'allowance' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
