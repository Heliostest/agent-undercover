import { describe, expect, it } from 'vitest';

import {
  aliveSeats,
  buildAgentView,
  createGame,
  eliminate,
  recordSpeech,
  recordVote,
  revealOf,
  seatById,
  toGodView,
  toPublicView,
} from '@/lib/game/state';
import type { GameState, Persona, WordPair } from '@/lib/game/types';

const PAIR: WordPair = { civilian: '牛奶', undercover: '豆浆' };

const SPEECH_THOUGHT = '我拿的是牛奶，先别说透';
const VOTE_THOUGHT = '他跟我的牛奶对不上，八成是卧底';

const PERSONAS: Persona[] = [0, 1, 2, 3].map((id) => ({
  id: `persona-${id}`,
  name: `玩家${id}`,
  label: `人设${id}`,
  systemPrompt: `你是玩家${id}`,
}));

function newGame(undercoverSeatId = 2): GameState {
  return createGame({ gameId: 'g-1', personas: PERSONAS, pair: PAIR, undercoverSeatId });
}

describe('createGame', () => {
  it('生成 4 个座位，1 个卧底 3 个平民', () => {
    const state = newGame();
    expect(state.seats).toHaveLength(4);
    expect(state.seats.filter((seat) => seat.role === 'undercover')).toHaveLength(1);
    expect(state.seats.filter((seat) => seat.role === 'civilian')).toHaveLength(3);
  });

  it('平民拿同一个词，卧底拿另一个词', () => {
    const state = newGame(2);
    expect(state.seats.map((seat) => seat.word)).toEqual(['牛奶', '牛奶', '豆浆', '牛奶']);
  });

  it('初始阶段是 setup，轮次为 0，日志为空', () => {
    const state = newGame();
    expect(state.phase).toBe('setup');
    expect(state.round).toBe(0);
    expect(state.activeSeatId).toBeNull();
    expect(state.log).toEqual([]);
    expect(state.winner).toBeNull();
    expect(state.errorMessage).toBeNull();
  });

  it('persona 数量不是 4 时抛错', () => {
    expect(() =>
      createGame({ gameId: 'g', personas: PERSONAS.slice(0, 3), pair: PAIR, undercoverSeatId: 0 }),
    ).toThrow('需要 4 个 persona');
  });

  it('卧底座位号越界时抛错', () => {
    expect(() =>
      createGame({ gameId: 'g', personas: PERSONAS, pair: PAIR, undercoverSeatId: 4 }),
    ).toThrow('卧底座位号越界');
  });
});

/** 往一局里塞一条带内心独白的发言和一张带内心独白的票。 */
function withThoughts(state: GameState): GameState {
  state.round = 1;
  recordSpeech(state, {
    kind: 'speech',
    round: 1,
    seatId: 0,
    text: '白白的',
    fallback: false,
    thought: SPEECH_THOUGHT,
  });
  recordVote(state, {
    kind: 'vote',
    round: 1,
    ballot: 1,
    seatId: 0,
    targetSeatId: 2,
    reason: '他很虚',
    fallback: false,
    thought: VOTE_THOUGHT,
  });
  return state;
}

describe('突变辅助', () => {
  it('recordSpeech / recordVote 按顺序追加日志', () => {
    const state = newGame();
    state.round = 1;
    recordSpeech(state, {
      kind: 'speech',
      round: 1,
      seatId: 0,
      text: '白白的',
      fallback: false,
      thought: '先藏一手',
    });
    recordVote(state, {
      kind: 'vote',
      round: 1,
      ballot: 1,
      seatId: 0,
      targetSeatId: 2,
      reason: '他很虚',
      fallback: false,
      thought: '他肯定是卧底',
    });
    expect(state.log.map((entry) => entry.kind)).toEqual(['speech', 'vote']);
  });

  it('服务端日志原样留着内心独白，供上帝视角回看', () => {
    const state = withThoughts(newGame());
    expect(state.log[0]).toMatchObject({ kind: 'speech', thought: SPEECH_THOUGHT });
    expect(state.log[1]).toMatchObject({ kind: 'vote', thought: VOTE_THOUGHT });
  });

  it('eliminate 把座位置为出局并写一条 elimination 日志', () => {
    const state = newGame();
    state.round = 1;
    eliminate(state, 2, true);
    expect(seatById(state, 2).alive).toBe(false);
    expect(state.log.at(-1)).toEqual({ kind: 'elimination', round: 1, seatId: 2, tieBreak: true });
    expect(aliveSeats(state).map((seat) => seat.id)).toEqual([0, 1, 3]);
  });

  it('seatById 对不存在的座位抛错', () => {
    expect(() => seatById(newGame(), 9)).toThrow('座位 9 不存在');
  });
});

