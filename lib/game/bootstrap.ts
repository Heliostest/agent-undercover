import { randomUUID } from 'node:crypto';

import { PERSONAS } from '@/lib/agents/personas';
import { PlayerAgent } from '@/lib/agents/player-agent';
import { createBillEmitter } from '@/lib/billing/bill-emitter';
import { UsageLedger } from '@/lib/billing/ledger';
import { createUsageSink } from '@/lib/billing/usage-emitter';
import { runGame } from '@/lib/game/judge';
import { putSession } from '@/lib/game/registry';
import { createSession, publish, type GameSession } from '@/lib/game/session';
import { createGame } from '@/lib/game/state';
import { SEAT_COUNT, type SeatAgent } from '@/lib/game/types';
import { drawNextWordPair } from '@/lib/game/word-bank';
import { InvalidLlmConfigError, createLlmClient, type LlmConfig } from '@/lib/llm/create-client';
import type { LlmClient } from '@/lib/llm/types';

export interface StartGameOptions {
  /** 来自 POST /api/games 的请求体；Key 只活在这一局的闭包里，不写盘不打日志。 */
  llmConfig?: LlmConfig;
  rng?: () => number;
  now?: () => number;
  /** 测试用的注入点：给了就不会去建真实客户端。 */
  llm?: LlmClient;
  hardTimeoutMs?: number;
}

function resolveClient(options: StartGameOptions): LlmClient {
  if (options.llm) {
    return options.llm;
  }
  if (!options.llmConfig) {
    throw new InvalidLlmConfigError('缺少模型配置：请在页面「模型设置」里选择供应商并填写 API Key');
  }
  return createLlmClient(options.llmConfig);
}

/**
 * 同步完成建局与注册，然后把 Judge 的整局循环放到后台跑。
 * 配置不合法会在这里同步抛出 InvalidLlmConfigError，调用方据此返回可读错误，绝不空跑。
 */
export function startGame(options: StartGameOptions = {}): GameSession {
  const rng = options.rng ?? Math.random;
  const now = options.now ?? Date.now;
  const llm = resolveClient(options);

  const pair = drawNextWordPair(rng);
  const undercoverSeatId = Math.min(Math.floor(rng() * SEAT_COUNT), SEAT_COUNT - 1);
  const state = createGame({ gameId: randomUUID(), personas: PERSONAS, pair, undercoverSeatId });

  const session = createSession(state);
  putSession(session);

  const ledger = new UsageLedger(now);
  // 每次记账都顺带推一条 usage，浏览器不用等局末的 bill 就能看到真实用量。
  const onUsage = createUsageSink({
    ledger,
    emit: (event) => publish(session, event),
  });

  const agents = new Map<number, SeatAgent>(
    PERSONAS.map((persona, seatId) => [seatId, new PlayerAgent(persona, { llm, seatId, onUsage })]),
  );

  // 账单必须抢在终局事件前面发，否则 SSE 已经关流了。
  const emit = createBillEmitter({
    gameId: state.gameId,
    provider: llm.provider,
    model: llm.model,
    ledger,
    now,
    emit: (event) => publish(session, event),
  });

  // 没人订阅事件流时 session 会 abort 这个信号，Judge 和在途的模型调用一起收手。
  session.completion = runGame(state, {
    agents,
    rng,
    now,
    hardTimeoutMs: options.hardTimeoutMs,
    emit,
    signal: session.abortController.signal,
  }).then(() => undefined);

  return session;
}
