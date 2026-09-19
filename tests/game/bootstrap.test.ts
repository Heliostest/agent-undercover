import { describe, expect, it } from 'vitest';

import { startGame } from '@/lib/game/bootstrap';
import { getSession } from '@/lib/game/registry';
import { MissingApiKeyError } from '@/lib/llm/zhipu';
import type { LlmClient } from '@/lib/llm/types';

/** 永远给出合法发言与合法投票（总投候选里的第一个）的假模型，并固定上报一份 usage。 */
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

describe('startGame', () => {
  it('缺少 ZHIPU_API_KEY 时抛 MissingApiKeyError，且不建局', () => {
    expect(() => startGame({ env: {} })).toThrow(MissingApiKeyError);
  });

  it('注入 mock 模型时能跑完整局并把 session 注册进 registry', async () => {
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });

    expect(getSession(session.gameId)).toBe(session);
    await session.completion;

    expect(session.finished).toBe(true);
    expect(session.state.winner).not.toBeNull();
    expect(session.events.at(-1)?.type).toBe('phase');
    expect(session.events.some((event) => event.type === 'speech')).toBe(true);
    expect(session.events.some((event) => event.type === 'vote')).toBe(true);
  });

  it('座位配置为 4 人 3 平民 1 卧底，并使用内置人设', async () => {
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
    await session.completion;

    expect(session.state.seats).toHaveLength(4);
    expect(session.state.seats.filter((seat) => seat.role === 'undercover')).toHaveLength(1);
    expect(session.state.seats.map((seat) => seat.personaId)).toEqual([
      'analyst',
      'joker',
      'striker',
      'watcher',
    ]);
  });

  it('gameId 是 uuid，且每局互不相同', async () => {
    const first = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
    const second = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
    await Promise.all([first.completion, second.completion]);

    expect(first.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.gameId).not.toBe(second.gameId);
  });
});