describe('toPublicView', () => {
  it('座位只暴露 id / name / personaLabel / alive 四个字段', () => {
    const view = toPublicView(newGame());
    for (const seat of view.seats) {
      expect(Object.keys(seat).sort()).toEqual(['alive', 'id', 'name', 'personaLabel']);
    }
  });

  it('公开视图带空的 usageLog，且不含身份与 Key', () => {
    const view = toPublicView(newGame());
    expect(view.usageLog).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('apiKey');
  });

  it('序列化后不含任何私有词与 role 字段', () => {
    const serialized = JSON.stringify(toPublicView(newGame()));
    expect(serialized).not.toContain(PAIR.civilian);
    expect(serialized).not.toContain(PAIR.undercover);
    expect(serialized).not.toContain('"role"');
  });

  it('日志被完整带上', () => {
    const state = newGame();
    state.round = 1;
    recordSpeech(state, {
      kind: 'speech',
      round: 1,
      seatId: 0,
      text: '白白的',
      fallback: false,
      thought: '',
    });
    expect(toPublicView(state).log).toHaveLength(1);
  });

  it('公开视角把内心独白整条剥掉，只留 text / reason', () => {
    const view = toPublicView(withThoughts(newGame()));

    expect(view.log[0]).toEqual({
      kind: 'speech',
      round: 1,
      seatId: 0,
      text: '白白的',
      fallback: false,
    });
    expect(view.log[1]).toEqual({
      kind: 'vote',
      round: 1,
      ballot: 1,
      seatId: 0,
      targetSeatId: 2,
      reason: '他很虚',
      fallback: false,
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('thought');
    expect(serialized).not.toContain(SPEECH_THOUGHT);
    expect(serialized).not.toContain(VOTE_THOUGHT);
  });

  it('剥离是复制而不是就地改写，服务端日志不受影响', () => {
    const state = withThoughts(newGame());
    toPublicView(state);
    expect(state.log[0]).toMatchObject({ thought: SPEECH_THOUGHT });
  });
});

describe('toGodView / revealOf', () => {
  it('上帝视角额外给出每个座位的身份与词', () => {
    const state = newGame(2);
    expect(revealOf(state)).toEqual([
      { seatId: 0, role: 'civilian', word: '牛奶' },
      { seatId: 1, role: 'civilian', word: '牛奶' },
      { seatId: 2, role: 'undercover', word: '豆浆' },
      { seatId: 3, role: 'civilian', word: '牛奶' },
    ]);
    expect(toGodView(state).reveal).toHaveLength(4);
    expect(toGodView(state).seats).toEqual(toPublicView(state).seats);
  });

  it('上帝视角的日志保留内心独白，GodPanel 才有得展示', () => {
    const view = toGodView(withThoughts(newGame()));
    expect(view.log[0]).toMatchObject({ kind: 'speech', thought: SPEECH_THOUGHT });
    expect(view.log[1]).toMatchObject({ kind: 'vote', thought: VOTE_THOUGHT });
  });
});

describe('buildAgentView', () => {
  it('只给出自己的词和公开信息', () => {
    const state = newGame(2);
    const view = buildAgentView(state, 2);
    expect(view.seatId).toBe(2);
    expect(view.seatName).toBe('玩家2');
    expect(view.word).toBe('豆浆');
    expect(JSON.stringify(view.seats)).not.toContain('牛奶');
    expect(view.aliveOtherIds).toEqual([0, 1, 3]);
  });

  it('给 agent 的公开记录里没有任何人的内心独白（包括他自己的）', () => {
    const state = withThoughts(newGame(2));
    for (const seatId of [0, 1, 2, 3]) {
      const serialized = JSON.stringify(buildAgentView(state, seatId));
      expect(serialized).not.toContain('thought');
      expect(serialized).not.toContain(SPEECH_THOUGHT);
      expect(serialized).not.toContain(VOTE_THOUGHT);
    }
  });

  it('出局的人不出现在 aliveOtherIds 里', () => {
    const state = newGame(2);
    state.round = 1;
    eliminate(state, 1, false);
    expect(buildAgentView(state, 2).aliveOtherIds).toEqual([0, 3]);
  });
});
