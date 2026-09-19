import type { GameEvent, PublicGameView } from '@/lib/game/types';

export function applyEvent(view: PublicGameView, event: GameEvent): PublicGameView {
  switch (event.type) {
    case 'phase':
      return { ...view, phase: event.phase, round: event.round, activeSeatId: event.activeSeatId };
    case 'speech':
      return {
        ...view,
        log: [
          ...view.log,
          {
            kind: 'speech',
            round: event.round,
            seatId: event.seatId,
            text: event.text,
            fallback: event.fallback,
          },
        ],
      };
    case 'vote':
      return {
        ...view,
        log: [
          ...view.log,
          {
            kind: 'vote',
            round: event.round,
            seatId: event.seatId,
            targetSeatId: event.targetSeatId,
            reason: event.reason,
            fallback: event.fallback,
          },
        ],
      };
    case 'result':
      return {
        ...view,
        seats: view.seats.map((seat) =>
          seat.id === event.eliminatedSeatId ? { ...seat, alive: false } : seat,
        ),
        log:
          event.eliminatedSeatId === null
            ? [...view.log]
            : [
                ...view.log,
                {
                  kind: 'elimination',
                  round: event.round,
                  seatId: event.eliminatedSeatId,
                  tieBreak: event.tieBreak,
                },
              ],
        winner: event.winner,
      };
    case 'error':
      return { ...view, phase: 'error', activeSeatId: null, errorMessage: event.message };
  }
}
