import { afterEach, describe, expect, it, vi } from 'vitest';

import { PERSONAS } from '@/lib/agents/personas';
import {
  AGENT_MAX_ATTEMPTS,
  FALLBACK_VOTE_REASON,
  PlayerAgent,
  SPEECH_MAX_ATTEMPTS,
  SPEECH_TIMEOUT_MS,
  speechRetryDelayMs,
  VOTE_TIMEOUT_MS,
} from '@/lib/agents/player-agent';
import { DEFAULT_TIMEOUT_MS } from '@/lib/llm/openai-compatible';
import type { UsageRecordInput } from '@/lib/billing/ledger';
import type { AgentView } from '@/lib/game/types';
import type { LlmClient, LlmUsage } from '@/lib/llm/types';
import { LlmError } from '@/lib/llm/types';

afterEach(() => vi.useRealTimers());

const VIEW: AgentView = {
  seatId: 2,
  seatName: '雷子',
  word: '豆浆',
  round: 1,
  seats: [
    { id: 0, name: '阿岚', personaLabel: '谨慎分析', alive: true },
    { id: 1, name: '小柯', personaLabel: '幽默带节奏', alive: true },
    { id: 2, name: '雷子', personaLabel: '激进带节奏', alive: true },
    { id: 3, name: '沉舟', personaLabel: '少话观察', alive: true },
  ],
  log: [],
  aliveOtherIds: [0, 1, 3],
};

const SAMPLE_USAGE: LlmUsage = {
  promptTokens: 120,
  completionTokens: 30,
  totalTokens: 150,
  cacheHitTokens: 64,
  cacheMissTokens: 56,
  usageReported: true,
  cacheReported: true,
};

function scriptedLlm(
  replies: Array<string | Error>,
  usage: LlmUsage = SAMPLE_USAGE,
): LlmClient & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async () => {
    const next = replies.shift();
    if (next === undefined) {
      throw new Error('脚本用尽：不应该再调用模型');
    }
    if (next instanceof Error) {
      throw next;
    }
    return { text: next, usage };
  });
  return { provider: 'zhipu', model: 'glm-4-flash', complete } as unknown as LlmClient & {
    complete: ReturnType<typeof vi.fn>;
  };
}

describe('重试次数与时限的预算', () => {
  /** 最坏情况：每次尝试都耗满单请求时限，中间还要退避。 */
  function worstCaseMs(attempts: number, delay: (attempt: number) => number): number {
    let total = 0;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      total += DEFAULT_TIMEOUT_MS;
      if (attempt < attempts) {
        total += delay(attempt);
      }
    }
    return total;
  }

  it('发言的最后一次尝试要能在 90 秒内真的发出去', () => {
    expect(worstCaseMs(SPEECH_MAX_ATTEMPTS, speechRetryDelayMs)).toBeLessThanOrEqual(
      SPEECH_TIMEOUT_MS,
    );
  });

  it('投票的最后一次尝试要能在 60 秒内真的发出去', () => {
    expect(worstCaseMs(AGENT_MAX_ATTEMPTS, () => 0)).toBeLessThanOrEqual(VOTE_TIMEOUT_MS);
  });
});

