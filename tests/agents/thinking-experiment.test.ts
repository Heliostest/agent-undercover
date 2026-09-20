import { expect, it, vi } from 'vitest';
import { runExperiment, parseScores, blindOrder, experimentManifest, GRADER_PROMPT } from '@/lib/experiments/runner';
import { PERSONAS } from '@/lib/agents/personas';
import { CASES } from '@/lib/experiments/cases';
import type { LlmClient } from '@/lib/llm/types';
import { LlmError } from '@/lib/llm/types';

it('balances blind presentation, keeps holdout disjoint, and rejects bad scores', () => {
  expect(blindOrder(0)).toEqual([0, 1]);
  expect(blindOrder(1)).toEqual([1, 0]);
  expect(blindOrder(6, 1)).toEqual([1, 0]);
  expect(CASES.filter((c) => c.split === 'train')).toHaveLength(4);
  expect(CASES.filter((c) => c.split === 'holdout')).toHaveLength(2);
  expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  expect(parseScores('{"A":{"grounded":99},"B":{}}')).toBeNull();
});
it('fingerprint input changes when the actual persona prompt changes', () => {
  const before = JSON.stringify(experimentManifest());
  const original = PERSONAS[0].systemPrompt;
  try {
    PERSONAS[0].systemPrompt += '额外行为约束';
    expect(JSON.stringify(experimentManifest())).not.toBe(before);
  } finally { PERSONAS[0].systemPrompt = original; }
});
it('retains every failed action without exposing provider errors or keys', async () => {
  const complete = vi.fn(async () => { throw new LlmError('sk-SECRET provider body', 401); });
  const llm: LlmClient = { provider: 'deepseek', model: 'test', complete };
  const report = await runExperiment(llm, { caseIds: [CASES[0].id], strategies: ['baseline', 'evidence'], repetitions: 1 });
  expect(report.rows).toHaveLength(6);
  expect(report.rows.every((r) => r.valid === false)).toBe(true);
  expect(JSON.stringify(report)).not.toContain('sk-SECRET');
  expect(report.calls.length).toBeGreaterThan(0);
  expect(report.status).toBe('complete');
});
it('keeps judge failures separate from action validity and swaps positions for each repeated case', async () => {
  const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, cacheHitTokens: 0, cacheMissTokens: 0, usageReported: true, cacheReported: false };
  const llm: LlmClient = { provider: 'deepseek', model: 'test', async complete(messages) {
    if (messages[0].content === GRADER_PROMPT) {
      expect(messages[1].content).not.toMatch(/baseline|evidence|deliberate/);
      return { text: 'invalid evaluator response', usage };
    }
    const speech = messages.some((m) => m.content.includes('轮发言'));
    return { text: speech ? '{"speech":"我老是出门前翻一遍包。"}' : '{"vote":1,"reason":"先猜他吧，暂时没看太明白。"}', usage };
  } };
  const report = await runExperiment(llm, { caseIds: [CASES[0].id], strategies: ['baseline', 'baseline'], repetitions: 2 });
  expect(report.rows.every((r) => r.valid && r.scores === null)).toBe(true);
  expect(report.judgeFailures).toBe(6);
  expect(report.rows[0].judgePosition).not.toBe(report.rows[6].judgePosition);
  expect(report.calls.every((c) => c.usage?.totalTokens === 15)).toBe(true);
});
