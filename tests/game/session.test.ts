import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteSession,
  getSession,
  putSession,
  sessionCount,
} from '@/lib/game/registry';
import {
  SUBSCRIBER_GRACE_MS,
  createSession,
  isTerminalEvent,
  publish,
  subscribe,
  usageEventsBefore,
} from '@/lib/game/session';
import { createGame } from '@/lib/game/state';
import type { GameEvent, Persona, UsageEvent } from '@/lib/game/types';

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

function usageEvent(callId: string): UsageEvent {
  return {
    type: 'usage',
    callId,
    seatId: 0,
    phase: 'speak',
    provider: 'zhipu',
    model: 'glm-4-flash',
    promptTokens: 100,
    completionTokens: 20,
    cacheHitTokens: 64,
    cacheMissTokens: 36,
    cacheReported: true,
  };
}

const PHASE_EVENT: GameEvent = { type: 'phase', phase: 'speak', round: 1, activeSeatId: 0 };
const ERROR_EVENT: GameEvent = { type: 'error', message: '炸了' };
const WIN_EVENT: GameEvent = {
  type: 'result',
  round: 1,
  eliminatedSeatId: 0,
  tieBreak: false,
  winner: 'civilians',
  reveal: [],
};

afterEach(() => vi.useRealTimers());

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

describe('usageEventsBefore', () => {
  it('只取水位线之前的 usage，保持顺序', () => {
    const session = newSession();
    publish(session, PHASE_EVENT);
    publish(session, usageEvent('a'));
    publish(session, { type: 'speech', round: 1, seatId: 0, text: '一种饮料', fallback: false });
    publish(session, usageEvent('b'));

    expect(usageEventsBefore(session, session.events.length).map((row) => row.callId)).toEqual([
      'a',
      'b',
    ]);
    expect(usageEventsBefore(session, 2).map((row) => row.callId)).toEqual(['a']);
  });

  it('水位线为 0 或越界时都不会报错', () => {
    const session = newSession();
    publish(session, usageEvent('a'));

    expect(usageEventsBefore(session, 0)).toEqual([]);
    expect(usageEventsBefore(session, -5)).toEqual([]);
    expect(usageEventsBefore(session, 99).map((row) => row.callId)).toEqual(['a']);
  });
});

describe('session 生命周期', () => {
  it('订阅者归零且对局未结束时，宽限期到点中止整局', () => {
    vi.useFakeTimers();
    const session = newSession();
    const unsubscribe = subscribe(session, () => {});

    unsubscribe();
    expect(session.abortController.signal.aborted).toBe(false);

    vi.advanceTimersByTime(SUBSCRIBER_GRACE_MS);
    expect(session.abortController.signal.aborted).toBe(true);
  });

  it('宽限期内重新连上就不再中止（刷新页面不该掐掉对局）', () => {
    vi.useFakeTimers();
    const session = newSession();
    const unsubscribe = subscribe(session, () => {});

    unsubscribe();
    vi.advanceTimersByTime(SUBSCRIBER_GRACE_MS - 1);
    subscribe(session, () => {});
    vi.advanceTimersByTime(SUBSCRIBER_GRACE_MS * 3);

    expect(session.abortController.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('已经结束的对局不会因为没人订阅被中止', () => {
    vi.useFakeTimers();
    const session = newSession();
    const unsubscribe = subscribe(session, () => {});
    publish(session, WIN_EVENT);

    unsubscribe();
    vi.advanceTimersByTime(SUBSCRIBER_GRACE_MS * 3);

    expect(session.abortController.signal.aborted).toBe(false);
  });

  it('监听器抛错被摘掉后同样开始计时', () => {
    vi.useFakeTimers();
    const session = newSession();
    subscribe(session, () => {
      throw new Error('连接已断');
    });

    publish(session, PHASE_EVENT);
    vi.advanceTimersByTime(SUBSCRIBER_GRACE_MS);

    expect(session.abortController.signal.aborted).toBe(true);
  });

  it('终局事件会记下 finishedAt，并把账单留在 session 上供重连取用', () => {
    const session = newSession();
    const bill = { gameId: session.gameId } as never;
    publish(session, { type: 'bill', bill });
    publish(session, WIN_EVENT);

    expect(session.finished).toBe(true);
    expect(session.finishedAt).toBeGreaterThan(0);
    expect(session.lastBill).toBe(bill);
  });

  it('终局时通知注册方安排清理，且只通知一次', () => {
    const session = newSession();
    const onFinished = vi.fn();
    session.onFinished = onFinished;

    publish(session, WIN_EVENT);
    publish(session, ERROR_EVENT);

    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith(session);
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
