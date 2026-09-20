import { describe, expect, it, vi } from 'vitest';

import {
  InvalidLlmConfigError,
  MAX_API_KEY_LENGTH,
  MAX_MODEL_LENGTH,
  createLlmClient,
  parseLlmConfig,
} from '@/lib/llm/create-client';
import { createOpenAiCompatibleClient } from '@/lib/llm/openai-compatible';
import { DEFAULT_MODELS, PROVIDERS, PROVIDER_LABELS, isLlmProvider } from '@/lib/llm/providers';

function okFetch() {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '嗨' } }] }), { status: 200 }),
  );
}

describe('providers 常量', () => {
  it('供应商顺序固定，标签与默认模型齐全', () => {
    expect(PROVIDERS).toEqual(['zhipu', 'deepseek', 'openrouter', 'omniroute']);
    expect(PROVIDER_LABELS).toEqual({
      zhipu: '智谱',
      deepseek: 'DeepSeek',
      openrouter: 'OpenRouter',
      omniroute: '本地 OmniRoute',
    });
    expect(DEFAULT_MODELS).toEqual({
      zhipu: 'glm-4-flash',
      deepseek: 'deepseek-chat',
      openrouter: 'openai/gpt-4o-mini',
      omniroute: 'omniroute-default',
    });
  });

  it('isLlmProvider 只认这四个字符串', () => {
    expect(isLlmProvider('zhipu')).toBe(true);
    expect(isLlmProvider('deepseek')).toBe(true);
    expect(isLlmProvider('openrouter')).toBe(true);
    expect(isLlmProvider('omniroute')).toBe(true);
    expect(isLlmProvider('openai')).toBe(false);
    expect(isLlmProvider(undefined)).toBe(false);
  });
});

