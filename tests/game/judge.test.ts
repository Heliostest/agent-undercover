import { describe, expect, it, vi } from 'vitest';

import { HARD_TIMEOUT_MESSAGE, runGame, type JudgeDeps } from '@/lib/game/judge';
import { createGame } from '@/lib/game/state';
import type { AgentView, GameEvent, Persona, SeatAgent } from '@/lib/game/types';

const PERSONAS: Persona[] = [0, 1, 2, 3].map((id) => ({
  id: `persona-${id}`,
  name: `玩家${id}`,
  label: `人设${id}`,
  systemPrompt: `你是玩家${id}`,
}));

/** 按脚本投票的假 agent：voteScript[callIndex] 给出这次要投谁；不在候选里就投候选第一个。 */
function scriptedAgent(seatId: number, voteScript: number[]): SeatAgent {
  let voteCall = 0;
  return {
    async speak(view: AgentView) {
      return { text: `我是${view.seatName}，第${view.round}轮发言`, fallback: false };
    },
    async vote(_view, candidateIds) {
      const wanted = voteScript[Math.min(voteCall, voteScript.length - 1)];
      voteCall += 1;
      return {
        targetSeatId: candidateIds.includes(wanted) ? wanted : candidateIds[0],
        reason: `座位${seatId}的理由`,
        fallback: false,
      };
    },
  };
}

function makeDeps(
  voteScripts: Record<number, number[]>,
  overrides: Partial<JudgeDeps> = {},
): { deps: JudgeDeps; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const agents = new Map<number, SeatAgent>(
    [0, 1, 2, 3].map((seatId) => [seatId, scriptedAgent(seatId, voteScripts[seatId] ?? [0])]),
  );
  const deps: JudgeDeps = {
    agents,
    rng: () => 0,
    now: () => 0,
    emit: (event) => events.push(event),
    ...overrides,
  };
  return { deps, events };
}

function newGame() {
  return createGame({
    gameId: 'g-1',
    personas: PERSONAS,
    pair: { civilian: '牛奶', undercover: '豆浆' },
    undercoverSeatId: 3,
  });
}

