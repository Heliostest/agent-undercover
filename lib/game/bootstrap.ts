import { randomUUID } from 'node:crypto';

import { PERSONAS } from '@/lib/agents/personas';
import { PlayerAgent } from '@/lib/agents/player-agent';
import { runGame } from '@/lib/game/judge';
import { putSession } from '@/lib/game/registry';
import { createSession, publish, type GameSession } from '@/lib/game/session';
import { createGame } from '@/lib/game/state';
import { SEAT_COUNT, type SeatAgent } from '@/lib/game/types';
import { drawWordPair, loadWordPairs } from '@/lib/game/word-bank';
import type { LlmClient } from '@/lib/llm/types';
import { createZhipuClient, readZhipuConfigFromEnv } from '@/lib/llm/zhipu';

export interface StartGameOptions {
  env?: Record<string, string | undefined>;
  rng?: () => number;
  now?: () => number;
  llm?: LlmClient;
  hardTimeoutMs?: number;
}

/**
 * 同步完成建局与注册，然后把 Judge 的整局循环放到后台跑。
 * 缺 API Key 会在这里同步抛出 MissingApiKeyError，调用方据此返回可读错误，绝不空跑。
 */
export function startGame(options: StartGameOptions = {}): GameSession {
  const env = options.env ?? process.env;
  const rng = options.rng ?? Math.random;
  const now = options.now ?? Date.now;
  const llm = options.llm ?? createZhipuClient(readZhipuConfigFromEnv(env));

  const pair = drawWordPair(loadWordPairs(), rng);
  const undercoverSeatId = Math.min(Math.floor(rng() * SEAT_COUNT), SEAT_COUNT - 1);
  const state = createGame({ gameId: randomUUID(), personas: PERSONAS, pair, undercoverSeatId });

  const session = createSession(state);
  putSession(session);

  const agents = new Map<number, SeatAgent>(
    PERSONAS.map((persona, seatId) => [seatId, new PlayerAgent(persona, { llm, seatId })]),
  );

  session.completion = runGame(state, {
    agents,
    rng,
    now,
    hardTimeoutMs: options.hardTimeoutMs,
    emit: (event) => publish(session, event),
  }).then(() => undefined);

  return session;
}
