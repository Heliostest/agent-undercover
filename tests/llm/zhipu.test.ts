import { describe, expect, it, vi } from 'vitest';

import {
  MissingApiKeyError,
  ZHIPU_DEFAULT_BASE_URL,
  createZhipuClient,
  readZhipuConfigFromEnv,
} from '@/lib/llm/zhipu';

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: '炸了' } }), { status });
}

function makeClient(fetchImpl: typeof fetch, sleep = vi.fn(async () => {})) {
  const client = createZhipuClient({
    apiKey: 'test-key',
    model: 'glm-4-flash',
    fetchImpl,
    sleep,
  });
  return { client, sleep };
}

describe('readZhipuConfigFromEnv', () => {
  it('读取 key 与 model', () => {
    expect(readZhipuConfigFromEnv({ ZHIPU_API_KEY: 'k', ZHIPU_MODEL: 'glm-4-plus' })).toEqual({
      apiKey: 'k',
      model: 'glm-4-plus',
    });
  });

  it('未配置 ZHIPU_MODEL 时回退到 glm-4-flash', () => {
    expect(readZhipuConfigFromEnv({ ZHIPU_API_KEY: 'k' }).model).toBe('glm-4-flash');
  });

  it('缺少 ZHIPU_API_KEY 时抛 MissingApiKeyError', () => {
    expect(() => readZhipuConfigFromEnv({})).toThrow(MissingApiKeyError);
    expect(() => readZhipuConfigFromEnv({ ZHIPU_API_KEY: '   ' })).toThrow('缺少 ZHIPU_API_KEY');
  });
});

describe('createZhipuClient', () => {
  it('把消息发到 chat/completions 并返回首个 choice 的文本', async () => {
    const fetchImpl = vi.fn(async () => okResponse('白白的液体'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const text = await client.complete([{ role: 'user', content: '描述一下' }], {
      temperature: 0.2,
    });

    expect(text).toBe('白白的液体');
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

  it('429 后退避重试并最终成功，退避是 500ms / 1000ms', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse('成功'));
    const { client, sleep } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toBe('成功');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });

  it('一直 500 时最多请求 3 次后抛错', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow('智谱接口返回 500');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('400 不重试', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(400));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow('智谱接口返回 400');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('网络异常会重试', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse('恢复了'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toBe('恢复了');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('返回空内容视为可重试失败', async () => {
    const fetchImpl = vi.fn(async () => okResponse('   '));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow('智谱接口返回了空内容');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
