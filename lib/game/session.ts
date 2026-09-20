import type { GameEvent, GameState } from '@/lib/game/types';

export type GameEventListener = (event: GameEvent) => void;

export interface GameSession {
  gameId: string;
  state: GameState;
  events: GameEvent[];
  subscribers: Set<GameEventListener>;
  finished: boolean;
  /** Judge 跑完这一局的 promise；测试用它等待整局结束。 */
  completion?: Promise<void>;
}

export function createSession(state: GameState): GameSession {
  return {
    gameId: state.gameId,
    state,
    events: [],
    subscribers: new Set<GameEventListener>(),
    finished: false,
  };
}

export function isTerminalEvent(event: GameEvent): boolean {
  if (event.type === 'error') {
    return true;
  }
  return event.type === 'result' && event.winner !== null;
}

export function publish(session: GameSession, event: GameEvent): void {
  session.events.push(event);
  if (isTerminalEvent(event)) {
    session.finished = true;
  }
  for (const listener of [...session.subscribers]) {
    try {
      listener(event);
    } catch {
      // 监听器抛错说明那条 SSE 连接已经断了，直接摘掉它。
      session.subscribers.delete(listener);
    }
  }
}

/**
 * fromIndex 是水位线：只回放它之后的事件。
 * SSE 路由先取 snapshot 再用 events.length 当水位线，避免快照里的日志被回放二次追加。
 */
export function subscribe(
  session: GameSession,
  listener: GameEventListener,
  fromIndex = 0,
): () => void {
  for (const event of session.events.slice(Math.max(0, fromIndex))) {
    listener(event);
  }
  session.subscribers.add(listener);
  return () => {
    session.subscribers.delete(listener);
  };
}
