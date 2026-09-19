import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LlmClient } from '@/lib/llm/types';
import type { StartGameOptions } from '@/lib/game/bootstrap';

// 路由的 201 分支会真的建一局；这里把 startGame 包一层，强制塞进假模型，
// 保证测试永远不发真实外网请求，同时还能断言解析后的配置确实传到了 bootstrap。
const { fakeLlm } = vi.hoisted(() => {
  function fakeLlm(): LlmClient {
    return {
      provider: 'zhipu',
      model: 'glm-4-flash',
      async complete(messages) {
        const prompt = messages[messages.length - 1].content;
        const text = prompt.includes('"speech"')
          ? '{"speech":"一种常见的日常事物"}'
          : `{"vote":${Number(prompt.match(/可投的座位号：(\d+)/)?.[1] ?? 0)},"reason":"先投票再说"}`;
        return {
          text,
          usage: {
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
            cacheHitTokens: 64,
            cacheMissTokens: 36,
            usageReported: true,
            cacheReported: true,
          },
        };
      },
    };
  }
  return { fakeLlm };
});

vi.mock('@/lib/game/bootstrap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/game/bootstrap')>();
  return {
    ...actual,
    startGame: vi.fn((options: StartGameOptions = {}) =>
      actual.startGame({ ...options, llm: options.llm ?? fakeLlm() }),
    ),
  };
});

const { POST } = await import('@/app/api/games/route');
const { GET: getEvents } = await import('@/app/api/games/[gameId]/events/route');
const { GET: getReveal } = await import('@/app/api/games/[gameId]/reveal/route');
const { startGame } = await import('@/lib/game/bootstrap');

function postRequest(body: unknown, raw?: string): Request {
  return new Request('http://localhost/api/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

function params(gameId: string) {
  return { params: Promise.resolve({ gameId }) };
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('响应没有 body');
  }
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(startGame).mockClear();
});

describe('POST /api/games 请求体校验', () => {
  it('缺 apiKey 时返回 400 和可读错误', async () => {
    const response = await POST(postRequest({ provider: 'zhipu', model: 'glm-4-flash' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '缺少 apiKey：请在页面「模型设置」里填入该供应商的 API Key',
    });
    expect(startGame).not.toHaveBeenCalled();
  });

  it('未知 provider 返回 400', async () => {
    const response = await POST(postRequest({ provider: 'openai', apiKey: 'k' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'provider 只能是 zhipu 或 deepseek 或 openrouter',
    });
  });

  it('请求体不是合法 JSON 时返回 400', async () => {
    const response = await POST(postRequest(null, '这不是 JSON'));

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('请求体必须是 JSON 对象');
  });

  it('错误响应里不会回显 API Key', async () => {
    const response = await POST(postRequest({ provider: 'openai', apiKey: 'sk-secret-value' }));

    expect(await response.text()).not.toContain('sk-secret-value');
  });

  it('三项齐全时返回 201 与 gameId，并把配置透传给 startGame', async () => {
    const response = await POST(
      postRequest({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-1' }),
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { gameId: string };
    expect(payload.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(vi.mocked(startGame).mock.calls[0][0]?.llmConfig).toEqual({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'sk-1',
    });
  });

  it('model 留空时按供应商默认模型开局', async () => {
    await POST(postRequest({ provider: 'deepseek', apiKey: 'sk-1' }));

    expect(vi.mocked(startGame).mock.calls[0][0]?.llmConfig?.model).toBe('deepseek-chat');
  });
});

describe('GET /api/games/[gameId]/events', () => {
  it('对局不存在时返回 404', async () => {
    const response = await getEvents(new Request('http://localhost/e'), params('不存在'));
    expect(response.status).toBe(404);
  });

  it('先推 snapshot，再回放事件，终局后关流', async () => {
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');

    const body = await readStream(response);
    expect(body.startsWith('event: snapshot\ndata: ')).toBe(true);
    expect(body).toContain('event: speech\ndata: ');
    expect(body).toContain('event: vote\ndata: ');
    expect(body).toContain('event: result\ndata: ');

    const snapshotLine = body.split('\n\n')[0].split('data: ')[1];
    const snapshot = JSON.parse(snapshotLine) as { seats: unknown[]; bill: unknown };
    expect(snapshot.seats).toHaveLength(4);
    expect(snapshot.bill).toBeNull();
  });

  it('bill 帧排在终局 result 帧之前，关流前一定送达', async () => {
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    const body = await readStream(response);

    const billIndex = body.indexOf('event: bill\ndata: ');
    const finalResultIndex = body.lastIndexOf('event: result\ndata: ');

    expect(billIndex).toBeGreaterThan(-1);
    expect(billIndex).toBeLessThan(finalResultIndex);

    const billFrame = body.slice(billIndex).split('\n\n')[0];
    const bill = JSON.parse(billFrame.split('data: ')[1]) as {
      bill: { estimated: boolean; calls: unknown[] };
    };
    expect(bill.bill.estimated).toBe(true);
    expect(bill.bill.calls.length).toBeGreaterThan(0);
  });
});

describe('GET /api/games/[gameId]/reveal', () => {
  it('未启用上帝视角时返回 403', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'false');
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getReveal(new Request('http://localhost/r'), params(session.gameId));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: '上帝视角未启用：请在 .env.local 设置 ENABLE_GOD_VIEW=true 后重启服务',
    });
  });

  it('启用后返回身份与私有词', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'true');
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getReveal(new Request('http://localhost/r'), params(session.gameId));
    const body = (await response.json()) as { reveal: Array<{ seatId: number; role: string }> };

    expect(response.status).toBe(200);
    expect(body.reveal).toHaveLength(4);
    expect(body.reveal.filter((seat) => seat.role === 'undercover')).toHaveLength(1);
  });

  it('启用后查不到的对局返回 404', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'true');
    const response = await getReveal(new Request('http://localhost/r'), params('不存在'));
    expect(response.status).toBe(404);
  });
});