describe('runGame', () => {
  it('each ballot uses the same snapshot, so later voters cannot copy newly cast votes', async () => {
    const { deps } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    const visibleVotes: number[] = [];
    for (const agent of deps.agents.values()) {
      const vote = agent.vote.bind(agent);
      agent.vote = async (view, candidates, rng) => {
        visibleVotes.push(view.log.filter((e) => e.kind === 'vote').length);
        return vote(view, candidates, rng);
      };
    }
    await runGame(newGame(), deps);
    expect(visibleVotes).toEqual([0, 0, 0, 0]);
  });
  it('所有人投卧底时平民一轮取胜', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    const state = await runGame(newGame(), deps);

    expect(state.winner).toBe('civilians');
    expect(state.phase).toBe('result');
    expect(state.round).toBe(1);
    expect(state.seats[3].alive).toBe(false);
  });

  it('每个存活者每轮都发一次言', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    await runGame(newGame(), deps);

    const speeches = events.filter((event) => event.type === 'speech');
    expect(speeches).toHaveLength(4);
    expect(speeches.map((event) => (event.type === 'speech' ? event.seatId : -1))).toEqual([0, 1, 2, 3]);
  });

  it('结束时推一条带 winner 与 reveal 的 result 事件', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    await runGame(newGame(), deps);

    const results = events.filter((event) => event.type === 'result');
    expect(results).toHaveLength(1);
    const last = results[0];
    if (last.type !== 'result') {
      throw new Error('类型断言失败');
    }
    expect(last.eliminatedSeatId).toBe(3);
    expect(last.tieBreak).toBe(false);
    expect(last.winner).toBe('civilians');
    expect(last.reveal).toEqual([
      { seatId: 0, role: 'civilian', word: '牛奶' },
      { seatId: 1, role: 'civilian', word: '牛奶' },
      { seatId: 2, role: 'civilian', word: '牛奶' },
      { seatId: 3, role: 'undercover', word: '豆浆' },
    ]);
  });

  it('未结束的 result 事件不带 reveal', async () => {
    const { deps, events } = makeDeps({ 0: [1, 2], 1: [0, 2], 2: [0, 0], 3: [1, 2] });
    await runGame(newGame(), deps);

    const results = events.filter((event) => event.type === 'result');
    expect(results.length).toBeGreaterThan(1);
    const first = results[0];
    if (first.type !== 'result') {
      throw new Error('类型断言失败');
    }
    expect(first.winner).toBeNull();
    expect(first.reveal).toBeNull();
  });

  it('连续淘汰两名平民后卧底胜', async () => {
    const { deps } = makeDeps({ 0: [1, 2], 1: [0, 2], 2: [0, 0], 3: [1, 2] });
    const state = await runGame(newGame(), deps);

    expect(state.winner).toBe('undercover');
    expect(state.seats.filter((seat) => seat.alive)).toHaveLength(2);
  });

  it('首轮平票时重投一轮，重投出唯一最高票则不算随机出局', async () => {
    // 首轮：0→1, 1→0, 2→3, 3→2，四人各 1 票；重投候选收窄到 [0,1,2,3]，全部投 1（3 号投不了自己以外的限制不触发）
    const { deps, events } = makeDeps({ 0: [1, 1], 1: [0, 0], 2: [3, 1], 3: [2, 1] });
    const state = await runGame(newGame(), deps);

    const votes = events.filter((event) => event.type === 'vote');
    expect(votes.length).toBeGreaterThanOrEqual(8);
    // 同一游戏轮里的两次投票必须分得开，否则前端和 agent 都会把它们当成一次改票。
    expect(votes.slice(0, 4).map((event) => event.ballot)).toEqual([1, 1, 1, 1]);
    expect(votes.slice(4, 8).map((event) => event.ballot)).toEqual([2, 2, 2, 2]);
    expect(votes.slice(0, 8).every((event) => event.round === 1)).toBe(true);
    const ballots = state.log
      .filter((entry) => entry.kind === 'vote' && entry.round === 1)
      .map((entry) => (entry.kind === 'vote' ? entry.ballot : 0));
    expect(ballots).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    const elimination = state.log.find((entry) => entry.kind === 'elimination');
    expect(elimination).toEqual({ kind: 'elimination', round: 1, seatId: 1, tieBreak: false });
  });

  it('两轮都平票时按 rng 在并列者中随机出局并标记 tieBreak', async () => {
    const { deps } = makeDeps({ 0: [1], 1: [0], 2: [3], 3: [2] }, { rng: () => 0 });
    const state = await runGame(newGame(), deps);

    const elimination = state.log.find((entry) => entry.kind === 'elimination');
    expect(elimination).toMatchObject({ kind: 'elimination', round: 1, tieBreak: true });
  });

  it('硬超时会推 error 事件并把状态置为 error', async () => {
    let clock = 0;
    const { deps, events } = makeDeps(
      { 0: [3], 1: [3], 2: [3], 3: [0] },
      {
        now: () => {
          clock += 5_000;
          return clock;
        },
        hardTimeoutMs: 1_000,
      },
    );
    const state = await runGame(newGame(), deps);

    expect(state.phase).toBe('error');
    expect(state.errorMessage).toBe(HARD_TIMEOUT_MESSAGE);
    expect(events.at(-1)).toEqual({ type: 'error', message: HARD_TIMEOUT_MESSAGE });
  });

  it('agent 抛错时转成 error 事件而不是向外抛', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    deps.agents.set(1, {
      speak: vi.fn(async () => {
        throw new Error('agent 内部炸了');
      }),
      vote: vi.fn(async () => {
        throw new Error('agent 内部炸了');
      }),
    });

    const state = await runGame(newGame(), deps);

    expect(state.phase).toBe('error');
    expect(state.errorMessage).toBe('agent 内部炸了');
    expect(events.at(-1)).toEqual({ type: 'error', message: 'agent 内部炸了' });
  });

  it('缺少座位对应的 agent 时推 error', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    deps.agents.delete(2);

    const state = await runGame(newGame(), deps);

    expect(state.phase).toBe('error');
    expect(state.errorMessage).toBe('座位 2 没有绑定 agent');
    expect(events.at(-1)?.type).toBe('error');
  });
});
