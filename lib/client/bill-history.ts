import type { Bill } from '@/lib/billing/estimate';
import type { SettingsStorage } from '@/lib/client/settings-storage';

export const HISTORY_STORAGE_KEY = 'agent-undercover:bill-history';
export const HISTORY_LIMIT = 20;
export const HISTORY_WRITE_ERROR = '浏览器拒绝保存账单历史（可能是隐私模式），本局账单仍可查看';

export interface BillHistoryEntry {
  gameId: string;
  savedAt: number;
  /** Bill 类型里没有任何 Key 字段，历史因此天然不含 API Key。 */
  bill: Bill;
}

function isHistoryEntry(value: unknown): value is BillHistoryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.gameId !== 'string' || typeof entry.savedAt !== 'number') {
    return false;
  }
  const bill = entry.bill;
  return (
    typeof bill === 'object' &&
    bill !== null &&
    'totals' in bill &&
    'calls' in bill &&
    Array.isArray((bill as Bill).calls)
  );
}

export function parseHistory(raw: string | null): BillHistoryEntry[] {
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isHistoryEntry).slice(0, HISTORY_LIMIT);
}

export function serializeHistory(entries: BillHistoryEntry[]): string {
  return JSON.stringify(entries);
}

/** 新→旧；同一局重复写入只保留最新一条；最多 HISTORY_LIMIT 条。 */
export function appendBill(
  entries: BillHistoryEntry[],
  bill: Bill,
  savedAt: number,
): BillHistoryEntry[] {
  return [
    { gameId: bill.gameId, savedAt, bill },
    ...entries.filter((entry) => entry.gameId !== bill.gameId),
  ].slice(0, HISTORY_LIMIT);
}

export function removeBill(entries: BillHistoryEntry[], gameId: string): BillHistoryEntry[] {
  return entries.filter((entry) => entry.gameId !== gameId);
}

export function loadHistory(storage: SettingsStorage | null): BillHistoryEntry[] {
  if (!storage) {
    return [];
  }
  try {
    return parseHistory(storage.getItem(HISTORY_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveHistory(
  entries: BillHistoryEntry[],
  storage: SettingsStorage | null,
): string | null {
  if (!storage) {
    return null;
  }
  try {
    storage.setItem(HISTORY_STORAGE_KEY, serializeHistory(entries));
    return null;
  } catch {
    return HISTORY_WRITE_ERROR;
  }
}

export function clearHistory(storage: SettingsStorage | null): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // 删不掉就算了，不能因为清理失败卡住界面。
  }
}
