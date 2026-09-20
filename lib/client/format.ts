import { tallyVotes } from '@/lib/game/rules';
import type { Phase, PublicGameView, PublicSeat, PublicVoteEntry, Winner } from '@/lib/game/types';

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

function roundVotes(view: PublicGameView): PublicVoteEntry[] {
  return view.log.filter(
    (entry): entry is PublicVoteEntry => entry.kind === 'vote' && entry.round === view.round,
  );
}

/** 本轮正在进行的是第几次投票；还没人投票时算第 1 次。 */
export function currentBallot(view: PublicGameView): number {
  return roundVotes(view).reduce((max, entry) => Math.max(max, entry.ballot), 1);
}

/** 只返回本轮最后一次投票：平票重投的两次票不能并在一起，否则 4 人局会显示 8 票。 */
export function currentRoundVotes(view: PublicGameView): PublicVoteEntry[] {
  const votes = roundVotes(view);
  const ballot = votes.reduce((max, entry) => Math.max(max, entry.ballot), 1);
  return votes.filter((entry) => entry.ballot === ballot);
}

export function voteTally(view: PublicGameView): Record<number, number> {
  return tallyVotes(currentRoundVotes(view));
}
