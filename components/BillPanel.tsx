'use client';

import type { Bill } from '@/lib/billing/estimate';
import {
  USAGE_PHASE_LABELS,
  formatCacheCell,
  formatCallCost,
  formatClock,
  formatCny,
  formatTokens,
} from '@/lib/client/bill-format';
import { seatName } from '@/lib/client/format';
import { PROVIDER_LABELS } from '@/lib/llm/providers';
import type { PublicSeat } from '@/lib/game/types';

export interface BillPanelProps {
  bill: Bill;
  /** 有牌桌时传座位表好显示名字；历史回看传 [] 会退化成「座位 N」。 */
  seats: PublicSeat[];
  title?: string;
}

export function BillPanel({ bill, seats, title = '本局账单' }: BillPanelProps) {
  return (
    <section className="panel bill">
      <div className="bill-header">
        <h2 className="section-title">
          {title}
          <span className="bill-badge">估算</span>
        </h2>
        <p className="muted">
          {PROVIDER_LABELS[bill.provider]} ｜ {bill.model} ｜ 共 {bill.totals.calls} 次调用
        </p>
      </div>

      <dl className="bill-totals">
        <div>
          <dt>提示 tokens</dt>
          <dd>{formatTokens(bill.totals.promptTokens)}</dd>
        </div>
        <div>
          <dt>生成 tokens</dt>
          <dd>{formatTokens(bill.totals.completionTokens)}</dd>
        </div>
        <div>
          <dt>合计 tokens</dt>
          <dd>{formatTokens(bill.totals.totalTokens)}</dd>
        </div>
        <div>
          <dt>缓存命中</dt>
          <dd>
            {bill.totals.cacheReportedCalls > 0
              ? formatTokens(bill.totals.cacheHitTokens)
              : '未提供'}
          </dd>
        </div>
        <div>
          <dt>估算费用</dt>
          <dd className="bill-cost">{formatCny(bill.totals.estimatedCostCny)}</dd>
        </div>
      </dl>

      <ul className="bill-notes muted">
        {bill.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      <h3 className="bill-subtitle">按座位</h3>
      <table className="bill-table">
        <thead>
          <tr>
            <th>座位</th>
            <th>调用</th>
            <th>提示</th>
            <th>生成</th>
            <th>缓存命中</th>
            <th>估算费用</th>
          </tr>
        </thead>
        <tbody>
          {bill.bySeat.map((seat) => (
            <tr key={seat.seatId}>
              <td>{seatName(seats, seat.seatId)}</td>
              <td>{seat.calls}</td>
              <td>{formatTokens(seat.promptTokens)}</td>
              <td>{formatTokens(seat.completionTokens)}</td>
              <td>
                {bill.totals.cacheReportedCalls > 0 ? formatTokens(seat.cacheHitTokens) : '未提供'}
              </td>
              <td>{formatCny(seat.estimatedCostCny)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <details className="bill-calls">
        <summary>展开每次调用明细（{bill.totals.calls} 条）</summary>
        <table className="bill-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>座位</th>
              <th>阶段</th>
              <th>提示</th>
              <th>生成</th>
              <th>合计</th>
              <th>缓存</th>
              <th>估算费用</th>
            </tr>
          </thead>
          <tbody>
            {bill.calls.map((call, index) => (
              <tr key={`${call.at}-${call.seatId}-${index}`}>
                <td>{formatClock(call.at)}</td>
                <td>{seatName(seats, call.seatId)}</td>
                <td>{USAGE_PHASE_LABELS[call.phase]}</td>
                <td>{call.usageReported ? formatTokens(call.promptTokens) : '未提供'}</td>
                <td>{call.usageReported ? formatTokens(call.completionTokens) : '未提供'}</td>
                <td>{call.usageReported ? formatTokens(call.totalTokens) : '未提供'}</td>
                <td>{formatCacheCell(call)}</td>
                <td>{formatCallCost(call)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