describe('createOpenAiCompatibleClient 的认证头', () => {
  it('apiKey 非空时带 Bearer', async () => {
    const fetchImpl = okFetch();
    const client = createOpenAiCompatibleClient({
      provider: 'zhipu',
      label: '智谱',
      baseUrl: 'http://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.complete([{ role: 'user', content: 'hi' }]);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('apiKey 为空时请求头不带 authorization', async () => {
    const fetchImpl = okFetch();
    const client = createOpenAiCompatibleClient({
      provider: 'zhipu',
      label: '智谱',
      baseUrl: 'http://example.test/v1',
      apiKey: '   ',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.complete([{ role: 'user', content: 'hi' }]);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe('parseLlmConfig', () => {
  it('三项齐全时原样返回并 trim', () => {
    expect(
      parseLlmConfig({ provider: 'deepseek', model: ' deepseek-reasoner ', apiKey: ' sk-1 ' }),
    ).toEqual({ provider: 'deepseek', model: 'deepseek-reasoner', apiKey: 'sk-1' });
  });

  it('model 缺失或全空白时回落到该供应商默认模型', () => {
    expect(parseLlmConfig({ provider: 'zhipu', apiKey: 'k' }).model).toBe('glm-4-flash');
    expect(parseLlmConfig({ provider: 'deepseek', model: '   ', apiKey: 'k' }).model).toBe(
      'deepseek-chat',
    );
    expect(parseLlmConfig({ provider: 'openrouter', apiKey: 'k' }).model).toBe(
      'openai/gpt-4o-mini',
    );
  });

  it('OpenRouter 的「厂商/模型」写法不会被当成非法模型', () => {
    expect(
      parseLlmConfig({ provider: 'openrouter', model: ' anthropic/claude-3.5-sonnet ', apiKey: 'k' }),
    ).toEqual({ provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet', apiKey: 'k' });
  });

  it('请求体不是对象时抛 InvalidLlmConfigError', () => {
    expect(() => parseLlmConfig(null)).toThrow(InvalidLlmConfigError);
    expect(() => parseLlmConfig('zhipu')).toThrow('请求体必须是 JSON 对象');
  });

  it('未知 provider 抛错并给出可选值', () => {
    expect(() => parseLlmConfig({ provider: 'openai', apiKey: 'k' })).toThrow(
      'provider 只能是 zhipu 或 deepseek 或 openrouter 或 omniroute',
    );
    expect(() => parseLlmConfig({ apiKey: 'k' })).toThrow(InvalidLlmConfigError);
  });

  it('缺 Key 或 Key 全空白时抛错', () => {
    expect(() => parseLlmConfig({ provider: 'zhipu', model: 'glm-4-flash' })).toThrow(
      '缺少 apiKey',
    );
    expect(() => parseLlmConfig({ provider: 'zhipu', apiKey: '   ' })).toThrow('缺少 apiKey');
    expect(() => parseLlmConfig({ provider: 'zhipu', apiKey: 123 })).toThrow('缺少 apiKey');
  });

  it('model 不是字符串时抛错', () => {
    expect(() => parseLlmConfig({ provider: 'zhipu', model: 42, apiKey: 'k' })).toThrow(
      'model 必须是字符串',
    );
  });

  it('超长的 model 与 apiKey 被拒绝', () => {
    expect(() =>
      parseLlmConfig({ provider: 'zhipu', model: 'm'.repeat(MAX_MODEL_LENGTH + 1), apiKey: 'k' }),
    ).toThrow(`model 长度不能超过 ${MAX_MODEL_LENGTH}`);
    expect(() =>
      parseLlmConfig({ provider: 'zhipu', apiKey: 'k'.repeat(MAX_API_KEY_LENGTH + 1) }),
    ).toThrow(`apiKey 长度不能超过 ${MAX_API_KEY_LENGTH}`);
  });

  it('错误文案里绝不回显 Key', () => {
    try {
      parseLlmConfig({ provider: 'openai', apiKey: 'sk-secret-value' });
      throw new Error('should not reach');
    } catch (error) {
      expect((error as Error).message).not.toContain('sk-secret-value');
    }
  });

  it('忽略请求体里多出来的字段', () => {
    expect(
      parseLlmConfig({ provider: 'zhipu', apiKey: 'k', baseUrl: 'http://evil.example' }),
    ).toEqual({ provider: 'zhipu', model: 'glm-4-flash', apiKey: 'k' });
  });

  it('omniroute 允许缺省或空 apiKey', () => {
    expect(parseLlmConfig({ provider: 'omniroute', model: 'm1' })).toEqual({
      provider: 'omniroute',
      model: 'm1',
      apiKey: '',
    });
    expect(parseLlmConfig({ provider: 'omniroute', model: 'm1', apiKey: '  ' })).toEqual({
      provider: 'omniroute',
      model: 'm1',
      apiKey: '',
    });
  });

  it('omniroute 的非字符串 apiKey 抛错', () => {
    expect(() => parseLlmConfig({ provider: 'omniroute', model: 'm1', apiKey: 123 })).toThrow(
      'apiKey 必须是字符串',
    );
  });
});

describe('createLlmClient', () => {
  it('按 provider 分发，并把 model 透传给客户端', () => {
    const zhipu = createLlmClient({ provider: 'zhipu', model: 'glm-4-plus', apiKey: 'k' });
    const deepseek = createLlmClient({
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      apiKey: 'k',
    });

    const openrouter = createLlmClient({
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      apiKey: 'k',
    });

    expect(zhipu.provider).toBe('zhipu');
    expect(zhipu.model).toBe('glm-4-plus');
    expect(deepseek.provider).toBe('deepseek');
    expect(deepseek.model).toBe('deepseek-reasoner');
    expect(openrouter.provider).toBe('openrouter');
    expect(openrouter.model).toBe('openai/gpt-4o-mini');
  });

  it('注入的 fetchImpl 会被真正用上（测试里绝不发真实请求）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '嗨' } }] }), {
          status: 200,
        }),
    );
    const client = createLlmClient(
      { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'k' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      text: '嗨',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('createLlmClient(omniroute) 使用默认 baseUrl，忽略 config.apiKey', async () => {
    const fetchImpl = okFetch();
    const prevKey = process.env.OMNIROUTE_API_KEY;
    const prevBase = process.env.OMNIROUTE_BASE_URL;
    delete process.env.OMNIROUTE_API_KEY;
    delete process.env.OMNIROUTE_BASE_URL;
    try {
      const client = createLlmClient(
        { provider: 'omniroute', model: 'm', apiKey: 'browser-should-ignore' },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      );
      expect(client.provider).toBe('omniroute');
      await client.complete([{ role: 'user', content: 'hi' }]);
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:20128/v1/chat/completions');
      expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    } finally {
      if (prevKey === undefined) delete process.env.OMNIROUTE_API_KEY;
      else process.env.OMNIROUTE_API_KEY = prevKey;
      if (prevBase === undefined) delete process.env.OMNIROUTE_BASE_URL;
      else process.env.OMNIROUTE_BASE_URL = prevBase;
    }
  });

  it('createLlmClient(omniroute) 使用 env 中的 Key 与 baseUrl', async () => {
    const fetchImpl = okFetch();
    const prevKey = process.env.OMNIROUTE_API_KEY;
    const prevBase = process.env.OMNIROUTE_BASE_URL;
    process.env.OMNIROUTE_API_KEY = 'env-secret';
    process.env.OMNIROUTE_BASE_URL = 'http://127.0.0.1:9/v1';
    try {
      const client = createLlmClient(
        { provider: 'omniroute', model: 'm', apiKey: 'browser' },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      );
      await client.complete([{ role: 'user', content: 'hi' }]);
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:9/v1/chat/completions');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer env-secret');
    } finally {
      if (prevKey === undefined) delete process.env.OMNIROUTE_API_KEY;
      else process.env.OMNIROUTE_API_KEY = prevKey;
      if (prevBase === undefined) delete process.env.OMNIROUTE_BASE_URL;
      else process.env.OMNIROUTE_BASE_URL = prevBase;
    }
  });

  it('按 provider 分发含 omniroute', () => {
    const client = createLlmClient({ provider: 'omniroute', model: 'x', apiKey: '' });
    expect(client.provider).toBe('omniroute');
    expect(client.model).toBe('x');
  });
});
