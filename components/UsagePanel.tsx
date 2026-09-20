'use client';

import { USAGE_PHASE_LABELS, formatCacheCell, formatTokens } from '@/lib/client/bill-format';
import { seatName } from '@/lib/client/format';
import type { PublicSeat, UsageEvent } from '@/lib/game/types';

export interface UsagePanelProps {
  rows: UsageEvent[];
  /** 有牌桌时传座位表好显示名字；传 [] 会退化成「座位 N」。 */
  seats: PublicSeat[];
}

export function UsagePanel({ rows, seats }: UsagePanelProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="panel usage">
      <h2 className="section-title">实时用量</h2>
      <p className="muted">对局进行中每次成功调用追加一行；局末账单是汇总。</p>
      <table className="bill-table usage-table">
        <thead>
          <tr>
            <th>座位</th>
            <th>阶段</th>
            <th>提示</th>
            <th>生成</th>
            <th>缓存</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.callId}>
              <td>{seatName(seats, row.seatId)}</td>
              <td>{USAGE_PHASE_LABELS[row.phase]}</td>
              <td>{formatTokens(row.promptTokens)}</td>
              <td>{formatTokens(row.completionTokens)}</td>
              <td>{formatCacheCell(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
