'use client';

import { useEffect, useRef, useState } from 'react';

import type { Bill } from '@/lib/billing/estimate';
import {
  appendBill,
  clearHistory,
  loadHistory,
  removeBill,
  saveHistory,
  type BillHistoryEntry,
} from '@/lib/client/bill-history';
import {
  billShowsCost,
  formatCost,
  formatDateTime,
  formatTokens,
} from '@/lib/client/bill-format';
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
  /** 写盘不能放进 setState 的更新函数里（更新函数必须是纯的，严格模式下会跑两遍）；
   *  又不能只读渲染闭包里的 entries——挂载时「读历史」和「写入本局账单」是同一批 effect，
   *  闭包里还是空数组。用一份同步更新的镜像当作最新值来源。 */
  const entriesRef = useRef<BillHistoryEntry[]>([]);

  /** 先算出下一份历史，再 setState，最后落盘。 */
  function commit(next: BillHistoryEntry[]) {
    entriesRef.current = next;
    setEntries(next);
    setStorageError(saveHistory(next, browserStorage()));
  }

  useEffect(() => {
    const loaded = loadHistory(browserStorage());
    entriesRef.current = loaded;
    setEntries(loaded);
  }, []);

  useEffect(() => {
    if (!latestBill) {
      return;
    }
    commit(appendBill(entriesRef.current, latestBill, Date.now()));
  }, [latestBill]);

  function remove(gameId: string) {
    commit(removeBill(entriesRef.current, gameId));
  }

  function clearAll() {
    clearHistory(browserStorage());
    entriesRef.current = [];
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
        <p className="muted">还没有记录：打完一局后这里会出现该局的用量账单。</p>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => (
            <li key={entry.gameId} className="history-item">
              <div className="history-row">
                <span>{formatDateTime(entry.savedAt)}</span>
                <span>{PROVIDER_LABELS[entry.bill.provider]}</span>
                <span>{entry.bill.model}</span>
                <span>{formatTokens(entry.bill.totals.totalTokens)} tokens</span>
                {billShowsCost(entry.bill) ? (
                  <span className="bill-cost">{formatCost(entry.bill.totals.estimatedCostCny)}</span>
                ) : null}
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
