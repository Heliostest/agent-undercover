import { describe, expect, it } from 'vitest';

import { checkWinner, pickRandom, tallyVotes, topCandidates } from '@/lib/game/rules';
import type { Role, Seat, VoteEntry } from '@/lib/game/types';

function vote(seatId: number, targetSeatId: number): VoteEntry {
  return { kind: 'vote', round: 1, seatId, targetSeatId, reason: '理由', fallback: false };
}

function seat(id: number, role: Role, alive: boolean): Seat {
  return {
    id,
    name: `P${id}`,
    personaId: `p${id}`,
    personaLabel: '标签',
    role,
    word: role === 'undercover' ? '豆浆' : '牛奶',
    alive,
  };
}

describe('tallyVotes', () => {
  it('按被投座位累计票数', () => {
    expect(tallyVotes([vote(0, 2), vote(1, 2), vote(3, 1)])).toEqual({ 2: 2, 1: 1 });
  });

  it('空投票返回空对象', () => {
    expect(tallyVotes([])).toEqual({});
  });
});

describe('topCandidates', () => {
  it('唯一最高票只返回一个座位', () => {
    expect(topCandidates({ 2: 2, 1: 1 })).toEqual([2]);
  });

  it('并列最高票按座位号升序返回全部', () => {
    expect(topCandidates({ 3: 1, 0: 1, 2: 1 })).toEqual([0, 2, 3]);
  });

  it('空票池返回空数组', () => {
    expect(topCandidates({})).toEqual([]);
  });
});

describe('pickRandom', () => {
  it('按 rng 落点取元素', () => {
    expect(pickRandom([10, 20, 30], () => 0)).toBe(10);
    expect(pickRandom([10, 20, 30], () => 0.9)).toBe(30);
  });

  it('rng 返回 1 时不越界', () => {
    expect(pickRandom([10, 20], () => 1)).toBe(20);
  });

  it('空列表抛错', () => {
    expect(() => pickRandom([], () => 0)).toThrow('无法从空列表中随机选取');
  });
});

describe('checkWinner', () => {
  it('卧底出局时平民胜', () => {
    const seats = [
      seat(0, 'civilian', true),
      seat(1, 'civilian', true),
      seat(2, 'civilian', true),
      seat(3, 'undercover', false),
    ];
    expect(checkWinner(seats)).toBe('civilians');
  });

  it('只剩 2 人且含卧底时卧底胜', () => {
    const seats = [
      seat(0, 'civilian', true),
      seat(1, 'civilian', false),
      seat(2, 'civilian', false),
      seat(3, 'undercover', true),
    ];
    expect(checkWinner(seats)).toBe('undercover');
  });

  it('4 人全活时未分胜负', () => {
    const seats = [
      seat(0, 'civilian', true),
      seat(1, 'civilian', true),
      seat(2, 'civilian', true),
      seat(3, 'undercover', true),
    ];
    expect(checkWinner(seats)).toBeNull();
  });

  it('3 人存活且卧底还在时未分胜负', () => {
    const seats = [
      seat(0, 'civilian', true),
      seat(1, 'civilian', true),
      seat(2, 'civilian', false),
      seat(3, 'undercover', true),
    ];
    expect(checkWinner(seats)).toBeNull();
  });

  it('座位里没有卧底时抛错', () => {
    expect(() => checkWinner([seat(0, 'civilian', true)])).toThrow('座位中没有卧底');
  });
});
