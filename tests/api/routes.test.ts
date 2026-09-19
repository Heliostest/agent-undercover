import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/games/route';
import { GET as getEvents } from '@/app/api/games/[gameId]/events/route';
import { GET as getReveal } from '@/app/api/games/[gameId]/reveal/route';
import { startGame } from '@/lib/game/bootstrap';
import type { LlmClient } from '@/lib/llm/types';

function fakeLlm(): LlmClient {
  return {
    async complete(messages) {
      const prompt = messages[messages.length - 1].content;
      if (prompt.includes('"speech"')) {
        return '{"speech":"一种常见的日常事物"}';
      }
      const match = prompt.match(/可投的座位号：(\d+)/);
      return `{"vote":${match ? Number(match[1]) : 0},"reason":"先投票再说"}`;
    },
  };
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
});

describe('POST /api/games', () => {
  it('缺少 ZHIPU_API_KEY 时返回 400 和可读错误', async () => {
    vi.stubEnv('ZHIPU_API_KEY', '');

    const response = await POST();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '缺少 ZHIPU_API_KEY：请在 .env.local 里配置智谱 API Key 后重启服务',
    });
  });
});

describe('GET /api/games/[gameId]/events', () => {
  it('对局不存在时返回 404', async () => {
    const response = await getEvents(new Request('http://localhost/e'), params('不存在'));
    expect(response.status).toBe(404);
  });

  it('先推 snapshot，再回放事件，终局后关流', async () => {
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
    await session.completion;

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');

    const body = await readStream(response);
    expect(body.startsWith('event: snapshot\ndata: ')).toBe(true);
    expect(body).toContain('event: speech\ndata: ');
    expect(body).toContain('event: vote\ndata: ');
    expect(body).toContain('event: result\ndata: ');

    const snapshotLine = body.split('\n\n')[0].split('data: ')[1];
    const snapshot = JSON.parse(snapshotLine) as { seats: unknown[] };
    expect(snapshot.seats).toHaveLength(4);
  });
});

describe('GET /api/games/[gameId]/reveal', () => {
  it('未启用上帝视角时返回 403', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'false');
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
    await session.completion;

    const response = await getReveal(new Request('http://localhost/r'), params(session.gameId));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: '上帝视角未启用：请在 .env.local 设置 ENABLE_GOD_VIEW=true 后重启服务',
    });
  });

  it('启用后返回身份与私有词', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'true');
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
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
