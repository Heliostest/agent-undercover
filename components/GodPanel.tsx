'use client';

import { useState } from 'react';

import type { GodGameView } from '@/lib/game/types';

interface GodPanelProps {
  gameId: string;
}

export function GodPanel({ gameId }: GodPanelProps) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState<GodGameView['reveal'] | null>(null);
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
      setReveal(null);
      setOpen(true);
      return;
    }
    setReveal(payload.reveal);
    setOpen(true);
  }

  return (
    <section className="panel">
      <div className="god-header">
        <h2 className="section-title">上帝视角（调试用，默认关闭）</h2>
        <button type="button" onClick={toggle}>
          {open ? '隐藏' : '显示身份与私有词'}
        </button>
      </div>
      {open && error ? <p className="danger">{error}</p> : null}
      {open && reveal ? (
        <ul className="god-list">
          {reveal.map((item) => (
            <li key={item.seatId}>
              座位 {item.seatId}：{item.role === 'undercover' ? '卧底' : '平民'} ｜ 词：{item.word}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
