'use client';

import { useState } from 'react';

import { seatName } from '@/lib/client/format';
import type { GodGameView, PublicSeat, SpeechEntry, VoteEntry } from '@/lib/game/types';

interface GodPanelProps {
  gameId: string;
  seats: PublicSeat[];
}

/** 只有带内心独白的发言/投票值得在这里列出来；出局记录没有独白。 */
function monologueEntries(log: GodGameView['log']): Array<SpeechEntry | VoteEntry> {
  return log.filter(
    (entry): entry is SpeechEntry | VoteEntry =>
      (entry.kind === 'speech' || entry.kind === 'vote') && entry.thought.trim() !== '',
  );
}

export function GodPanel({ gameId, seats }: GodPanelProps) {
  const [open, setOpen] = useState(false);
  const [god, setGod] = useState<GodGameView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setError(null);
    const response = await fetch(`/api/games/${gameId}/reveal`);
    const payload = (await response.json()) as Partial<GodGameView> & { error?: string };
    if (!response.ok || !payload.reveal) {
      setError(payload.error ?? '拉取上帝视角失败');
      setGod(null);
      setOpen(true);
      return;
    }
    setGod(payload as GodGameView);
    setOpen(true);
  }

  // 内心独白只在这里出现：公开时间线与 SSE 帧里根本没有这个字段。
  const monologues = god ? monologueEntries(god.log ?? []) : [];

  return (
    <section className="panel">
      <div className="god-header">
        <h2 className="section-title">上帝视角（调试用，默认关闭）</h2>
        <button type="button" onClick={toggle}>
          {open ? '隐藏' : '显示身份与私有词'}
        </button>
      </div>
      {open && error ? <p className="danger">{error}</p> : null}
      {open && god ? (
        <>
          <ul className="god-list">
            {god.reveal.map((item) => (
              <li key={item.seatId}>
                <strong>{seatName(seats, item.seatId)}</strong>（座位 {item.seatId}）：
                {item.role === 'undercover' ? '卧底' : '平民'} ｜ 词：{item.word}
              </li>
            ))}
          </ul>
          <h3 className="section-title god-subtitle">内心独白</h3>
          {monologues.length === 0 ? (
            <p className="muted">还没有人留下内心独白。</p>
          ) : (
            <ul className="god-list">
              {monologues.map((entry, index) => (
                <li key={`${entry.kind}-${entry.round}-${entry.seatId}-${index}`}>
                  <div>
                    <span className="muted timeline-round">第 {entry.round} 轮</span>{' '}
                    <strong>{seatName(seats, entry.seatId)}</strong>{' '}
                    {entry.kind === 'speech' ? (
                      <span>{entry.text}</span>
                    ) : (
                      <span>
                        投给 <strong>{seatName(seats, entry.targetSeatId)}</strong>：{entry.reason}
                      </span>
                    )}
                  </div>
                  <div className="god-thought">内心独白：{entry.thought}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
