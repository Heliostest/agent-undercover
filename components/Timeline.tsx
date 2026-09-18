'use client';

import { seatName } from '@/lib/client/format';
import type { PublicGameView, SpeechEntry } from '@/lib/game/types';

interface TimelineProps {
  view: PublicGameView;
}

export function Timeline({ view }: TimelineProps) {
  const speeches = view.log.filter((entry): entry is SpeechEntry => entry.kind === 'speech');

  return (
    <section className="panel">
      <h2 className="section-title">发言时间线</h2>
      {speeches.length === 0 ? (
        <p className="muted">还没有人发言。</p>
      ) : (
        <ol className="timeline">
          {speeches.map((entry, index) => (
            <li key={`${entry.round}-${entry.seatId}-${index}`} className="timeline-item">
              <span className="muted timeline-round">第 {entry.round} 轮</span>
              <strong className="timeline-speaker">{seatName(view.seats, entry.seatId)}</strong>
              <span className={entry.fallback ? 'danger' : undefined}>{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
