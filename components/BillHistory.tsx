'use client';

import { useEffect, useState } from 'react';

import type { Bill } from '@/lib/billing/estimate';
import {
  appendBill,
  clearHistory,
  loadHistory,
  removeBill,
  saveHistory,
  type BillHistoryEntry,
} from '@/lib/client/bill-history';
import { formatCost, formatDateTime, formatTokens } from '@/lib/client/bill-format';
import { browserStorage } from '@/lib/client/settings-storage';
import { PROVIDER_LABELS } from '@/lib/llm/providers';
import { BillPanel } from '@/components/BillPanel';

export interface BillHistoryProps {
  /** 本局刚收到的账单；收到就写进历史（同一局重复写只留最新一条）。 */
  latestBill: Bill | null;
}

export function BillHistory({ latestBill }: BillHistoryProps) {
  const [entries, setEntries] = useState<BillHistoryEntry[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(loadHistory(browserStorage()));
  }, []);

  useEffect(() => {
    if (!latestBill) {
      return;
    }
    setEntries((previous) => {
      const next = appendBill(previous, latestBill, Date.now());
      setStorageError(saveHistory(next, browserStorage()));
      return next;
    });
  }, [latestBill]);

  function remove(gameId: string) {
    setEntries((previous) => {
      const next = removeBill(previous, gameId);
      setStorageError(saveHistory(next, browserStorage()));
      return next;
    });
  }

  function clearAll() {
    clearHistory(browserStorage());
    setEntries([]);
    setStorageError(null);
  }

  return (
    <section className="panel">
      <div className="god-header">
        <h2 className="section-title">历史账单（本机浏览器，不含 API Key）</h2>
        <button type="button" onClick={clearAll} disabled={entries.length === 0}>
          清空
        </button>
      </div>

      {storageError ? <p className="danger">{storageError}</p> : null}

      {entries.length === 0 ? (
        <p className="muted">还没有记录：打完一局后这里会出现该局的估算账单。</p>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => (
            <li key={entry.gameId} className="history-item">
              <div className="history-row">
                <span>{formatDateTime(entry.savedAt)}</span>
                <span>{PROVIDER_LABELS[entry.bill.provider]}</span>
                <span>{entry.bill.model}</span>
                <span>{formatTokens(entry.bill.totals.totalTokens)} tokens</span>
                <span className="bill-cost">{formatCost(entry.bill.totals.estimatedCostCny)}</span>
                <button type="button" onClick={() => remove(entry.gameId)}>
                  删除
                </button>
              </div>
              <details>
                <summary>查看完整账单</summary>
                <BillPanel bill={entry.bill} seats={[]} title={`对局 ${entry.gameId}`} />
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
