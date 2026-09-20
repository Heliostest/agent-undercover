import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FINISHED_SESSION_TTL_MS,
  MAX_SESSIONS,
  deleteSession,
  getSession,
  putSession,
  scheduleSessionCleanup,
  sessionCount,
} from '@/lib/game/registry';
import { createSession, publish } from '@/lib/game/session';
import { createGame } from '@/lib/game/state';
import type { GameEvent, Persona } from '@/lib/game/types';

const PERSONAS: Persona[] = [0, 1, 2, 3].map((id) => ({
  id: `persona-${id}`,
  name: `玩家${id}`,
  label: `人设${id}`,
  systemPrompt: `你是玩家${id}`,
}));

const WIN_EVENT: GameEvent = {
  type: 'result',
  round: 1,
  eliminatedSeatId: 0,
  tieBreak: false,
  winner: 'civilians',
  reveal: [],
};

function newSession(gameId: string) {
  return createSession(
    createGame({
      gameId,
      personas: PERSONAS,
      pair: { civilian: '牛奶', undercover: '豆浆' },
      undercoverSeatId: 0,
    }),
  );
}

afterEach(() => vi.useRealTimers());

describe('registry 生命周期', () => {
  it('对局结束后按 TTL 把 session 删掉，注册表不会无限增长', () => {
    vi.useFakeTimers();
    const session = newSession('ttl-1');
    putSession(session);

    publish(session, WIN_EVENT);
    expect(getSession('ttl-1')).toBe(session);

    vi.advanceTimersByTime(FINISHED_SESSION_TTL_MS - 1);
    expect(getSession('ttl-1')).toBe(session);

    vi.advanceTimersByTime(1);
    expect(getSession('ttl-1')).toBeUndefined();
  });

  it('TTL 之内还能重连拿到 session 与账单', () => {
    vi.useFakeTimers();
    const session = newSession('ttl-2');
    putSession(session);
    const bill = { gameId: 'ttl-2' } as never;
    publish(session, { type: 'bill', bill });
    publish(session, WIN_EVENT);

    vi.advanceTimersByTime(FINISHED_SESSION_TTL_MS / 2);
    expect(getSession('ttl-2')?.lastBill).toBe(bill);
  });

  it('重复安排清理不会叠加计时器', () => {
    vi.useFakeTimers();
    const session = newSession('ttl-3');
    putSession(session);
    publish(session, WIN_EVENT);
    scheduleSessionCleanup('ttl-3');
    scheduleSessionCleanup('ttl-3');

    expect(vi.getTimerCount()).toBe(1);
    deleteSession('ttl-3');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('超过上限时先淘汰最旧的已结束对局', () => {
    const finished = newSession('lru-finished');
    putSession(finished);
    publish(finished, WIN_EVENT);

    for (let index = 0; index < MAX_SESSIONS; index += 1) {
      putSession(newSession(`lru-${index}`));
    }

    expect(getSession('lru-finished')).toBeUndefined();
    expect(sessionCount()).toBeLessThanOrEqual(MAX_SESSIONS);
    for (let index = 0; index < MAX_SESSIONS; index += 1) {
      deleteSession(`lru-${index}`);
    }
  });

  it('没有已结束对局可淘汰时，绝不动正在进行的对局', () => {
    const live = Array.from({ length: MAX_SESSIONS + 2 }, (_value, index) => newSession(`live-${index}`));
    for (const session of live) {
      putSession(session);
    }

    for (const session of live) {
      expect(getSession(session.gameId)).toBe(session);
      expect(session.abortController.signal.aborted).toBe(false);
    }
    for (const session of live) {
      deleteSession(session.gameId);
    }
  });
});
