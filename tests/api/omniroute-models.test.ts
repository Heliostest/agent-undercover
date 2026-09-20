import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('GET /api/omniroute/models', () => {
  const prevKey = process.env.OMNIROUTE_API_KEY;
  const prevBase = process.env.OMNIROUTE_BASE_URL;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.OMNIROUTE_API_KEY;
    delete process.env.OMNIROUTE_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevKey === undefined) delete process.env.OMNIROUTE_API_KEY;
    else process.env.OMNIROUTE_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.OMNIROUTE_BASE_URL;
    else process.env.OMNIROUTE_BASE_URL = prevBase;
  });

  it('成功时抽出 id、去重排序', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, { id: '  ' }, { id: 1 }],
          }),
          { status: 200 },
        ),
      ),
    );
    const { GET } = await import('@/app/api/omniroute/models/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: ['a', 'b'] });
  });

  it('上游拒绝连接时 502 且不回显 Key', async () => {
    process.env.OMNIROUTE_API_KEY = 'secret-should-not-leak';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );
    const { GET } = await import('@/app/api/omniroute/models/route');
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/OmniRoute|连/);
    expect(JSON.stringify(body)).not.toContain('secret-should-not-leak');
  });

  it('上游非 JSON 时 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));
    const { GET } = await import('@/app/api/omniroute/models/route');
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/无法解析|OmniRoute/);
  });

  it('上游非 2xx 时 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const { GET } = await import('@/app/api/omniroute/models/route');
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/HTTP 500|模型/);
  });

  it('非空 OMNIROUTE_API_KEY 时带 Bearer', async () => {
    process.env.OMNIROUTE_API_KEY = 'env-key';
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const { GET } = await import('@/app/api/omniroute/models/route');
    await GET();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer env-key');
  });
});
