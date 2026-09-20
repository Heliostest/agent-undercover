import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerAgent } from '@/lib/agents/player-agent';
import { PERSONAS } from '@/lib/agents/personas';
import { createDeepseekClient } from '@/lib/llm/deepseek';
import { createZhipuClient } from '@/lib/llm/zhipu';
import { startGame } from '@/lib/game/bootstrap';
import type { AgentView } from '@/lib/game/types';
import type { UsageRecordInput } from '@/lib/billing/ledger';

afterEach(() => vi.useRealTimers());

const view: AgentView = {
  seatId: 0, seatName: '阿岚', word: '西瓜', round: 1,
  seats: [{ id: 0, name: '阿岚', personaLabel: '谨慎分析', alive: true }],
  log: [], aliveOtherIds: [1, 2, 3],
};

function reply(content: string, finishReason = 'stop', tokens = 30) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, completion_tokens: tokens, total_tokens: 100 + tokens },
  }));
}

describe('发言恢复（真实 PlayerAgent + 供应商客户端）', () => {
  it('DeepSeek 请求显式关闭思考模式，避免短发言预算被思考耗尽', async () => {
    const requests: Record<string, unknown>[] = [];
    const llm = createDeepseekClient({
      apiKey: 'test-only', model: 'deepseek-flash',
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init!.body as string);
        requests.push(body);
        return reply('{"speech":"夏天冰镇后特别解暑"}');
      },
    });
    const result = await new PlayerAgent(PERSONAS[0], { llm, seatId: 0 }).speak(view);
    expect(result.fallback).toBe(false);
    expect(requests[0].thinking).toEqual({ type: 'disabled' });
    expect(requests[0].max_tokens).toBeGreaterThanOrEqual(1024);
  });

  it('截断和空响应由发言层调整预算后重试，每次已返回的 usage 都记账', async () => {
    const budgets: number[] = [];
    const usage: UsageRecordInput[] = [];
    const llm = createDeepseekClient({
      apiKey: 'test-only', model: 'deepseek-flash',
      fetchImpl: async (_url, init) => {
        budgets.push(JSON.parse(init!.body as string).max_tokens);
        return budgets.length === 1
          ? reply('', 'length', 1024)
          : reply('{"speech":"夏天冰镇后特别解暑"}');
      },
    });
    const result = await new PlayerAgent(PERSONAS[0], { llm, seatId: 0, onUsage: (u) => usage.push(u) }).speak(view);
    expect(result).toEqual({ text: '夏天冰镇后特别解暑', fallback: false });
    expect(budgets).toEqual([1024, 2048]);
    expect(usage.map((u) => u.usage.completionTokens)).toEqual([1024, 30]);
  });

  it('非空但被截断的 JSON 也增加预算，最高不超过 4096', async () => {
    const budgets: number[] = [];
    const llm = createZhipuClient({
      apiKey: 'test-only', model: 'glm-4-flash',
      fetchImpl: async (_url, init) => {
        budgets.push(JSON.parse(init!.body as string).max_tokens);
        return budgets.length < 5 ? reply('{"speech":"', 'length') : reply('{"speech":"夏日水果"}');
      },
    });
    await expect(new PlayerAgent(PERSONAS[0], { llm, seatId: 0 }).speak(view)).resolves.toMatchObject({ fallback: false });
    expect(budgets).toEqual([1024, 2048, 4096, 4096, 4096]);
  });

  it('持续 429 只发五次 HTTP 请求，不与客户端重试相乘；结束时先记账再报错', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const llm = createDeepseekClient({
      apiKey: 'test-secret', model: 'deepseek-flash',
      fetchImpl: async () => { calls++; return new Response('test-secret', { status: 429 }); },
    });
    const session = startGame({ llm, rng: () => 0 });
    await vi.runAllTimersAsync();
    await session.completion;
    expect(calls).toBe(5);
    expect(session.state.phase).toBe('error');
    expect(session.state.errorMessage).toContain('限流');
    expect(session.state.log).toEqual([]);
    expect(session.events.slice(-2).map((e) => e.type)).toEqual(['bill', 'error']);
    expect(JSON.stringify(session.events)).not.toContain('test-secret');
  });

  it('总等待时间到期后取消实际 HTTP 请求，不会继续重试', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let cancellations = 0;
    const llm = createDeepseekClient({
      apiKey: 'test-only', model: 'deepseek-flash', timeoutMs: 120_000,
      fetchImpl: async (_url, init) => {
        calls++;
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => {
            cancellations++;
            reject(new DOMException('cancelled', 'AbortError'));
          }, { once: true });
        });
      },
    });
    const result = new PlayerAgent(PERSONAS[0], { llm, seatId: 0 }).speak(view).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await result).toContain('90 秒');
    expect(calls).toBe(1);
    expect(cancellations).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('限流和临时服务错误后退避恢复，成功后不再请求', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const llm = createDeepseekClient({
      apiKey: 'test-only', model: 'deepseek-flash',
      fetchImpl: async () => {
        times.push(Date.now());
        if (times.length === 1) return new Response('', { status: 429 });
        if (times.length === 2) return new Response('', { status: 503 });
        return reply('{"speech":"夏日水果"}');
      },
    });
    const result = new PlayerAgent(PERSONAS[0], { llm, seatId: 0 }).speak(view);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ text: '夏日水果', fallback: false });
    expect(times.map((t) => t - times[0])).toEqual([0, 500, 1500]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('超过等待时限的迟到回答不会继续重试或写入用量', async () => {
    vi.useFakeTimers();
    const usage: UsageRecordInput[] = [];
    let resolveResponse!: (r: Response) => void;
    let calls = 0;
    const llm = createDeepseekClient({
      apiKey: 'test-only', model: 'deepseek-flash', timeoutMs: 120_000,
      fetchImpl: async () => { calls++; return new Promise((resolve) => { resolveResponse = resolve; }); },
    });
    const result = new PlayerAgent(PERSONAS[0], { llm, seatId: 0, onUsage: (u) => usage.push(u) })
      .speak(view).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await result).toContain('90 秒');
    resolveResponse(reply('{"speech":"夏日水果"}'));
    await vi.runAllTimersAsync();
    expect(calls).toBe(1);
    expect(usage).toEqual([]);
  });
});
