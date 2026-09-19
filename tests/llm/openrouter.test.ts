import { describe, expect, it, vi } from 'vitest';

import {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_REFERER,
  OPENROUTER_TITLE,
  createOpenrouterClient,
} from '@/lib/llm/openrouter';

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
  const client = createOpenrouterClient({
    apiKey: 'or-key',
    model: 'openai/gpt-4o-mini',
    fetchImpl,
    sleep,
  });
  return { client, sleep };
}

describe('createOpenrouterClient', () => {
  it('暴露 provider 与 model', () => {
    const { client } = makeClient(vi.fn() as unknown as typeof fetch);
    expect(client.provider).toBe('openrouter');
    expect(client.model).toBe('openai/gpt-4o-mini');
  });

  it('打到 OpenRouter 的 chat/completions，带上 Bearer Key 与排行榜请求头', async () => {
    const fetchImpl = vi.fn(async () => okResponse('一种早餐饮品'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: '描述一下' }], {
      temperature: 0.2,
    });

    expect(completion.text).toBe('一种早餐饮品');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${OPENROUTER_DEFAULT_BASE_URL}/chat/completions`);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer or-key');
    expect(headers['HTTP-Referer']).toBe(OPENROUTER_REFERER);
    expect(headers['X-Title']).toBe(OPENROUTER_TITLE);
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'openai/gpt-4o-mini',
      temperature: 0.2,
      stream: false,
      messages: [{ role: 'user', content: '描述一下' }],
    });
  });

  it('上游给了 usage 就照常解析，没给就记未提供', async () => {
    const withUsage = vi.fn(async () =>
      okResponse('一种早餐饮品', {
        prompt_tokens: 1000,
        completion_tokens: 50,
        total_tokens: 1050,
        prompt_tokens_details: { cached_tokens: 896 },
      }),
    );
    const { client } = makeClient(withUsage as unknown as typeof fetch);
    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      usage: {
        promptTokens: 1000,
        completionTokens: 50,
        totalTokens: 1050,
        cacheHitTokens: 896,
        cacheMissTokens: 104,
        usageReported: true,
        cacheReported: true,
      },
    });

    const withoutUsage = vi.fn(async () => okResponse('一种早餐饮品'));
    const bare = makeClient(withoutUsage as unknown as typeof fetch);
    await expect(bare.client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      usage: { usageReported: false, cacheReported: false, totalTokens: 0 },
    });
  });

  it('错误文案用 OpenRouter 作为供应商名，且不含 Key', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'OpenRouter接口返回 500',
    );
    await expect(
      client.complete([{ role: 'user', content: 'hi' }]).catch((error: Error) => error.message),
    ).resolves.not.toContain('or-key');
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
      'OpenRouter接口返回 401',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('内容为空时按错误处理', async () => {
    const fetchImpl = vi.fn(async () => okResponse(''));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'OpenRouter接口返回了空内容',
    );
  });
});
