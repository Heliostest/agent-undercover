import { describe, expect, it } from 'vitest';

import {
  deleteSession,
  getSession,
  putSession,
  sessionCount,
} from '@/lib/game/registry';
import { createSession, isTerminalEvent, publish, subscribe } from '@/lib/game/session';
import { createGame } from '@/lib/game/state';
import type { GameEvent, Persona } from '@/lib/game/types';

const PERSONAS: Persona[] = [0, 1, 2, 3].map((id) => ({
  id: `persona-${id}`,
  name: `玩家${id}`,
  label: `人设${id}`,
  systemPrompt: `你是玩家${id}`,
}));

function newSession(gameId = 'g-1') {
  return createSession(
    createGame({
      gameId,
      personas: PERSONAS,
      pair: { civilian: '牛奶', undercover: '豆浆' },
      undercoverSeatId: 0,
    }),
  );
}

const PHASE_EVENT: GameEvent = { type: 'phase', phase: 'speak', round: 1, activeSeatId: 0 };
const ERROR_EVENT: GameEvent = { type: 'error', message: '炸了' };

describe('session 事件总线', () => {
  it('publish 会把事件写进缓冲区', () => {
    const session = newSession();
    publish(session, PHASE_EVENT);
    expect(session.events).toEqual([PHASE_EVENT]);
  });

  it('subscribe 先回放历史事件，再收后续事件', () => {
    const session = newSession();
    publish(session, PHASE_EVENT);

    const received: GameEvent[] = [];
    subscribe(session, (event) => received.push(event));
    expect(received).toEqual([PHASE_EVENT]);

    publish(session, ERROR_EVENT);
    expect(received).toEqual([PHASE_EVENT, ERROR_EVENT]);
  });

  it('带水位线订阅时只回放水位线之后的事件', () => {
    const session = newSession();
    publish(session, PHASE_EVENT);
    const watermark = session.events.length;

    const received: GameEvent[] = [];
    subscribe(session, (event) => received.push(event), watermark);
    expect(received).toEqual([]);

    publish(session, ERROR_EVENT);
    expect(received).toEqual([ERROR_EVENT]);
  });

  it('水位线越界时不会回放也不会报错', () => {
    const session = newSession();
    publish(session, PHASE_EVENT);

    const received: GameEvent[] = [];
    subscribe(session, (event) => received.push(event), 99);
    expect(received).toEqual([]);
  });

  it('退订后不再收到事件', () => {
    const session = newSession();
    const received: GameEvent[] = [];
    const unsubscribe = subscribe(session, (event) => received.push(event));
    unsubscribe();
    publish(session, PHASE_EVENT);
    expect(received).toEqual([]);
  });

  it('监听器抛错时把它移除，不影响其他监听器', () => {
    const session = newSession();
    const received: GameEvent[] = [];
    subscribe(session, () => {
      throw new Error('连接已断');
    });
    subscribe(session, (event) => received.push(event));

    publish(session, PHASE_EVENT);
    publish(session, ERROR_EVENT);

    expect(received).toEqual([PHASE_EVENT, ERROR_EVENT]);
    expect(session.subscribers.size).toBe(1);
  });

  it('终局事件会把 finished 置为 true', () => {
    const session = newSession();
    expect(session.finished).toBe(false);
    publish(session, {
      type: 'result',
      round: 1,
      eliminatedSeatId: 0,
      tieBreak: false,
      winner: 'civilians',
      reveal: [],
    });
    expect(session.finished).toBe(true);
  });

  it('未分胜负的 result 不算终局', () => {
    expect(
      isTerminalEvent({
        type: 'result',
        round: 1,
        eliminatedSeatId: 0,
        tieBreak: false,
        winner: null,
        reveal: null,
      }),
    ).toBe(false);
    expect(isTerminalEvent(ERROR_EVENT)).toBe(true);
    expect(isTerminalEvent(PHASE_EVENT)).toBe(false);
  });
});

describe('registry', () => {
  it('按 gameId 存取与删除', () => {
    const before = sessionCount();
    const session = newSession('g-registry');
    putSession(session);
    expect(getSession('g-registry')).toBe(session);
    expect(sessionCount()).toBe(before + 1);

    deleteSession('g-registry');
    expect(getSession('g-registry')).toBeUndefined();
    expect(sessionCount()).toBe(before);
  });

  it('查不到的 gameId 返回 undefined', () => {
    expect(getSession('不存在的局')).toBeUndefined();
  });
});
