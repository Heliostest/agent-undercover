import type { UsageRecord } from '@/lib/billing/ledger';
import { isKnownModel, priceFor } from '@/lib/billing/prices';
import { PROVIDER_LABELS } from '@/lib/llm/providers';
import type { LlmProvider } from '@/lib/llm/types';

export const BILL_ESTIMATE_NOTE = '本账单为本地估算，实际费用以供应商官方账单为准。';

export interface SeatBill {
  seatId: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  estimatedCostCny: number;
}

export interface BillTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  /** 供应商真的返回了缓存字段的调用次数；为 0 时界面一律显示「未提供」。 */
  cacheReportedCalls: number;
  /** 整段 usage 缺失的调用次数，这些调用按 0 token 计入。 */
  usageMissingCalls: number;
  estimatedCostCny: number;
}

export interface Bill {
  gameId: string;
  provider: LlmProvider;
  model: string;
  finishedAt: number;
  /** 永远是 true：本项目只出估算账单。 */
  estimated: true;
  calls: UsageRecord[];
  bySeat: SeatBill[];
  totals: BillTotals;
  notes: string[];
}

export function roundCny(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function estimateCallCostCny(record: UsageRecord): number {
  const price = priceFor(record.provider, record.model);
  return (
    (record.promptTokens / 1000) * price.promptPerKTokens +
    (record.completionTokens / 1000) * price.completionPerKTokens
  );
}

export interface BuildBillInput {
  gameId: string;
  provider: LlmProvider;
  model: string;
  finishedAt: number;
  records: UsageRecord[];
}

function emptySeatBill(seatId: number): SeatBill {
  return {
    seatId,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    estimatedCostCny: 0,
  };
}

function buildNotes(input: BuildBillInput, totals: BillTotals): string[] {
  const notes = [BILL_ESTIMATE_NOTE];
  if (!isKnownModel(input.provider, input.model)) {
    notes.push(
      `模型 ${input.model} 不在内置价目表里，已按 ${PROVIDER_LABELS[input.provider]} 默认档单价估算。`,
    );
  }
  if (totals.usageMissingCalls > 0) {
    notes.push(`有 ${totals.usageMissingCalls} 次调用没有返回 usage，这些调用按 0 token 计入。`);
  }
  if (totals.cacheReportedCalls === 0) {
    notes.push('本局供应商没有返回缓存字段，缓存命中一律显示「未提供」。');
  }
  if (totals.cacheHitTokens > 0) {
    notes.push('缓存命中的 token 按 prompt 单价计入，没有做缓存折扣。');
  }
  return notes;
}

export function buildBill(input: BuildBillInput): Bill {
  const calls = [...input.records].sort((a, b) => a.at - b.at);

  const totals: BillTotals = {
    calls: calls.length,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    cacheReportedCalls: 0,
    usageMissingCalls: 0,
    estimatedCostCny: 0,
  };

  // 费用先按未取整的浮点累加，最后统一取整，避免每条都取整带来的累计误差。
  const seatCosts = new Map<number, number>();
  const seatBills = new Map<number, SeatBill>();
  let rawTotalCost = 0;

  for (const call of calls) {
    const cost = estimateCallCostCny(call);
    rawTotalCost += cost;

    totals.promptTokens += call.promptTokens;
    totals.completionTokens += call.completionTokens;
    totals.totalTokens += call.totalTokens;
    totals.cacheHitTokens += call.cacheHitTokens;
    totals.cacheMissTokens += call.cacheMissTokens;
    if (call.cacheReported) {
      totals.cacheReportedCalls += 1;
    }
    if (!call.usageReported) {
      totals.usageMissingCalls += 1;
    }

    const seat = seatBills.get(call.seatId) ?? emptySeatBill(call.seatId);
    seat.calls += 1;
    seat.promptTokens += call.promptTokens;
    seat.completionTokens += call.completionTokens;
    seat.totalTokens += call.totalTokens;
    seat.cacheHitTokens += call.cacheHitTokens;
    seat.cacheMissTokens += call.cacheMissTokens;
    seatBills.set(call.seatId, seat);
    seatCosts.set(call.seatId, (seatCosts.get(call.seatId) ?? 0) + cost);
  }

  totals.estimatedCostCny = roundCny(rawTotalCost);

  const bySeat = [...seatBills.values()]
    .map((seat) => ({ ...seat, estimatedCostCny: roundCny(seatCosts.get(seat.seatId) ?? 0) }))
    .sort((a, b) => a.seatId - b.seatId);

  return {
    gameId: input.gameId,
    provider: input.provider,
    model: input.model,
    finishedAt: input.finishedAt,
    estimated: true,
    calls,
    bySeat,
    totals,
    notes: buildNotes(input, totals),
  };
}
