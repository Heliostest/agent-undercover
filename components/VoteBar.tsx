'use client';

import { currentRoundVotes, seatName, voteTally } from '@/lib/client/format';
import type { PublicGameView } from '@/lib/game/types';

interface VoteBarProps {
  view: PublicGameView;
}

export function VoteBar({ view }: VoteBarProps) {
  const votes = currentRoundVotes(view);
  const tally = voteTally(view);
  const tallyEntries = Object.entries(tally).sort((a, b) => Number(b[1]) - Number(a[1]));

  return (
    <section className="panel">
      <h2 className="section-title">第 {view.round} 轮投票</h2>
      {votes.length === 0 ? (
        <p className="muted">本轮还没有人投票。</p>
      ) : (
        <>
          <ul className="vote-list">
            {votes.map((entry, index) => (
              <li key={`${entry.seatId}-${index}`} className="vote-item">
                <strong>{seatName(view.seats, entry.seatId)}</strong>
                <span className="muted"> 投给 </span>
                <strong>{seatName(view.seats, entry.targetSeatId)}</strong>
                <span className={entry.fallback ? 'danger vote-reason' : 'muted vote-reason'}>
                  {entry.reason}
                </span>
              </li>
            ))}
          </ul>
          <p className="vote-tally">
            本轮汇总：
            {tallyEntries
              .map(([seatId, count]) => `${seatName(view.seats, Number(seatId))} ${count} 票`)
              .join('，')}
          </p>
        </>
      )}
    </section>
  );
}
