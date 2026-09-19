import { describe, expect, it, vi } from 'vitest';

import { ZHIPU_DEFAULT_BASE_URL, createZhipuClient } from '@/lib/llm/zhipu';

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
  const client = createZhipuClient({
    apiKey: 'test-key',
    model: 'glm-4-flash',
    fetchImpl,
    sleep,
  });
  return { client, sleep };
}

describe('createZhipuClient', () => {
  it('暴露 provider 与 model，供账单记录用', () => {
    const { client } = makeClient(vi.fn() as unknown as typeof fetch);
    expect(client.provider).toBe('zhipu');
    expect(client.model).toBe('glm-4-flash');
  });

  it('把消息发到 chat/completions 并返回首个 choice 的文本', async () => {
    const fetchImpl = vi.fn(async () => okResponse('白白的液体'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: '描述一下' }], {
      temperature: 0.2,
    });

    expect(completion.text).toBe('白白的液体');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ZHIPU_DEFAULT_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'glm-4-flash',
      temperature: 0.2,
      stream: false,
      messages: [{ role: 'user', content: '描述一下' }],
    });
  });

  it('响应带 usage 时映射成 LlmUsage', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse('白白的液体', {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 80 },
      }),
    );
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: 'hi' }]);

    expect(completion.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cacheHitTokens: 80,
      cacheMissTokens: 40,
      usageReported: true,
      cacheReported: true,
    });
  });

  it('响应没有 usage 时记 0 并标记未上报', async () => {
    const fetchImpl = vi.fn(async () => okResponse('白白的液体'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: 'hi' }]);

    expect(completion.usage.usageReported).toBe(false);
    expect(completion.usage.cacheReported).toBe(false);
    expect(completion.usage.totalTokens).toBe(0);
  });

  it('429 后退避重试并最终成功，退避是 500ms / 1000ms', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse('成功'));
    const { client, sleep } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      text: '成功',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('5xx 重试用尽后抛 LlmError', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '智谱接口返回 500',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('4xx（非 429）立即失败，不重试', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(400));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '智谱接口返回 400',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('网络错误也会重试', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(okResponse('恢复了'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      text: '恢复了',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('内容为空时按错误处理', async () => {
    const fetchImpl = vi.fn(async () => okResponse('   '));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '智谱接口返回了空内容',
    );
  });
});
