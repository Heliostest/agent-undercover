import { checkWinner, pickRandom, tallyVotes, topCandidates } from '@/lib/game/rules';
import {
  aliveSeats,
  buildAgentView,
  eliminate,
  recordSpeech,
  recordVote,
  revealOf,
} from '@/lib/game/state';
import type { GameEvent, GameState, Phase, SeatAgent, VoteEntry } from '@/lib/game/types';

export const DEFAULT_HARD_TIMEOUT_MS = 180_000;
export const MAX_VOTE_ROUNDS = 2;
export const HARD_TIMEOUT_MESSAGE = '单局硬超时，已终止本局';

export interface JudgeDeps {
  agents: Map<number, SeatAgent>;
  rng: () => number;
  emit: (event: GameEvent) => void;
  now: () => number;
  hardTimeoutMs?: number;
}

interface VoteOutcome {
  seatId: number;
  tieBreak: boolean;
}

type EnsureTime = () => void;

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

async function runSpeechPhase(state: GameState, deps: JudgeDeps, ensureTime: EnsureTime): Promise<void> {
  for (const seat of aliveSeats(state)) {
    ensureTime();
    setPhase(state, deps, 'speak', seat.id);
    const result = await requireAgent(deps, seat.id).speak(buildAgentView(state, seat.id));
    recordSpeech(state, {
      kind: 'speech',
      round: state.round,
      seatId: seat.id,
      text: result.text,
      fallback: result.fallback,
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
  ensureTime: EnsureTime,
): Promise<VoteEntry[]> {
  const entries: VoteEntry[] = [];
  for (const voterId of voterIds) {
    ensureTime();
    const candidateIds = targetPool.filter((seatId) => seatId !== voterId);
    if (candidateIds.length === 0) {
      continue;
    }
    state.activeSeatId = voterId;
    const result = await requireAgent(deps, voterId).vote(
      buildAgentView(state, voterId),
      candidateIds,
      deps.rng,
    );
    const entry: VoteEntry = {
      kind: 'vote',
      round: state.round,
      seatId: voterId,
      targetSeatId: result.targetSeatId,
      reason: result.reason,
      fallback: result.fallback,
    };
    recordVote(state, entry);
    entries.push(entry);
    deps.emit({
      type: 'vote',
      round: entry.round,
      seatId: entry.seatId,
      targetSeatId: entry.targetSeatId,
      reason: entry.reason,
      fallback: entry.fallback,
    });
  }
  state.activeSeatId = null;
  return entries;
}

async function runVotePhase(
  state: GameState,
  deps: JudgeDeps,
  ensureTime: EnsureTime,
): Promise<VoteOutcome> {
  const voterIds = aliveSeats(state).map((seat) => seat.id);
  let targetPool = voterIds;

  for (let voteRound = 1; voteRound <= MAX_VOTE_ROUNDS; voteRound += 1) {
    ensureTime();
    setPhase(state, deps, 'vote', null);
    const entries = await collectVotes(state, deps, voterIds, targetPool, ensureTime);
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
  const ensureTime: EnsureTime = () => {
    if (deps.now() - startedAt > hardTimeoutMs) {
      throw new Error(HARD_TIMEOUT_MESSAGE);
    }
  };

  try {
    setPhase(state, deps, 'setup', null);

    while (state.winner === null) {
      ensureTime();
      state.round += 1;
      await runSpeechPhase(state, deps, ensureTime);
      const outcome = await runVotePhase(state, deps, ensureTime);
      eliminate(state, outcome.seatId, outcome.tieBreak);
      state.winner = checkWinner(state.seats);
      deps.emit({
        type: 'result',
        round: state.round,
        eliminatedSeatId: outcome.seatId,
        tieBreak: outcome.tieBreak,
        winner: state.winner,
        reveal: state.winner === null ? null : revealOf(state),
      });
    }

    setPhase(state, deps, 'result', null);
    return state;
  } catch (error) {
    state.phase = 'error';
    state.activeSeatId = null;
    state.errorMessage = error instanceof Error ? error.message : String(error);
    deps.emit({ type: 'error', message: state.errorMessage });
    return state;
  }
}
