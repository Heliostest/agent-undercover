'use client';

import { PHASE_LABELS, WINNER_LABELS } from '@/lib/client/format';
import type { StreamStatus } from '@/lib/client/use-game-stream';
import type { PublicGameView } from '@/lib/game/types';

interface TopBarProps {
  view: PublicGameView | null;
  status: StreamStatus;
  onStart: () => void;
}

export function TopBar({ view, status, onStart }: TopBarProps) {
  const running = status === 'starting' || status === 'streaming';
  const buttonText = status === 'idle' ? '开始' : running ? '进行中…' : '再来一局';

  return (
    <header className="panel topbar">
      <div>
        <h1 className="topbar-title">Agent Undercover</h1>
        <p className="muted topbar-meta">
          局号：{view ? view.gameId : '—'} ｜ 第 {view ? view.round : 0} 轮 ｜ 阶段：
          {view ? PHASE_LABELS[view.phase] : '未开始'}
          {view?.winner ? ` ｜ ${WINNER_LABELS[view.winner]}` : ''}
        </p>
      </div>
      <button className="primary" type="button" onClick={onStart} disabled={running}>
        {buttonText}
      </button>
    </header>
  );
}
