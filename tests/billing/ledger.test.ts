import { describe, expect, it } from 'vitest';

import { UsageLedger, type UsageRecordInput } from '@/lib/billing/ledger';
import type { LlmUsage } from '@/lib/llm/types';

const USAGE: LlmUsage = {
  promptTokens: 100,
  completionTokens: 20,
  totalTokens: 120,
  cacheHitTokens: 64,
  cacheMissTokens: 36,
  usageReported: true,
  cacheReported: true,
};

function input(seatId: number, phase: UsageRecordInput['phase'] = 'speak'): UsageRecordInput {
  return { seatId, phase, provider: 'deepseek', model: 'deepseek-chat', usage: USAGE };
}

describe('UsageLedger', () => {
  it('append 把 usage 摊平成一条带时间戳的记录', () => {
    let clock = 1_700_000_000_000;
    const ledger = new UsageLedger(() => clock);

    const record = ledger.append(input(2, 'vote'));

    expect(record).toEqual({
      callId: expect.any(String),
      at: 1_700_000_000_000,
      seatId: 2,
      phase: 'vote',
      provider: 'deepseek',
      model: 'deepseek-chat',
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheHitTokens: 64,
      cacheMissTokens: 36,
      usageReported: true,
      cacheReported: true,
    });
    clock += 1;
    expect(ledger.append(input(2)).at).toBe(1_700_000_000_001);
  });

  it('按追加顺序保存，size 同步增长', () => {
    const ledger = new UsageLedger(() => 0);
    ledger.append(input(0));
    ledger.append(input(3, 'vote'));
    ledger.append(input(1));

    expect(ledger.size).toBe(3);
    expect(ledger.records().map((record) => record.seatId)).toEqual([0, 3, 1]);
    expect(ledger.records().map((record) => record.phase)).toEqual(['speak', 'vote', 'speak']);
  });

  it('records() 返回快照，外部改它不影响账本', () => {
    const ledger = new UsageLedger(() => 0);
    ledger.append(input(0));

    const snapshot = ledger.records();
    snapshot.pop();

    expect(ledger.size).toBe(1);
    expect(ledger.records()).toHaveLength(1);
  });

  it('空账本的快照是空数组', () => {
    expect(new UsageLedger(() => 0).records()).toEqual([]);
  });

  it('sink() 给出可直接交给 agent 的回调', () => {
    const ledger = new UsageLedger(() => 7);
    const sink = ledger.sink();

    sink(input(1));

    expect(ledger.records()).toEqual([
      expect.objectContaining({ at: 7, seatId: 1, provider: 'deepseek' }),
    ]);
  });

  it('未上报 usage 的调用也照样记一条，只是 token 全 0', () => {
    const ledger = new UsageLedger(() => 0);
    ledger.append({
      seatId: 0,
      phase: 'speak',
      provider: 'zhipu',
      model: 'glm-4-flash',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        usageReported: false,
        cacheReported: false,
      },
    });

    expect(ledger.records()[0]).toMatchObject({ usageReported: false, cacheReported: false });
    expect(ledger.size).toBe(1);
  });

  it('append 为每条记录生成唯一 callId', () => {
    let n = 0;
    const ledger = new UsageLedger(
      () => 0,
      () => `call-${++n}`,
    );
    const a = ledger.append(input(0));
    const b = ledger.append(input(1));
    expect(a.callId).toBe('call-1');
    expect(b.callId).toBe('call-2');
    expect(ledger.records().map((r) => r.callId)).toEqual(['call-1', 'call-2']);
  });

  it('默认 idFactory 每次都不同（非空字符串）', () => {
    const ledger = new UsageLedger(() => 0);
    const a = ledger.append(input(0));
    const b = ledger.append(input(1));
    expect(a.callId.length).toBeGreaterThan(0);
    expect(b.callId.length).toBeGreaterThan(0);
    expect(a.callId).not.toBe(b.callId);
  });
});
