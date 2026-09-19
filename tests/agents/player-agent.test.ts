import { describe, expect, it, vi } from 'vitest';

import { PERSONAS } from '@/lib/agents/personas';
import {
  FALLBACK_SPEECH,
  FALLBACK_VOTE_REASON,
  PlayerAgent,
} from '@/lib/agents/player-agent';
import type { AgentView } from '@/lib/game/types';
import type { LlmClient } from '@/lib/llm/types';

const VIEW: AgentView = {
  seatId: 2,
  seatName: '雷子',
  word: '豆浆',
  round: 1,
  seats: [
    { id: 0, name: '阿岚', personaLabel: '谨慎分析', alive: true },
    { id: 1, name: '小柯', personaLabel: '幽默带节奏', alive: true },
    { id: 2, name: '雷子', personaLabel: '激进带节奏', alive: true },
    { id: 3, name: '沉舟', personaLabel: '少话观察', alive: true },
  ],
  log: [],
  aliveOtherIds: [0, 1, 3],
};

function scriptedLlm(replies: Array<string | Error>): LlmClient & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async () => {
    const next = replies.shift();
    if (next === undefined) {
      throw new Error('脚本用尽：不应该再调用模型');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  return { complete } as unknown as LlmClient & { complete: ReturnType<typeof vi.fn> };
}

describe('PlayerAgent.speak', () => {
  it('第一次就合格时直接返回，只调用一次模型', async () => {
    const llm = scriptedLlm(['{"speech":"早上常喝的白色饮品"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早上常喝的白色饮品',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('首次输出念出词面时重试一次并采用第二次结果', async () => {
    const llm = scriptedLlm(['{"speech":"我的词就是豆浆"}', '{"speech":"早上常喝的白色饮品"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早上常喝的白色饮品',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('两次都不合格时兜底为空发言并标记 fallback', async () => {
    const llm = scriptedLlm(['乱七八糟', '还是乱七八糟']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.speak(VIEW)).resolves.toEqual({ text: FALLBACK_SPEECH, fallback: true });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('模型连续抛错时也兜底，不向外抛', async () => {
    const llm = scriptedLlm([new Error('网络炸了'), new Error('又炸了')]);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.speak(VIEW)).resolves.toEqual({ text: FALLBACK_SPEECH, fallback: true });
  });
});

describe('PlayerAgent.vote', () => {
  it('合法投票直接返回', async () => {
    const llm = scriptedLlm(['{"vote":1,"reason":"描述太笼统"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.vote(VIEW, [0, 1, 3], () => 0)).resolves.toEqual({
      targetSeatId: 1,
      reason: '描述太笼统',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('投了非候选座位时重试一次', async () => {
    const llm = scriptedLlm(['{"vote":2,"reason":"投自己"}', '{"vote":3,"reason":"他太安静"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.vote(VIEW, [0, 1, 3], () => 0)).resolves.toEqual({
      targetSeatId: 3,
      reason: '他太安静',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('两次都不合格时按 rng 随机投一个合法候选', async () => {
    const llm = scriptedLlm(['不是 JSON', '还是不是 JSON']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.vote(VIEW, [0, 1, 3], () => 0.99)).resolves.toEqual({
      targetSeatId: 3,
      reason: FALLBACK_VOTE_REASON,
      fallback: true,
    });
  });

  it('候选为空时抛错（Judge 不应该这样调用）', async () => {
    const llm = scriptedLlm(['不是 JSON', '还是不是 JSON']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.vote(VIEW, [], () => 0)).rejects.toThrow('无法从空列表中随机选取');
  });
});
