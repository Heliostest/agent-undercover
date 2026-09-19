import type { GameSession } from '@/lib/game/session';

type RegistryHolder = typeof globalThis & {
  __agentUndercoverGameRegistry?: Map<string, GameSession>;
};

/** 挂在 globalThis 上，这样 next dev 的模块热替换不会把正在进行的对局弄丢。 */
function registry(): Map<string, GameSession> {
  const holder = globalThis as RegistryHolder;
  holder.__agentUndercoverGameRegistry ??= new Map<string, GameSession>();
  return holder.__agentUndercoverGameRegistry;
}

export function putSession(session: GameSession): void {
  registry().set(session.gameId, session);
}

export function getSession(gameId: string): GameSession | undefined {
  return registry().get(gameId);
}

export function deleteSession(gameId: string): void {
  registry().delete(gameId);
}

export function sessionCount(): number {
  return registry().size;
}
