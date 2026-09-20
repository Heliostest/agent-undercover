import { describe, expect, it } from 'vitest';

import type { BillTotals } from '@/lib/billing/estimate';
import type { UsageRecord } from '@/lib/billing/ledger';
import {
  CACHE_UNKNOWN_TEXT,
  COST_UNAVAILABLE_TEXT,
  USAGE_PHASE_LABELS,
  billShowsCost,
  formatCacheCell,
  formatCallCost,
  formatClock,
  formatCny,
  formatCost,
  formatDateTime,
  formatTokens,
} from '@/lib/client/bill-format';

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    callId: 'c-1',
    at: 1_700_000_000_000,
    seatId: 0,
    phase: 'speak',
    provider: 'zhipu',
    model: 'glm-4-air',
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

function totals(estimatedCostCny: number | null): BillTotals {
  return {
    calls: 2,
    promptTokens: 2000,
    completionTokens: 1000,
    totalTokens: 3000,
    cacheHitTokens: 1600,
    cacheMissTokens: 400,
    cacheReportedCalls: 2,
    usageMissingCalls: 0,
    estimatedCostCny,
  };
}

describe('formatCny', () => {
  it('固定 4 位小数并带人民币符号', () => {
    expect(formatCny(0.012)).toBe('¥0.0120');
    expect(formatCny(0)).toBe('¥0.0000');
    expect(formatCny(12.3)).toBe('¥12.3000');
  });
});

describe('formatTokens', () => {
  it('三位一逗号', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1500)).toBe('1,500');
    expect(formatTokens(1234567)).toBe('1,234,567');
  });
});

describe('formatClock / formatDateTime', () => {
  it('时钟是 HH:MM:SS', () => {
    expect(formatClock(1_700_000_000_000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('日期时间是 YYYY-MM-DD HH:MM', () => {
    expect(formatDateTime(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('formatCacheCell', () => {
  it('供应商报了缓存时显示命中与未命中', () => {
    expect(formatCacheCell(record())).toBe('命中 800 / 未命中 200');
  });

  it('供应商没报缓存时显示「未提供」而不是 0', () => {
    expect(
      formatCacheCell(record({ cacheReported: false, cacheHitTokens: 0, cacheMissTokens: 0 })),
    ).toBe(CACHE_UNKNOWN_TEXT);
    expect(CACHE_UNKNOWN_TEXT).toBe('未提供');
  });
});

describe('formatCost', () => {
  it('有金额时和 formatCny 一致', () => {
    expect(formatCost(0.012)).toBe('¥0.0120');
    expect(formatCost(0)).toBe('¥0.0000');
  });

  it('金额为 null 时说明费用暂不可用', () => {
    expect(formatCost(null)).toBe(COST_UNAVAILABLE_TEXT);
    expect(COST_UNAVAILABLE_TEXT).toBe('费用暂不可用（仅统计 token）');
  });
});

describe('formatCallCost', () => {
  it('按这次调用的模型单价算出金额', () => {
    // glm-4-air：1K prompt * 0.0005 + 0.5K completion * 0.0005 = 0.00075
    expect(formatCallCost(record())).toBe('¥0.0008');
  });

  it('没有内置单价的供应商显示「费用暂不可用」', () => {
    expect(formatCallCost(record({ provider: 'openrouter', model: 'openai/gpt-4o-mini' }))).toBe(
      COST_UNAVAILABLE_TEXT,
    );
    expect(formatCallCost(record({ provider: 'deepseek', model: 'deepseek-chat' }))).toBe(
      COST_UNAVAILABLE_TEXT,
    );
  });
});

describe('billShowsCost', () => {
  it('总计有金额时要展示费用列', () => {
    expect(billShowsCost({ totals: totals(0.0075) })).toBe(true);
    expect(billShowsCost({ totals: totals(0) })).toBe(true);
  });

  it('总计为 null 时不展示费用列', () => {
    expect(billShowsCost({ totals: totals(null) })).toBe(false);
  });
});

describe('USAGE_PHASE_LABELS', () => {
  it('两个阶段都有中文名', () => {
    expect(USAGE_PHASE_LABELS).toEqual({ speak: '发言', vote: '投票' });
  });
});
