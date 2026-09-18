import { tallyVotes } from '@/lib/game/rules';
import type { Phase, PublicGameView, PublicSeat, VoteEntry, Winner } from '@/lib/game/types';

export const PHASE_LABELS: Record<Phase, string> = {
  setup: '准备中',
  speak: '发言轮',
  vote: '投票轮',
  result: '已结束',
  error: '出错了',
};

export const WINNER_LABELS: Record<Winner, string> = {
  civilians: '平民胜',
  undercover: '卧底胜',
};

export function seatName(seats: PublicSeat[], seatId: number): string {
  return seats.find((seat) => seat.id === seatId)?.name ?? `座位${seatId}`;
}

export function currentRoundVotes(view: PublicGameView): VoteEntry[] {
  return view.log.filter(
    (entry): entry is VoteEntry => entry.kind === 'vote' && entry.round === view.round,
  );
}

export function voteTally(view: PublicGameView): Record<number, number> {
  return tallyVotes(currentRoundVotes(view));
}
