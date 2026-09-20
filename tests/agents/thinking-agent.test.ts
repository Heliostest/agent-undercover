import { afterEach, expect, it, vi } from 'vitest';
import { ThinkingAgent, parseBrief, parseDeliberateBrief, parseAdaptiveBrief, THINK_TIMEOUT_MS } from '@/lib/agents/thinking-agent';
import { PERSONAS } from '@/lib/agents/personas';
import type { AgentView } from '@/lib/game/types';
import { LlmResponseError, type LlmClient, type LlmMessage } from '@/lib/llm/types';

afterEach(() => vi.useRealTimers());
const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, cacheHitTokens: 0, cacheMissTokens: 0, usageReported: true, cacheReported: false };
const view: AgentView = { seatId: 0, seatName: '阿岚', word: '铅笔', round: 1, seats: PERSONAS.map((p, id) => ({ id, name: p.name, personaLabel: p.label, alive: true })), aliveOtherIds: [1, 2, 3], log: [{ kind: 'speech', round: 1, seatId: 1, text: '我上学经常忘带。', fallback: false }] };
const brief = { observations: [{ ref: 0, quote: '我上学经常忘带。' }], hypotheses: [{ claim: '同类经历', evidence: [0] }, { claim: '可能不是同一种东西', evidence: [] }], objective: '试探', actionHint: '私人策略标记：换个习惯角度', reconsiderWhen: '出现不兼容的具体细节' };
const deliberate = { ...brief, choices: [{ text: '我出门前老得翻一下包。', benefit: '补充自己的习惯', risk: '辨识度较低', targetSeatId: null, evidence: [] }, { text: '我一般放抽屉里，用的时候伸手拿。', benefit: '另一个真实角度', risk: '信息偏少', targetSeatId: null, evidence: [] }], selected: 0 };
it('uses distinct evidence IDs and requires actual target speech for adaptive votes', () => {
  const adaptive = { ...deliberate, observations: [{ ref: 'L0', quote: '我上学经常忘带。' }], hypotheses: brief.hypotheses.map(h => ({ ...h, evidence: h.evidence.map(n => `L${n}`) })), choices: deliberate.choices.map(c => ({ ...c, targetSeatId: 1, evidence: ['L0'] })) };
  expect(parseAdaptiveBrief(JSON.stringify(adaptive), view, 'vote', [1, 2, 3])?.choices?.[0].evidence).toEqual([0]);
  expect(parseAdaptiveBrief(JSON.stringify({ ...adaptive, choices: adaptive.choices.map(c => ({ ...c, targetSeatId: 3 })) }), view, 'vote', [1, 2, 3])).toBeNull();
  expect(parseAdaptiveBrief(JSON.stringify({ ...adaptive, observations: [{ ref: 0, quote: '我上学经常忘带。' }] }), view, 'vote', [1, 2, 3])).toBeNull();
});
it('validates candidate decisions including vote eligibility and leaked words', () => {
  expect(parseDeliberateBrief(JSON.stringify(deliberate), view, 'speak', [])).toEqual(deliberate);
  expect(parseDeliberateBrief(JSON.stringify({ ...deliberate, selected: 2 }), view, 'speak', [])).toBeNull();
  expect(parseDeliberateBrief(JSON.stringify({ ...deliberate, choices: deliberate.choices.map(c => ({ ...c, text: '铅笔' })) }), view, 'speak', [])).toBeNull();
  expect(parseDeliberateBrief(JSON.stringify({ ...deliberate, choices: deliberate.choices.map(c => ({ ...c, targetSeatId: 0 })) }), view, 'vote', [1, 2, 3])).toBeNull();
});
function client(replies: Array<string | Error>) {
  const complete = vi.fn(async (_m: LlmMessage[]) => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw new Error('unexpected call');
    return { text: reply, usage };
  });
  return { provider: 'deepseek', model: 'test', complete } satisfies LlmClient;
}
it('rejects invented citations and overlong plans, strips unknown fields', () => {
  expect(parseBrief(JSON.stringify(brief), view)).toEqual(brief);
  expect(parseBrief(JSON.stringify({ ...brief, observations: [{ ref: 0, quote: '他改口了' }] }), view)).toBeNull();
  expect(parseBrief(JSON.stringify({ ...brief, hypotheses: [{ claim: '猜测', evidence: [99] }, brief.hypotheses[1]] }), view)).toBeNull();
  expect(parseBrief(JSON.stringify({ ...brief, actionHint: 'x'.repeat(201) }), view)).toBeNull();
  expect(parseBrief(JSON.stringify({ ...brief, secret: 'ignored' }), view)).toEqual(brief);
});
it('carries actual actions into private memory without sharing it with another agent', async () => {
  const llm = client([JSON.stringify(brief), '{"speech":"我出门前老得翻一下包，怕又落下。"}', JSON.stringify(brief), '{"vote":1,"reason":"先猜他吧，还想听他多说点。"}', JSON.stringify(brief), '{"speech":"我一般顺手放包里。"}']);
  const agent = new ThinkingAgent(PERSONAS[0], { llm, seatId: 0 }, 'evidence');
  const result = await agent.speak(view);
  await agent.vote(view, [1, 2, 3], () => 0);
  await new ThinkingAgent(PERSONAS[0], { llm, seatId: 0 }, 'evidence').speak(view);
  const planner2 = JSON.stringify(llm.complete.mock.calls[2][0]);
  expect(planner2).toContain(result.text);
  expect(JSON.stringify(llm.complete.mock.calls[4][0])).not.toContain(result.text);
  expect(JSON.stringify(result)).not.toContain('私人策略');
  expect(JSON.stringify(llm.complete.mock.calls[1][0])).toContain('私人策略');
});
it('failed planner falls back, accounts response errors, and actor retries leaks', async () => {
  const llm = client([new LlmResponseError('private provider error', 'truncated', usage), '{"speech":"铅笔很好用"}', '{"speech":"我出门总得翻翻包。"}']);
  const onUsage = vi.fn();
  const onPlan = vi.fn();
  const result = await new ThinkingAgent(PERSONAS[0], { llm, seatId: 0, onUsage, onPlan }, 'evidence').speak(view);
  expect(result.fallback).toBe(false);
  expect(onUsage.mock.calls.map(([v]) => v.phase)).toEqual(['think', 'speak', 'speak']);
  expect(onPlan).toHaveBeenCalledWith('fallback');
});
it('bounds planning even when a client ignores cancellation; late result cannot enter memory or billing', async () => {
  vi.useFakeTimers();
  let finish!: (v: { text: string; usage: typeof usage }) => void;
  const complete = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ text: '{"speech":"我出门总得翻翻包。"}', usage });
  const onUsage = vi.fn();
  const agent = new ThinkingAgent(PERSONAS[0], { llm: { provider: 'deepseek', model: 'test', complete }, seatId: 0, onUsage }, 'evidence');
  const pending = agent.speak(view);
  await vi.advanceTimersByTimeAsync(THINK_TIMEOUT_MS);
  await expect(pending).resolves.toHaveProperty('fallback', false);
  finish({ text: JSON.stringify(brief), usage });
  await Promise.resolve();
  expect(onUsage.mock.calls.map(([v]) => v.phase)).toEqual(['speak']);
});
it('repairs an adaptive plan once and bills both planning responses', async () => {
  const adaptive = { ...deliberate, observations: [{ ref: 'L0', quote: '我上学经常忘带。' }], hypotheses: brief.hypotheses.map(h => ({ ...h, evidence: h.evidence.map(n => `L${n}`) })) };
  const llm = client(['{}', JSON.stringify(adaptive), '{"speech":"我出门前老得翻一下包。"}']);
  const onUsage = vi.fn();
  const onPlan = vi.fn();
  await new ThinkingAgent(PERSONAS[0], { llm, seatId: 0, onUsage, onPlan }, 'adaptive').speak(view);
  expect(onUsage.mock.calls.map(([v]) => v.phase)).toEqual(['think', 'think', 'speak']);
  expect(onPlan).toHaveBeenCalledWith('ok');
  expect(JSON.stringify(llm.complete.mock.calls[1][0])).toContain('上一份结构未通过校验');
});
it('the second adaptive planning request shares the original deadline', async () => {
  vi.useFakeTimers();
  const onPlan = vi.fn();
  const complete = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve({ text: '{}', usage }), 15_000)))
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue({ text: '{"speech":"我出门前老得翻一下包。"}', usage });
  const pending = new ThinkingAgent(PERSONAS[0], { llm: { provider: 'deepseek', model: 'test', complete }, seatId: 0, onPlan }, 'adaptive').speak(view);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(complete).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000);
  await expect(pending).resolves.toHaveProperty('fallback', false);
  expect(complete).toHaveBeenCalledTimes(3);
  expect(onPlan).toHaveBeenCalledWith('fallback');
});
