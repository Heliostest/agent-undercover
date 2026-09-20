import { describe, expect, it, vi } from 'vitest';

import {
  OMNIROUTE_DEFAULT_BASE_URL,
  createOmnirouteClient,
  normalizeOmnirouteBaseUrl,
} from '@/lib/llm/omniroute';

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('normalizeOmnirouteBaseUrl', () => {
  it('空串与 undefined 回落默认', () => {
    expect(normalizeOmnirouteBaseUrl(undefined)).toBe(OMNIROUTE_DEFAULT_BASE_URL);
    expect(normalizeOmnirouteBaseUrl('')).toBe(OMNIROUTE_DEFAULT_BASE_URL);
    expect(normalizeOmnirouteBaseUrl('   ')).toBe(OMNIROUTE_DEFAULT_BASE_URL);
  });

  it('去掉首尾空白与尾斜杠', () => {
    expect(normalizeOmnirouteBaseUrl('  http://host/v1/  ')).toBe('http://host/v1');
    expect(normalizeOmnirouteBaseUrl('http://host/v1///')).toBe('http://host/v1');
  });
});

describe('createOmnirouteClient', () => {
  it('暴露 provider 与 model，默认打到本地 OmniRoute，空 Key 不带 Bearer', async () => {
    const fetchImpl = vi.fn(async () => okResponse('嗨'));
    const client = createOmnirouteClient({
      apiKey: '',
      model: 'gpt-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(client.provider).toBe('omniroute');
    expect(client.model).toBe('gpt-test');
    await client.complete([{ role: 'user', content: 'hi' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${OMNIROUTE_DEFAULT_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('非空 apiKey 时带 Bearer；自定义 baseUrl 去尾斜杠', async () => {
    const fetchImpl = vi.fn(async () => okResponse('嗨'));
    const client = createOmnirouteClient({
      apiKey: 'or-local',
      model: 'm',
      baseUrl: 'http://127.0.0.1:20128/v1/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.complete([{ role: 'user', content: 'hi' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:20128/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer or-local');
  });
});
