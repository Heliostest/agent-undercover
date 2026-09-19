import { describe, expect, it } from 'vitest';

import { applyEvent } from '@/lib/client/apply-event';
import {
  PHASE_LABELS,
  WINNER_LABELS,
  currentRoundVotes,
  seatName,
  voteTally,
} from '@/lib/client/format';
import type { PublicGameView } from '@/lib/game/types';

const BASE: PublicGameView = {
  gameId: 'g-1',
  round: 0,
  phase: 'setup',
  activeSeatId: null,
  seats: [
    { id: 0, name: '阿岚', personaLabel: '谨慎分析', alive: true },
    { id: 1, name: '小柯', personaLabel: '幽默带节奏', alive: true },
    { id: 2, name: '雷子', personaLabel: '激进带节奏', alive: true },
    { id: 3, name: '沉舟', personaLabel: '少话观察', alive: true },
  ],
  log: [],
  winner: null,
  errorMessage: null,
};

describe('applyEvent', () => {
  it('phase 事件更新阶段、轮次与行动者', () => {
    const next = applyEvent(BASE, { type: 'phase', phase: 'speak', round: 1, activeSeatId: 2 });
    expect(next.phase).toBe('speak');
    expect(next.round).toBe(1);
    expect(next.activeSeatId).toBe(2);
  });

  it('speech 事件追加一条发言日志', () => {
    const next = applyEvent(BASE, {
      type: 'speech',
      round: 1,
      seatId: 0,
      text: '白白的',
      fallback: false,
    });
    expect(next.log).toEqual([
      { kind: 'speech', round: 1, seatId: 0, text: '白白的', fallback: false },
    ]);
  });

  it('vote 事件追加一条投票日志', () => {
    const next = applyEvent(BASE, {
      type: 'vote',
      round: 1,
      seatId: 0,
      targetSeatId: 3,
      reason: '太安静',
      fallback: true,
    });
    expect(next.log).toEqual([
      { kind: 'vote', round: 1, seatId: 0, targetSeatId: 3, reason: '太安静', fallback: true },
    ]);
  });

  it('result 事件把出局者置为死亡、写日志并记录胜负', () => {
    const next = applyEvent(BASE, {
      type: 'result',
      round: 1,
      eliminatedSeatId: 3,
      tieBreak: true,
      winner: 'civilians',
      reveal: [],
    });
    expect(next.seats[3].alive).toBe(false);
    expect(next.log).toEqual([{ kind: 'elimination', round: 1, seatId: 3, tieBreak: true }]);
    expect(next.winner).toBe('civilians');
  });

  it('error 事件切到 error 阶段并带上提示', () => {
    const next = applyEvent(BASE, { type: 'error', message: '模型挂了' });
    expect(next.phase).toBe('error');
    expect(next.activeSeatId).toBeNull();
    expect(next.errorMessage).toBe('模型挂了');
  });

  it('不修改传入的 view（纯函数）', () => {
    const snapshot = JSON.stringify(BASE);
    applyEvent(BASE, { type: 'phase', phase: 'vote', round: 2, activeSeatId: null });
    expect(JSON.stringify(BASE)).toBe(snapshot);
  });
});

describe('format 辅助', () => {
  it('五个阶段都有中文标签', () => {
    expect(Object.keys(PHASE_LABELS).sort()).toEqual(['error', 'result', 'setup', 'speak', 'vote']);
    expect(PHASE_LABELS.speak).toBe('发言轮');
    expect(WINNER_LABELS.undercover).toBe('卧底胜');
  });

  it('seatName 找不到座位时回退到座位号', () => {
    expect(seatName(BASE.seats, 1)).toBe('小柯');
    expect(seatName(BASE.seats, 9)).toBe('座位9');
  });

  it('currentRoundVotes 只取当前轮的投票', () => {
    const view: PublicGameView = {
      ...BASE,
      round: 2,
      log: [
        { kind: 'vote', round: 1, seatId: 0, targetSeatId: 1, reason: 'a', fallback: false },
        { kind: 'vote', round: 2, seatId: 0, targetSeatId: 3, reason: 'b', fallback: false },
        { kind: 'vote', round: 2, seatId: 1, targetSeatId: 3, reason: 'c', fallback: false },
        { kind: 'speech', round: 2, seatId: 2, text: 'x', fallback: false },
      ],
    };
    expect(currentRoundVotes(view)).toHaveLength(2);
    expect(voteTally(view)).toEqual({ 3: 2 });
  });
});