describe('PlayerAgent.speak', () => {
  it('第一次就合格时直接返回，只调用一次模型', async () => {
    const llm = scriptedLlm(['{"thought":"我拿的是豆浆","speech":"早上常喝的白色饮品"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早上常喝的白色饮品',
      thought: '我拿的是豆浆',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('内心独白里出现自己的词不算泄露，一次就通过', async () => {
    const llm = scriptedLlm(['{"thought":"我拿的是豆浆，别说出来","speech":"早上常喝的白色饮品"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早上常喝的白色饮品',
      thought: '我拿的是豆浆，别说出来',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('首次输出念出词面时重试一次并采用第二次结果', async () => {
    const llm = scriptedLlm(['{"speech":"我的词就是豆浆"}', '{"speech":"早上常喝的白色饮品"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早上常喝的白色饮品',
      thought: '',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('尝试次数用尽仍不合格时明确报错，不把空发言交给后续玩家', async () => {
    const llm = scriptedLlm(Array(SPEECH_MAX_ATTEMPTS).fill('乱七八糟'));
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.speak(VIEW)).rejects.toThrow(`${SPEECH_MAX_ATTEMPTS} 次`);
    expect(llm.complete).toHaveBeenCalledTimes(SPEECH_MAX_ATTEMPTS);
  });

  it('模型连续抛错时有限退避后报错，不泄露原始异常', async () => {
    vi.useFakeTimers();
    const llm = scriptedLlm(Array(SPEECH_MAX_ATTEMPTS).fill(new Error('secret-key 网络炸了')));
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    const result = agent.speak(VIEW).catch((error: Error) => error.message);
    await vi.runAllTimersAsync();
    expect(await result).toContain(`${SPEECH_MAX_ATTEMPTS} 次`);
    expect(await result).not.toContain('secret-key');
    expect(llm.complete).toHaveBeenCalledTimes(SPEECH_MAX_ATTEMPTS);
  });

  it('第三次才合格也能成功，纠正反馈指出格式与泄词错误', async () => {
    const requests: string[] = [];
    const replies = ['不是 JSON', '{"speech":"豆浆很好喝"}', '{"speech":"早餐常见的白色饮品"}'];
    const llm: LlmClient = {
      provider: 'zhipu', model: 'glm-4-flash',
      async complete(messages) {
        requests.push(messages.at(-1)!.content);
        return { text: replies.shift()!, usage: SAMPLE_USAGE };
      },
    };
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });
    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早餐常见的白色饮品', thought: '', fallback: false,
    });
    expect(requests).toHaveLength(3);
    expect(requests[1]).toContain('JSON');
    expect(requests[2]).toContain('词面');
    // 纠正提示同样要把两个字段都要回来，否则重试的回答会掉 thought。
    expect(requests[1]).toContain('"thought"');
    expect(requests[2]).toContain('"thought"');
  });

  it('最后一次才成功也算数，成功后立刻停止重试', async () => {
    const llm = scriptedLlm([
      ...Array(SPEECH_MAX_ATTEMPTS - 1).fill('格式错误'),
      '{"speech":"白色饮品"}',
    ]);
    await expect(new PlayerAgent(PERSONAS[2], { llm, seatId: 2 }).speak(VIEW))
      .resolves.toEqual({ text: '白色饮品', thought: '', fallback: false });
    expect(llm.complete).toHaveBeenCalledTimes(SPEECH_MAX_ATTEMPTS);
  });

  it('401 不重复请求，给出可操作错误且不泄露供应商原文', async () => {
    const llm = scriptedLlm([new LlmError('secret-key', 401)]);
    const result = await new PlayerAgent(PERSONAS[2], { llm, seatId: 2 }).speak(VIEW)
      .catch((error: Error) => error.message);
    expect(result).toContain('API Key');
    expect(result).not.toContain('secret-key');
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('整局取消信号会连带取消发言请求', async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const complete = vi.fn<LlmClient['complete']>(async (_messages, options) => {
      signal = options?.signal;
      controller.abort();
      return new Promise(() => {});
    });
    const llm: LlmClient = { provider: 'deepseek', model: 'deepseek-flash', complete };

    await expect(
      new PlayerAgent(PERSONAS[2], { llm, seatId: 2 }).speak(VIEW, controller.signal),
    ).rejects.toThrow();
    expect(signal?.aborted).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('90 秒到期会取消请求并停止重试，即使模型客户端不响应取消', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const complete = vi.fn<LlmClient['complete']>(async (_messages, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    });
    const llm: LlmClient = { provider: 'deepseek', model: 'deepseek-flash', complete };
    const result = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 }).speak(VIEW)
      .catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await result).toContain('90 秒');
    expect(signal?.aborted).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PlayerAgent.vote', () => {
  it('投票理由直接报出自己的词时要求重写，只发布不泄词的结果', async () => {
    const requests: string[] = [];
    const replies = ['{"vote":1,"reason":"他说的和豆浆不同"}', '{"vote":1,"reason":"他刚才那句跟我想的有点岔"}'];
    const llm: LlmClient = {
      provider: 'zhipu', model: 'glm-4-flash',
      async complete(messages) {
        requests.push(messages.at(-1)!.content);
        return { text: replies.shift()!, usage: SAMPLE_USAGE };
      },
    };
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });
    await expect(agent.vote(VIEW, [0, 1, 3], () => 0)).resolves.toEqual({
      targetSeatId: 1, reason: '他刚才那句跟我想的有点岔', thought: '', fallback: false,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain('词面');
    expect(requests[1]).toContain('"thought"');
  });

  it('投票重写后仍然泄词时不公开原话', async () => {
    const llm = scriptedLlm(Array(2).fill('{"vote":1,"reason":"我的词是豆浆"}'));
    const result = await new PlayerAgent(PERSONAS[2], { llm, seatId: 2 }).vote(VIEW, [0, 1, 3], () => 0);
    expect(result.fallback).toBe(true);
    expect(result.reason).not.toContain('豆浆');
    expect([0, 1, 3]).toContain(result.targetSeatId);
  });

  it('合法投票直接返回', async () => {
    const llm = scriptedLlm(['{"thought":"他跟我的词对不上","vote":1,"reason":"描述太笼统"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.vote(VIEW, [0, 1, 3], () => 0)).resolves.toEqual({
      targetSeatId: 1,
      reason: '描述太笼统',
      thought: '他跟我的词对不上',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('投了非候选座位时重试一次', async () => {
    const llm = scriptedLlm(['{"vote":2,"reason":"投自己"}', '{"vote":3,"reason":"他太安静"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.vote(VIEW, [0, 1, 3], () => 0)).resolves.toEqual({
      targetSeatId: 3,
      reason: '他太安静',
      thought: '',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('两次都不合格时按 rng 随机投一个合法候选', async () => {
    const llm = scriptedLlm(['不是 JSON', '还是不是 JSON']);
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.vote(VIEW, [0, 1, 3], () => 0.99)).resolves.toEqual({
      targetSeatId: 3,
      reason: FALLBACK_VOTE_REASON,
      // 兜底票没有真实的内心活动可展示，留空字符串而不是编一段。
      thought: '',
      fallback: true,
    });
  });

  it('投票同样关闭客户端内重试，重试预算由这一层独占', async () => {
    const complete = vi.fn<LlmClient['complete']>(async () => ({
      text: '{"vote":1,"reason":"描述太笼统"}',
      usage: SAMPLE_USAGE,
    }));
    const llm: LlmClient = { provider: 'zhipu', model: 'glm-4-flash', complete };

    await new PlayerAgent(PERSONAS[2], { llm, seatId: 2 }).vote(VIEW, [0, 1, 3], () => 0);

    expect(complete.mock.calls[0][1]?.maxRetries).toBe(0);
    expect(complete.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('投票等待到期会取消请求并抛错，不会无声地拖满整局时间', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const complete = vi.fn<LlmClient['complete']>(async (_messages, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    });
    const llm: LlmClient = { provider: 'deepseek', model: 'deepseek-flash', complete };

    const result = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 })
      .vote(VIEW, [0, 1, 3], () => 0)
      .catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(VOTE_TIMEOUT_MS);

    expect(await result).toContain('60 秒');
    expect(signal?.aborted).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('整局取消信号会连带取消投票请求，并且不再重试', async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const complete = vi.fn<LlmClient['complete']>(async (_messages, options) => {
      signal = options?.signal;
      controller.abort();
      return new Promise(() => {});
    });
    const llm: LlmClient = { provider: 'deepseek', model: 'deepseek-flash', complete };

    await expect(
      new PlayerAgent(PERSONAS[2], { llm, seatId: 2 }).vote(VIEW, [0, 1, 3], () => 0, controller.signal),
    ).rejects.toThrow();
    expect(signal?.aborted).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('候选为空时抛错（Judge 不应该这样调用）', async () => {
    const llm = scriptedLlm(['不是 JSON', '还是不是 JSON']);
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.vote(VIEW, [], () => 0)).rejects.toThrow('无法从空列表中随机选取');
  });
});

describe('PlayerAgent 用量上报', () => {
  it('发言成功时上报一条 speak 用量，带座位、供应商、模型与缓存字段', async () => {
    const llm = scriptedLlm(['{"speech":"早上常喝的白色饮品"}']);
    const reported: UsageRecordInput[] = [];
    const agent = new PlayerAgent(PERSONAS[2], {
      llm,
      seatId: 2,
      onUsage: (input) => reported.push(input),
    });

    await agent.speak(VIEW);

    expect(reported).toEqual([
      {
        seatId: 2,
        phase: 'speak',
        provider: 'zhipu',
        model: 'glm-4-flash',
        usage: SAMPLE_USAGE,
      },
    ]);
  });

  it('重试导致的多次调用会各记一笔', async () => {
    const llm = scriptedLlm(['{"speech":"我的词就是豆浆"}', '{"speech":"早上常喝的白色饮品"}']);
    const reported: UsageRecordInput[] = [];
    const agent = new PlayerAgent(PERSONAS[2], {
      llm,
      seatId: 2,
      onUsage: (input) => reported.push(input),
    });

    await agent.speak(VIEW);

    expect(reported).toHaveLength(2);
    expect(reported.every((input) => input.phase === 'speak')).toBe(true);
  });

  it('投票阶段上报 phase 为 vote', async () => {
    const llm = scriptedLlm(['{"vote":0,"reason":"他说得太稳了"}']);
    const reported: UsageRecordInput[] = [];
    const agent = new PlayerAgent(PERSONAS[2], {
      llm,
      seatId: 2,
      onUsage: (input) => reported.push(input),
    });

    await agent.vote(VIEW, [0, 1, 3], () => 0);

    expect(reported.map((input) => input.phase)).toEqual(['vote']);
  });

  it('调用抛错时不上报（没拿到响应就没有 usage）', async () => {
    vi.useFakeTimers();
    const llm = scriptedLlm(Array(SPEECH_MAX_ATTEMPTS).fill(new Error('socket hang up')));
    const reported: UsageRecordInput[] = [];
    const agent = new PlayerAgent(PERSONAS[2], {
      llm,
      seatId: 2,
      onUsage: (input) => reported.push(input),
    });

    const result = agent.speak(VIEW).catch((error: Error) => error.message);
    await vi.runAllTimersAsync();
    expect(await result).toContain(`${SPEECH_MAX_ATTEMPTS} 次`);
    expect(reported).toEqual([]);
  });

  it('没传 onUsage 时照常工作，不抛错', async () => {
    const llm = scriptedLlm(['{"speech":"早上常喝的白色饮品"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早上常喝的白色饮品',
      thought: '',
      fallback: false,
    });
  });
});
