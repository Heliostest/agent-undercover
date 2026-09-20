import { disposeSession, unrefTimer, type GameSession } from '@/lib/game/session';

/** 对局结束后在内存里留这么久，够刷新页面回看战报与账单；到点自动清掉。 */
export const FINISHED_SESSION_TTL_MS = 30 * 60_000;
/** 注册表容量上限；超了就淘汰最旧的已结束对局，进行中的对局绝不动。 */
export const MAX_SESSIONS = 32;

type RegistryHolder = typeof globalThis & {
  __agentUndercoverGameRegistry?: Map<string, GameSession>;
};

/** 挂在 globalThis 上，这样 next dev 的模块热替换不会把正在进行的对局弄丢。 */
function registry(): Map<string, GameSession> {
  const holder = globalThis as RegistryHolder;
  holder.__agentUndercoverGameRegistry ??= new Map<string, GameSession>();
  return holder.__agentUndercoverGameRegistry;
}

/** Map 按插入顺序迭代，最旧的已结束对局排在前面，先淘汰它们。 */
function evictOverflow(sessions: Map<string, GameSession>): void {
  for (const [gameId, session] of sessions) {
    if (sessions.size <= MAX_SESSIONS) {
      return;
    }
    if (session.finished) {
      disposeSession(session);
      sessions.delete(gameId);
    }
  }
}

export function putSession(session: GameSession): void {
  // 只有进了注册表的对局才需要安排清理；registry 是唯一知道怎么删自己的人。
  session.onFinished = (finished) => scheduleSessionCleanup(finished.gameId);
  const sessions = registry();
  sessions.set(session.gameId, session);
  evictOverflow(sessions);
}

export function getSession(gameId: string): GameSession | undefined {
  return registry().get(gameId);
}

export function deleteSession(gameId: string): void {
  const session = registry().get(gameId);
  if (session) {
    disposeSession(session);
  }
  registry().delete(gameId);
}

/** 终局后安排 TTL 清理；重复安排不会叠加计时器。 */
export function scheduleSessionCleanup(gameId: string, ttlMs = FINISHED_SESSION_TTL_MS): void {
  const session = registry().get(gameId);
  if (!session || session.cleanupTimer !== undefined) {
    return;
  }
  session.cleanupTimer = setTimeout(() => {
    session.cleanupTimer = undefined;
    deleteSession(gameId);
  }, ttlMs);
  unrefTimer(session.cleanupTimer);
}

export function sessionCount(): number {
  return registry().size;
}
