import { estimateCallCostCny, roundCny } from '@/lib/billing/estimate';
import type { UsagePhase, UsageRecord } from '@/lib/billing/ledger';

export const USAGE_PHASE_LABELS: Record<UsagePhase, string> = {
  speak: '发言',
  vote: '投票',
};

export const CACHE_UNKNOWN_TEXT = '未提供';

export function formatCny(value: number): string {
  return `¥${value.toFixed(4)}`;
}

/** 自己插逗号，不依赖 Intl，保证不同 Node 构建下输出一致。 */
export function formatTokens(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatClock(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDateTime(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatCacheCell(
  record: Pick<UsageRecord, 'cacheReported' | 'cacheHitTokens' | 'cacheMissTokens'>,
): string {
  if (!record.cacheReported) {
    return CACHE_UNKNOWN_TEXT;
  }
  return `命中 ${formatTokens(record.cacheHitTokens)} / 未命中 ${formatTokens(
    record.cacheMissTokens,
  )}`;
}

export function formatCallCost(record: UsageRecord): string {
  return formatCny(roundCny(estimateCallCostCny(record)));
}
