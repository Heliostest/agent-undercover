import { describe, expect, it } from 'vitest';

import type { UsageRecord } from '@/lib/billing/ledger';
import {
  BILL_ESTIMATE_NOTE,
  buildBill,
  estimateCallCostCny,
  roundCny,
} from '@/lib/billing/estimate';

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    at: 1_000,
    seatId: 0,
    phase: 'speak',
    provider: 'deepseek',
    model: 'deepseek-chat',
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    cacheHitTokens: 800,
    cacheMissTokens: 200,
    usageReported: true,
    cacheReported: true,
    ...overrides,
  };
}

describe('roundCny', () => {
  it('保留 4 位小数', () => {
    expect(roundCny(0.00123456)).toBe(0.0012);
    expect(roundCny(1.23455)).toBe(1.2346);
    expect(roundCny(0)).toBe(0);
  });
});

describe('estimateCallCostCny', () => {
  it('按 prompt / completion 各自的每 1K 单价计价', () => {
    // deepseek-chat：prompt 0.002、completion 0.008 → 1*0.002 + 0.5*0.008 = 0.006
    expect(estimateCallCostCny(record())).toBeCloseTo(0.006, 10);
  });

  it('未知模型走供应商默认档', () => {
    expect(estimateCallCostCny(record({ model: 'deepseek-v9' }))).toBeCloseTo(0.006, 10);
  });

  it('零 token 的调用费用为 0', () => {
    expect(
      estimateCallCostCny(
        record({ promptTokens: 0, completionTokens: 0, totalTokens: 0, usageReported: false }),
      ),
    ).toBe(0);
  });
});

describe('buildBill', () => {
  it('明细按时间排序，且带上局号与供应商', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 9_999,
      records: [record({ at: 300, seatId: 1 }), record({ at: 100, seatId: 0 })],
    });

    expect(bill.gameId).toBe('g-1');
    expect(bill.provider).toBe('deepseek');
    expect(bill.model).toBe('deepseek-chat');
    expect(bill.finishedAt).toBe(9_999);
    expect(bill.estimated).toBe(true);
    expect(bill.calls.map((call) => call.at)).toEqual([100, 300]);
  });

  it('totals 汇总 token、缓存与估算费用', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [record({ seatId: 0 }), record({ seatId: 1 })],
    });

    expect(bill.totals).toEqual({
      calls: 2,
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
      cacheHitTokens: 1600,
      cacheMissTokens: 400,
      cacheReportedCalls: 2,
      usageMissingCalls: 0,
      estimatedCostCny: 0.012,
    });
  });

  it('bySeat 按座位号升序，每座位有自己的调用数与费用', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [
        record({ seatId: 2, phase: 'vote' }),
        record({ seatId: 0 }),
        record({ seatId: 2 }),
      ],
    });

    expect(bill.bySeat.map((seat) => seat.seatId)).toEqual([0, 2]);
    expect(bill.bySeat[1]).toEqual({
      seatId: 2,
      calls: 2,
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
      cacheHitTokens: 1600,
      cacheMissTokens: 400,
      estimatedCostCny: 0.012,
    });
  });

  it('notes 第一条恒为估算提示', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [record()],
    });

    expect(bill.notes[0]).toBe(BILL_ESTIMATE_NOTE);
    expect(BILL_ESTIMATE_NOTE).toBe('本账单为本地估算，实际费用以供应商官方账单为准。');
  });

  it('未知模型时 notes 说明走了默认档', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-v9',
      finishedAt: 0,
      records: [record({ model: 'deepseek-v9' })],
    });

    expect(bill.notes).toContain('模型 deepseek-v9 不在内置价目表里，已按 DeepSeek 默认档单价估算。');
  });

  it('有调用没返回 usage 时 notes 注明次数', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'zhipu',
      model: 'glm-4-flash',
      finishedAt: 0,
      records: [
        record({ provider: 'zhipu', model: 'glm-4-flash' }),
        record({
          provider: 'zhipu',
          model: 'glm-4-flash',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          usageReported: false,
          cacheReported: false,
        }),
      ],
    });

    expect(bill.totals.usageMissingCalls).toBe(1);
    expect(bill.notes).toContain('有 1 次调用没有返回 usage，这些调用按 0 token 计入。');
  });

  it('全程没有缓存字段时 notes 说明缓存未提供', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'zhipu',
      model: 'glm-4-flash',
      finishedAt: 0,
      records: [
        record({
          provider: 'zhipu',
          model: 'glm-4-flash',
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          cacheReported: false,
        }),
      ],
    });

    expect(bill.totals.cacheReportedCalls).toBe(0);
    expect(bill.notes).toContain('本局供应商没有返回缓存字段，缓存命中一律显示「未提供」。');
  });

  it('有缓存命中时 notes 说明没有做缓存折扣', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [record()],
    });

    expect(bill.notes).toContain('缓存命中的 token 按 prompt 单价计入，没有做缓存折扣。');
  });

  it('一次调用都没有时也给出合法的空账单', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'zhipu',
      model: 'glm-4-flash',
      finishedAt: 5,
      records: [],
    });

    expect(bill.calls).toEqual([]);
    expect(bill.bySeat).toEqual([]);
    expect(bill.totals.calls).toBe(0);
    expect(bill.totals.estimatedCostCny).toBe(0);
    expect(bill.notes[0]).toBe(BILL_ESTIMATE_NOTE);
  });

  it('序列化后不含任何 Key 字段', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [record()],
    });

    expect(JSON.stringify(bill)).not.toContain('apiKey');
  });
});
