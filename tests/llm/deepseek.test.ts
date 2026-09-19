import { describe, expect, it, vi } from 'vitest';

import { DEEPSEEK_DEFAULT_BASE_URL, createDeepseekClient } from '@/lib/llm/deepseek';

function okResponse(content: string, usage?: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: '炸了' } }), { status });
}

function makeClient(fetchImpl: typeof fetch, sleep = vi.fn(async (_ms: number) => {})) {
  const client = createDeepseekClient({
    apiKey: 'ds-key',
    model: 'deepseek-chat',
    fetchImpl,
    sleep,
  });
  return { client, sleep };
}

describe('createDeepseekClient', () => {
  it('暴露 provider 与 model', () => {
    const { client } = makeClient(vi.fn() as unknown as typeof fetch);
    expect(client.provider).toBe('deepseek');
    expect(client.model).toBe('deepseek-chat');
  });

  it('打到 DeepSeek 的 chat/completions 并带上 Bearer Key', async () => {
    const fetchImpl = vi.fn(async () => okResponse('一种早餐饮品'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: '描述一下' }], {
      temperature: 0.2,
    });

    expect(completion.text).toBe('一种早餐饮品');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${DEEPSEEK_DEFAULT_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ds-key');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'deepseek-chat',
      temperature: 0.2,
      stream: false,
      messages: [{ role: 'user', content: '描述一下' }],
    });
  });

  it('映射 DeepSeek 官方的缓存命中 / 未命中字段', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse('一种早餐饮品', {
        prompt_tokens: 1000,
        completion_tokens: 50,
        total_tokens: 1050,
        prompt_cache_hit_tokens: 896,
        prompt_cache_miss_tokens: 104,
      }),
    );
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: 'hi' }]);

    expect(completion.usage).toEqual({
      promptTokens: 1000,
      completionTokens: 50,
      totalTokens: 1050,
      cacheHitTokens: 896,
      cacheMissTokens: 104,
      usageReported: true,
      cacheReported: true,
    });
  });

  it('错误文案用 DeepSeek 作为供应商名，且不含 Key', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'DeepSeek接口返回 500',
    );
    await expect(
      client.complete([{ role: 'user', content: 'hi' }]).catch((error: Error) => error.message),
    ).resolves.not.toContain('ds-key');
  });

  it('429 后按 500ms / 1000ms 退避重试', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse('成功'));
    const { client, sleep } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      text: '成功',
    });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('4xx（非 429）立即失败', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(401));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'DeepSeek接口返回 401',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('内容为空时按错误处理', async () => {
    const fetchImpl = vi.fn(async () => okResponse(''));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'DeepSeek接口返回了空内容',
    );
  });
});
