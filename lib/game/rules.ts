import type { Seat, VoteEntry, Winner } from '@/lib/game/types';

export function tallyVotes(votes: VoteEntry[]): Record<number, number> {
  const tally: Record<number, number> = {};
  for (const vote of votes) {
    tally[vote.targetSeatId] = (tally[vote.targetSeatId] ?? 0) + 1;
  }
  return tally;
}

export function topCandidates(tally: Record<number, number>): number[] {
  const entries = Object.entries(tally).map(([seatId, count]) => [Number(seatId), count] as const);
  if (entries.length === 0) {
    return [];
  }
  const highest = Math.max(...entries.map(([, count]) => count));
  return entries
    .filter(([, count]) => count === highest)
    .map(([seatId]) => seatId)
    .sort((a, b) => a - b);
}

export function pickRandom<T>(items: T[], rng: () => number): T {
  if (items.length === 0) {
    throw new Error('无法从空列表中随机选取');
  }
  return items[Math.min(Math.floor(rng() * items.length), items.length - 1)];
}

export function checkWinner(seats: Seat[]): Winner | null {
  const undercover = seats.find((seat) => seat.role === 'undercover');
  if (!undercover) {
    throw new Error('座位中没有卧底，游戏状态非法');
  }
  if (!undercover.alive) {
    return 'civilians';
  }
  return seats.filter((seat) => seat.alive).length <= 2 ? 'undercover' : null;
}
