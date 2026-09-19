'use client';

import type { PublicSeat } from '@/lib/game/types';

interface SeatCardProps {
  seat: PublicSeat;
  activeSeatId: number | null;
}

export function SeatCard({ seat, activeSeatId }: SeatCardProps) {
  const classNames = ['seat-card'];
  if (!seat.alive) {
    classNames.push('seat-card-out');
  }
  if (seat.alive && seat.id === activeSeatId) {
    classNames.push('seat-card-active');
  }

  return (
    <article className={classNames.join(' ')}>
      <div className="seat-name">{seat.name}</div>
      <div className="muted seat-persona">{seat.personaLabel}</div>
      <div className="seat-status">
        {seat.alive ? (seat.id === activeSeatId ? '正在行动' : '存活') : '已出局'}
      </div>
    </article>
  );
}
