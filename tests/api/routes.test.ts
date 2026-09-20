import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LlmClient } from '@/lib/llm/types';
import type { StartGameOptions } from '@/lib/game/bootstrap';

// 路由的 201 分支会真的建一局；这里把 startGame 包一层，强制塞进假模型，
// 保证测试永远不发真实外网请求，同时还能断言解析后的配置确实传到了 bootstrap。
const { fakeLlm, FAKE_THOUGHT } = vi.hoisted(() => {
  /** 只出现在内心独白里的暗号：用它断言 thought 没有漏进任何公开通道。 */
  const FAKE_THOUGHT = '内心暗号-CANARY';
  function fakeLlm(): LlmClient {
    return {
      provider: 'zhipu',
      model: 'glm-4-flash',
      async complete(messages) {
        const prompt = messages[messages.length - 1].content;
        const text = prompt.includes('可投的座位号')
          ? `{"thought":"${FAKE_THOUGHT}","vote":${Number(
              prompt.match(/可投的座位号：(\d+)/)?.[1] ?? 0,
            )},"reason":"先投票再说"}`
          : `{"thought":"${FAKE_THOUGHT}","speech":"一种常见的日常事物"}`;
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
  return { fakeLlm, FAKE_THOUGHT };
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
      error: 'provider 只能是 zhipu 或 deepseek 或 openrouter 或 omniroute',
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

  it('omniroute 允许空 apiKey 开局', async () => {
    const response = await POST(
      postRequest({ provider: 'omniroute', model: 'm1', apiKey: '' }),
    );
    expect(response.status).toBe(201);
    expect(vi.mocked(startGame).mock.calls[0][0]?.llmConfig).toEqual({
      provider: 'omniroute',
      model: 'm1',
      apiKey: '',
    });
  });

  it('omniroute 缺 apiKey 字段也可开局', async () => {
    const response = await POST(postRequest({ provider: 'omniroute', model: 'm1' }));
    expect(response.status).toBe(201);
  });
});

describe('GET /api/games/[gameId]/events', () => {
  it('对局不存在时返回 404', async () => {
    const response = await getEvents(new Request('http://localhost/e'), params('不存在'));
    expect(response.status).toBe(404);
  });

  it('开局就接入时先推 snapshot，再按序推后续事件，终局后关流', async () => {
    const session = startGame({ rng: () => 0 });

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');

    const body = await readStream(response);
    await session.completion;

    expect(body.startsWith('event: snapshot\ndata: ')).toBe(true);
    expect(body).toContain('event: speech\ndata: ');
    expect(body).toContain('event: vote\ndata: ');
    expect(body).toContain('event: result\ndata: ');

    const snapshotLine = body.split('\n\n')[0].split('data: ')[1];
    const snapshot = JSON.parse(snapshotLine) as { seats: unknown[]; bill: unknown; log: unknown[] };
    expect(snapshot.seats).toHaveLength(4);
    expect(snapshot.log).toEqual([]);
    expect(snapshot.bill).toBeNull();
  });

  it('终局后再接入只拿 snapshot，不重放已在 snapshot 里的事件', async () => {
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    const body = await readStream(response);

    const snapshotLine = body.split('\n\n')[0].split('data: ')[1];
    const snapshot = JSON.parse(snapshotLine) as { log: unknown[]; winner: string | null; bill: unknown };
    expect(snapshot.log.length).toBeGreaterThan(0);
    expect(snapshot.winner).not.toBeNull();
    // 重连时日志已经在 snapshot 里，再回放一遍就会把日志刷成两份。
    expect(body).not.toContain('event: speech\ndata: ');
    expect(body).not.toContain('event: vote\ndata: ');
    expect(body).not.toContain('event: result\ndata: ');
    // 账单不进 GameState，重连时得靠 snapshot 把它带上，否则刷新后账单就没了。
    expect(snapshot.bill).not.toBeNull();
  });

  it('重连快照带上水位线之前的 usage，且不再回放 usage 帧', async () => {
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    const body = await readStream(response);

    const snapshotLine = body.split('\n\n')[0].split('data: ')[1];
    const snapshot = JSON.parse(snapshotLine) as { usageLog: Array<{ callId: string }> };
    const published = session.events.filter((event) => event.type === 'usage');

    // usage 同样不进 GameState：不补进快照，刷新后已花掉的 token 就查不到了。
    expect(published.length).toBeGreaterThan(0);
    expect(snapshot.usageLog.map((row) => row.callId)).toEqual(
      published.map((event) => event.callId),
    );
    expect(body).not.toContain('event: usage\ndata: ');
  });

  it('phase:result 帧排在终局 result 帧之前，顶栏不会停在投票轮', async () => {
    const session = startGame({ rng: () => 0 });

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    const body = await readStream(response);
    await session.completion;

    const phaseResultIndex = body.indexOf('event: phase\ndata: {"type":"phase","phase":"result"');
    const finalResultIndex = body.lastIndexOf('event: result\ndata: ');

    expect(phaseResultIndex).toBeGreaterThan(-1);
    expect(phaseResultIndex).toBeLessThan(finalResultIndex);
  });

  it('投票期间逐个推送 activeSeatId 帧，前端能跟着高亮', async () => {
    const session = startGame({ rng: () => 0 });

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    const body = await readStream(response);
    await session.completion;

    const activeVoters = body
      .split('\n\n')
      .filter((frame) => frame.startsWith('event: phase\ndata: {"type":"phase","phase":"vote"'))
      .map((frame) => (JSON.parse(frame.split('data: ')[1]) as { activeSeatId: number | null }).activeSeatId);

    expect(activeVoters.filter((seatId) => seatId !== null).length).toBeGreaterThan(0);
  });

  it('整条事件流（含快照）里不含任何内心独白', async () => {
    const session = startGame({ rng: () => 0 });

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    const body = await readStream(response);
    await session.completion;

    expect(body).toContain('event: speech\ndata: ');
    expect(body).not.toContain(FAKE_THOUGHT);
    expect(body).not.toContain('thought');
  });

  it('终局后重连的快照同样不含内心独白', async () => {
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    const body = await readStream(response);

    expect(body).not.toContain(FAKE_THOUGHT);
    expect(body).not.toContain('thought');
  });

  it('bill 帧排在终局 result 帧之前，关流前一定送达', async () => {
    const session = startGame({ rng: () => 0 });

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    const body = await readStream(response);
    await session.completion;

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

  it('上帝视角的日志带上内心独白，供 GodPanel 展示', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'true');
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getReveal(new Request('http://localhost/r'), params(session.gameId));
    const body = (await response.json()) as {
      log: Array<{ kind: string; thought?: string }>;
    };

    const speeches = body.log.filter((entry) => entry.kind === 'speech');
    const votes = body.log.filter((entry) => entry.kind === 'vote');
    expect(speeches.length).toBeGreaterThan(0);
    expect(votes.length).toBeGreaterThan(0);
    expect(speeches.every((entry) => entry.thought === FAKE_THOUGHT)).toBe(true);
    expect(votes.every((entry) => entry.thought === FAKE_THOUGHT)).toBe(true);
  });

  it('启用后查不到的对局返回 404', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'true');
    const response = await getReveal(new Request('http://localhost/r'), params('不存在'));
    expect(response.status).toBe(404);
  });
});
