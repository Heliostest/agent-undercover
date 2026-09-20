import { afterEach, describe, expect, it, vi } from 'vitest';

import { BILL_ESTIMATE_NOTE } from '@/lib/billing/estimate';
import { startGame } from '@/lib/game/bootstrap';
import { GAME_ABORTED_MESSAGE } from '@/lib/game/judge';
import { FINISHED_SESSION_TTL_MS, getSession } from '@/lib/game/registry';
import { buildAgentView, toPublicView } from '@/lib/game/state';
import { InvalidLlmConfigError } from '@/lib/llm/create-client';
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

afterEach(() => vi.useRealTimers());

describe('startGame', () => {
  it('连续开局使用共享牌袋，不重复同一词对且题材不进入玩家或公开视角', async () => {
    const games = Array.from({ length: 4 }, () => startGame({ llm: fakeLlm(), rng: () => 0 }));
    await Promise.all(games.map((game) => game.completion));
    const keys = games.map((game) => [...new Set(game.state.seats.map((s) => s.word))].sort().join('/'));
    expect(new Set(keys).size).toBe(4);
    for (const game of games) {
      const view = buildAgentView(game.state, 0);
      expect(view).not.toHaveProperty('category');
      expect(toPublicView(game.state)).not.toHaveProperty('category');
      const otherWord = game.state.seats.find((seat) => seat.word !== view.word)!.word;
      expect(JSON.stringify(view)).not.toContain(otherWord);
    }
  });

  it('既没有 llmConfig 也没有注入 llm 时抛 InvalidLlmConfigError，且不建局', () => {
    expect(() => startGame()).toThrow(InvalidLlmConfigError);
    expect(() => startGame()).toThrow('缺少模型配置');
  });

  it('注入 mock 模型时能跑完整局并把 session 注册进 registry', async () => {
    const session = startGame({ llm: fakeLlm(), rng: () => 0 });

    expect(getSession(session.gameId)).toBe(session);
    await session.completion;

    expect(session.finished).toBe(true);
    expect(session.state.winner).not.toBeNull();
    // 终局 result 必须是最后一条：SSE 一见到它就关流，后面的事件到不了浏览器。
    expect(session.events.at(-1)?.type).toBe('result');
    expect(session.events.some((event) => event.type === 'speech')).toBe(true);
    expect(session.events.some((event) => event.type === 'vote')).toBe(true);
  });

  it('整局取消后停在 error，账单仍排在 error 之前，之后不再有事件', async () => {
    const session = startGame({ llm: fakeLlm(), rng: () => 0 });
    session.abortController.abort();
    await session.completion;

    expect(session.state.phase).toBe('error');
    expect(session.state.errorMessage).toBe(GAME_ABORTED_MESSAGE);
    expect(session.events.slice(-2).map((event) => event.type)).toEqual(['bill', 'error']);
    expect(session.finished).toBe(true);
  });

  it('对局结束后按 TTL 从注册表里清掉，避免内存无限增长', async () => {
    vi.useFakeTimers();
    const session = startGame({ llm: fakeLlm(), rng: () => 0 });
    await session.completion;

    expect(getSession(session.gameId)).toBe(session);
    vi.advanceTimersByTime(FINISHED_SESSION_TTL_MS);
    expect(getSession(session.gameId)).toBeUndefined();
  });

  it('座位配置为 4 人 3 平民 1 卧底，并使用内置人设', async () => {
    const session = startGame({ llm: fakeLlm(), rng: () => 0 });
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
    const first = startGame({ llm: fakeLlm(), rng: () => 0 });
    const second = startGame({ llm: fakeLlm(), rng: () => 0 });
    await Promise.all([first.completion, second.completion]);

    expect(first.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.gameId).not.toBe(second.gameId);
  });

  it('终局事件之前推一条 bill，含每次调用明细与缓存字段', async () => {
    const session = startGame({ llm: fakeLlm(), rng: () => 0 });
    await session.completion;

    const billIndex = session.events.findIndex((event) => event.type === 'bill');
    const terminalIndex = session.events.findIndex(
      (event) => event.type === 'result' && event.winner !== null,
    );

    expect(billIndex).toBeGreaterThan(-1);
    expect(billIndex).toBeLessThan(terminalIndex);

    const billEvent = session.events[billIndex];
    if (billEvent.type !== 'bill') {
      throw new Error('billIndex 指向的不是 bill 事件');
    }
    expect(billEvent.bill.provider).toBe('zhipu');
    expect(billEvent.bill.model).toBe('glm-4-flash');
    expect(billEvent.bill.estimated).toBe(true);
    expect(billEvent.bill.notes[0]).toBe(BILL_ESTIMATE_NOTE);
    expect(billEvent.bill.totals.calls).toBeGreaterThan(0);
    expect(billEvent.bill.calls).toHaveLength(billEvent.bill.totals.calls);
    expect(billEvent.bill.calls.every((call) => call.cacheReported)).toBe(true);
    expect(billEvent.bill.calls.every((call) => call.totalTokens === 120)).toBe(true);
    expect(billEvent.bill.bySeat.map((seat) => seat.seatId)).toEqual([0, 1, 2, 3]);
    expect(billEvent.bill.totals.estimatedCostCny).toBeGreaterThanOrEqual(0);
  });

  it('bill 事件与整局事件流里都不含 API Key', async () => {
    const session = startGame({
      llmConfig: { provider: 'zhipu', model: 'glm-4-flash', apiKey: 'sk-should-not-leak' },
      llm: fakeLlm(),
      rng: () => 0,
    });
    await session.completion;

    expect(JSON.stringify(session.events)).not.toContain('sk-should-not-leak');
  });
});
