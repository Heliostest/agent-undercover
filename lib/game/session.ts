import type { Bill } from '@/lib/billing/estimate';
import type { GameEvent, GameState, UsageEvent } from '@/lib/game/types';

export type GameEventListener = (event: GameEvent) => void;

/**
 * 订阅者归零后再等这么久才中止整局。
 * 刷新页面只会断开一瞬，给足宽限；真的关了标签页就别再替他烧 token 了。
 */
export const SUBSCRIBER_GRACE_MS = 10_000;

export interface GameSession {
  gameId: string;
  state: GameState;
  events: GameEvent[];
  subscribers: Set<GameEventListener>;
  finished: boolean;
  /** 整局的取消开关：没人看了就 abort，Judge 与模型调用都会停手。 */
  abortController: AbortController;
  /** Judge 跑完这一局的 promise；测试用它等待整局结束。 */
  completion?: Promise<void>;
  /** 终局时刻；配合 registry 的 TTL 决定什么时候把这一局清出内存。 */
  finishedAt?: number;
  /** 最近一次 bill 事件里的账单，终局后重连直接用它填快照。 */
  lastBill?: Bill | null;
  /** 由注册方（registry）挂上：终局后安排把自己清出注册表。 */
  onFinished?: (session: GameSession) => void;
  /** 零订阅宽限计时器；有人接回来就清掉。 */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** 终局清理计时器，由 registry 安排。 */
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

/** 后台计时器不该拖住 Node 进程退出（测试进程尤其明显）。 */
export function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function createSession(state: GameState): GameSession {
  return {
    gameId: state.gameId,
    state,
    events: [],
    subscribers: new Set<GameEventListener>(),
    finished: false,
    abortController: new AbortController(),
  };
}

export function isTerminalEvent(event: GameEvent): boolean {
  if (event.type === 'error') {
    return true;
  }
  return event.type === 'result' && event.winner !== null;
}

function clearIdleTimer(session: GameSession): void {
  if (session.idleTimer !== undefined) {
    clearTimeout(session.idleTimer);
    session.idleTimer = undefined;
  }
}

/** 最后一个订阅者离开后开始倒计时：宽限期内没人接回来就中止整局。 */
function onSubscriberLeft(session: GameSession): void {
  if (session.finished || session.subscribers.size > 0 || session.idleTimer !== undefined) {
    return;
  }
  session.idleTimer = setTimeout(() => {
    session.idleTimer = undefined;
    if (!session.finished && session.subscribers.size === 0) {
      session.abortController.abort();
    }
  }, SUBSCRIBER_GRACE_MS);
  unrefTimer(session.idleTimer);
}

/** 清出注册表或进程收尾时调用：只负责拆计时器，不改对局结果。 */
export function disposeSession(session: GameSession): void {
  clearIdleTimer(session);
  if (session.cleanupTimer !== undefined) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = undefined;
  }
}

export function publish(session: GameSession, event: GameEvent): void {
  session.events.push(event);
  if (event.type === 'bill') {
    session.lastBill = event.bill;
  }
  if (isTerminalEvent(event) && !session.finished) {
    session.finished = true;
    session.finishedAt = Date.now();
    clearIdleTimer(session);
    session.onFinished?.(session);
  }
  for (const listener of [...session.subscribers]) {
    try {
      listener(event);
    } catch {
      // 监听器抛错说明那条 SSE 连接已经断了，直接摘掉它。
      if (session.subscribers.delete(listener)) {
        onSubscriberLeft(session);
      }
    }
  }
}

/**
 * usage 和账单一样不进 GameState：重连时水位线之前的那些只能从事件缓冲里捞回快照，
 * 否则刷新后已经花掉的 token 就从用量面板上消失了。
 */
export function usageEventsBefore(session: GameSession, watermark: number): UsageEvent[] {
  return session.events
    .slice(0, Math.max(0, watermark))
    .filter((event): event is UsageEvent => event.type === 'usage');
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
  // 有人接上了，撤掉待执行的中止。
  clearIdleTimer(session);
  return () => {
    if (session.subscribers.delete(listener)) {
      onSubscriberLeft(session);
    }
  };
}
