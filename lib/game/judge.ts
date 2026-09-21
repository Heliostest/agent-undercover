import { checkWinner, pickRandom, tallyVotes, topCandidates } from '@/lib/game/rules';
import { pickSpeechAngles } from '@/lib/game/speech-angles';
import {
  aliveSeats,
  buildAgentView,
  eliminate,
  recordSpeech,
  recordVote,
  revealOf,
} from '@/lib/game/state';
import type { GameEvent, GameState, Phase, SeatAgent, VoteEntry } from '@/lib/game/types';

/**
 * 单局墙上时钟上限。每一步（每次发言、每张选票）之前都会核一次，
 * 再加上 PlayerAgent 自己的发言 / 投票时限；
 * 默认 10 分钟墙上时钟，够 flash/v4 打完两轮，又不会无限挂着。
 */
export const DEFAULT_HARD_TIMEOUT_MS = 600_000;
export const MAX_VOTE_ROUNDS = 2;
export const HARD_TIMEOUT_MESSAGE = '单局硬超时，已终止本局';
export const GAME_ABORTED_MESSAGE = '页面已关闭，本局已自动停止，以免继续消耗模型额度';

export interface JudgeDeps {
  agents: Map<number, SeatAgent>;
  rng: () => number;
  emit: (event: GameEvent) => void;
  now: () => number;
  hardTimeoutMs?: number;
  /** 整局取消信号：没人在看时由 session 触发，Judge 与模型调用一起停手。 */
  signal?: AbortSignal;
}

interface VoteOutcome {
  seatId: number;
  tieBreak: boolean;
}

/** 每一步之前的放行检查：被取消或超时就抛出去，由 runGame 统一转成 error 事件。 */
type EnsureRunnable = () => void;

function setPhase(state: GameState, deps: JudgeDeps, phase: Phase, activeSeatId: number | null): void {
  state.phase = phase;
  state.activeSeatId = activeSeatId;
  deps.emit({ type: 'phase', phase, round: state.round, activeSeatId });
}

function requireAgent(deps: JudgeDeps, seatId: number): SeatAgent {
  const agent = deps.agents.get(seatId);
  if (!agent) {
    throw new Error(`座位 ${seatId} 没有绑定 agent`);
  }
  return agent;
}

async function runSpeechPhase(
  state: GameState,
  deps: JudgeDeps,
  ensureRunnable: EnsureRunnable,
): Promise<void> {
  const speakers = aliveSeats(state);
  // 本轮四条发言线先岔开，免得所有人挤同一个生活场景；角度只进各自的提示词。
  const angles = pickSpeechAngles(
    speakers.map((seat) => seat.id),
    deps.rng,
  );
  for (const seat of speakers) {
    ensureRunnable();
    setPhase(state, deps, 'speak', seat.id);
    const view = { ...buildAgentView(state, seat.id), speechAngle: angles.get(seat.id) };
    const result = await requireAgent(deps, seat.id).speak(view, deps.signal);
    // 内心独白只落进服务端日志；下面广播出去的 speech 事件逐字段拼，绝不带上它。
    recordSpeech(state, {
      kind: 'speech',
      round: state.round,
      seatId: seat.id,
      text: result.text,
      fallback: result.fallback,
      thought: result.thought,
    });
    deps.emit({
      type: 'speech',
      round: state.round,
      seatId: seat.id,
      text: result.text,
      fallback: result.fallback,
    });
  }
}

async function collectVotes(
  state: GameState,
  deps: JudgeDeps,
  voterIds: number[],
  targetPool: number[],
  ballot: number,
  ensureRunnable: EnsureRunnable,
): Promise<VoteEntry[]> {
  const entries: VoteEntry[] = [];
  const views = new Map(voterIds.map((id) => [id, buildAgentView(state, id)]));
  for (const voterId of voterIds) {
    ensureRunnable();
    const candidateIds = targetPool.filter((seatId) => seatId !== voterId);
    if (candidateIds.length === 0) {
      continue;
    }
    // 轮到谁投票必须广播出去，否则前端没法高亮当前投票人。
    setPhase(state, deps, 'vote', voterId);
    const result = await requireAgent(deps, voterId).vote(
      views.get(voterId)!,
      candidateIds,
      deps.rng,
      deps.signal,
    );
    const entry: VoteEntry = {
      kind: 'vote',
      round: state.round,
      ballot,
      seatId: voterId,
      targetSeatId: result.targetSeatId,
      reason: result.reason,
      fallback: result.fallback,
      thought: result.thought,
    };
    recordVote(state, entry);
    entries.push(entry);
    // 同发言：事件按字段拼，entry.thought 留在服务端。
    deps.emit({
      type: 'vote',
      round: entry.round,
      ballot: entry.ballot,
      seatId: entry.seatId,
      targetSeatId: entry.targetSeatId,
      reason: entry.reason,
      fallback: entry.fallback,
    });
  }
  setPhase(state, deps, 'vote', null);
  return entries;
}

async function runVotePhase(
  state: GameState,
  deps: JudgeDeps,
  ensureRunnable: EnsureRunnable,
): Promise<VoteOutcome> {
  const voterIds = aliveSeats(state).map((seat) => seat.id);
  let targetPool = voterIds;

  for (let voteRound = 1; voteRound <= MAX_VOTE_ROUNDS; voteRound += 1) {
    ensureRunnable();
    setPhase(state, deps, 'vote', null);
    const entries = await collectVotes(state, deps, voterIds, targetPool, voteRound, ensureRunnable);
    const leaders = topCandidates(tallyVotes(entries));
    if (leaders.length === 1) {
      return { seatId: leaders[0], tieBreak: false };
    }
    targetPool = leaders.length > 0 ? leaders : targetPool;
  }

  // 两轮都平：规则写死为在并列者中随机出局，绝不卡死。
  return { seatId: pickRandom(targetPool, deps.rng), tieBreak: true };
}

export async function runGame(state: GameState, deps: JudgeDeps): Promise<GameState> {
  const startedAt = deps.now();
  const hardTimeoutMs = deps.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
  const ensureRunnable: EnsureRunnable = () => {
    if (deps.signal?.aborted) {
      throw new Error(GAME_ABORTED_MESSAGE);
    }
    if (deps.now() - startedAt > hardTimeoutMs) {
      throw new Error(HARD_TIMEOUT_MESSAGE);
    }
  };

  try {
    ensureRunnable();
    setPhase(state, deps, 'setup', null);

    while (state.winner === null) {
      ensureRunnable();
      state.round += 1;
      await runSpeechPhase(state, deps, ensureRunnable);
      const outcome = await runVotePhase(state, deps, ensureRunnable);
      eliminate(state, outcome.seatId, outcome.tieBreak);
      state.winner = checkWinner(state.seats);
      // 终局事件一发出去 SSE 就关流，所以 result 阶段必须抢在它前面广播。
      if (state.winner !== null) {
        setPhase(state, deps, 'result', null);
      }
      deps.emit({
        type: 'result',
        round: state.round,
        eliminatedSeatId: outcome.seatId,
        tieBreak: outcome.tieBreak,
        winner: state.winner,
        reveal: state.winner === null ? null : revealOf(state),
      });
    }

    return state;
  } catch (error) {
    state.phase = 'error';
    state.activeSeatId = null;
    // 被整局取消时，底下抛出来的多半是 AbortError；对用户说人话。
    state.errorMessage = deps.signal?.aborted
      ? GAME_ABORTED_MESSAGE
      : error instanceof Error
        ? error.message
        : String(error);
    deps.emit({ type: 'error', message: state.errorMessage });
    return state;
  }
}
