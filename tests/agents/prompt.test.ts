import { describe, expect, it } from 'vitest';

import { PERSONAS } from '@/lib/agents/personas';
import {
  DEFAULT_VOTE_REASON,
  buildSpeechMessages,
  buildVoteMessages,
  extractJsonObject,
  parseSpeechReply,
  parseVoteReply,
  renderTranscript,
} from '@/lib/agents/prompt';
import type { AgentView } from '@/lib/game/types';

const VIEW: AgentView = {
  seatId: 2,
  seatName: '雷子',
  word: '豆浆',
  round: 2,
  seats: [
    { id: 0, name: '阿岚', personaLabel: '谨慎分析', alive: true },
    { id: 1, name: '小柯', personaLabel: '幽默带节奏', alive: false },
    { id: 2, name: '雷子', personaLabel: '激进带节奏', alive: true },
    { id: 3, name: '沉舟', personaLabel: '少话观察', alive: true },
  ],
  log: [
    { kind: 'speech', round: 1, seatId: 0, text: '白白的，早上喝', fallback: false },
    { kind: 'vote', round: 1, ballot: 1, seatId: 0, targetSeatId: 1, reason: '他太笼统', fallback: false },
    { kind: 'elimination', round: 1, seatId: 1, tieBreak: true },
  ],
  aliveOtherIds: [0, 3],
};

describe('PERSONAS', () => {
  it('恰好 4 套人设，id 与名字都不重复', () => {
    expect(PERSONAS).toHaveLength(4);
    expect(new Set(PERSONAS.map((persona) => persona.id)).size).toBe(4);
    expect(new Set(PERSONAS.map((persona) => persona.name)).size).toBe(4);
  });
});

describe('renderTranscript', () => {
  it('把三类日志渲染成带玩家名的中文行', () => {
    expect(renderTranscript(VIEW)).toBe(
      [
        '第1轮 发言 阿岚：白白的，早上喝',
        '第1轮 投票 阿岚 → 小柯，理由：他太笼统',
        '第1轮 出局：小柯（平票随机）',
      ].join('\n'),
    );
  });

  it('没有记录时给出占位文案', () => {
    expect(renderTranscript({ ...VIEW, log: [] })).toBe('（暂无公开记录）');
  });

  it('平票重投的那一次单独标出来，不会被当成改票', () => {
    const lines = renderTranscript({
      ...VIEW,
      log: [
        { kind: 'vote', round: 1, ballot: 1, seatId: 0, targetSeatId: 1, reason: '他太笼统', fallback: false },
        { kind: 'vote', round: 1, ballot: 2, seatId: 0, targetSeatId: 3, reason: '重投改投他', fallback: false },
      ],
    }).split('\n');

    expect(lines[0]).toBe('第1轮 投票 阿岚 → 小柯，理由：他太笼统');
    expect(lines[1]).toBe('第1轮第2次投票 阿岚 → 沉舟，理由：重投改投他');
  });
});

describe('buildSpeechMessages', () => {
  it('首轮给出保守开口策略，后续轮次才要求补充细节', () => {
    const opening = buildSpeechMessages(PERSONAS[2], { ...VIEW, round: 1, log: [] })[1].content;
    const later = buildSpeechMessages(PERSONAS[2], VIEW)[1].content;
    expect(opening).toContain('首轮先藏一点');
    expect(opening).not.toContain('比上一轮多补一点');
    expect(later).toContain('比上一轮多补一点');
    expect(later).not.toContain('首轮先藏一点');
  });

  it('被投过票时提醒温和自辩，不把其他人的受怀疑状态套到自己身上', () => {
    const unchallenged = buildSpeechMessages(PERSONAS[2], VIEW)[1].content;
    const challenged = buildSpeechMessages(PERSONAS[2], {
      ...VIEW,
      log: [...VIEW.log, { kind: 'vote', round: 1, ballot: 1, seatId: 3, targetSeatId: 2, reason: '他太直白', fallback: false }],
    })[1].content;
    expect(unchallenged).not.toContain('有人投过你');
    expect(challenged).toContain('有人投过你');
    expect(challenged).toContain('他太直白');
  });

  it('第一条是人设 system，第二条 user 含自己的词、轮次与公开记录', () => {
    const messages = buildSpeechMessages(PERSONAS[2], VIEW);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'system', content: PERSONAS[2].systemPrompt });
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('你拿到的词是「豆浆」');
    expect(messages[1].content).toContain('第 2 轮发言');
    expect(messages[1].content).toContain('白白的，早上喝');
    expect(messages[1].content).toContain('{"speech":"你的发言"}');
    expect(messages[1].content).toContain('1=小柯（已出局）');
  });
});

describe('buildVoteMessages', () => {
  it('user 消息里只列出候选座位', () => {
    const messages = buildVoteMessages(PERSONAS[2], VIEW, [0, 3]);
    expect(messages[1].content).toContain('可投的座位号：0（阿岚）、3（沉舟）');
    expect(messages[1].content).toContain('{"vote":0,"reason":"一句话理由"}');
    expect(messages[1].content).not.toContain('2（雷子）');
  });
});

describe('extractJsonObject', () => {
  it('解析裸 JSON', () => {
    expect(extractJsonObject('{"speech":"白白的"}')).toEqual({ speech: '白白的' });
  });

  it('剥掉 Markdown 代码块与前后废话', () => {
    expect(extractJsonObject('好的：\n```json\n{"speech":"白白的"}\n```\n')).toEqual({
      speech: '白白的',
    });
  });

  it('不是 JSON 时返回 null', () => {
    expect(extractJsonObject('我觉得是 1 号')).toBeNull();
  });

  it('JSON 数组不算合法对象', () => {
    expect(extractJsonObject('[1,2]')).toBeNull();
  });

  it('前面的废话里有花括号时也能取到真正的 JSON', () => {
    expect(extractJsonObject('之前有人说 { 像牛奶 } 但我选 {"speech":"白白的"}')).toEqual({
      speech: '白白的',
    });
  });

  it('JSON 后面又跟了一段带花括号的废话时仍取到 JSON', () => {
    expect(extractJsonObject('{"speech":"白白的"}\n（备注 { 随便写的 }）')).toEqual({
      speech: '白白的',
    });
  });

  it('字符串里的花括号不影响配对', () => {
    expect(extractJsonObject('{"speech":"他说 } 的时候我愣了下"}')).toEqual({
      speech: '他说 } 的时候我愣了下',
    });
  });

  it('嵌套对象完整保留', () => {
    expect(extractJsonObject('好的 {"vote":1,"meta":{"sure":false},"reason":"太笼统"}')).toEqual({
      vote: 1,
      meta: { sure: false },
      reason: '太笼统',
    });
  });

  it('花括号没闭合时返回 null', () => {
    expect(extractJsonObject('{"speech":"白白的"')).toBeNull();
  });
});

describe('parseSpeechReply', () => {
  it('取出 speech 并去掉首尾空白', () => {
    expect(parseSpeechReply('{"speech":"  白白的，早上喝  "}', '豆浆')).toBe('白白的，早上喝');
  });

  it('发言里出现自己的词时判为不合格', () => {
    expect(parseSpeechReply('{"speech":"我的词是豆浆"}', '豆浆')).toBeNull();
  });

  it('speech 缺失或为空时返回 null', () => {
    expect(parseSpeechReply('{"speech":""}', '豆浆')).toBeNull();
    expect(parseSpeechReply('{"reason":"x"}', '豆浆')).toBeNull();
    expect(parseSpeechReply('不是 JSON', '豆浆')).toBeNull();
  });
});

describe('parseVoteReply', () => {
  it('拒绝在投票理由里泄露自己的词，但接受生活化的不泄词理由', () => {
    expect(parseVoteReply('{"vote":3,"reason":"他说的不像豆浆"}', [0, 3], '豆浆')).toBeNull();
    expect(parseVoteReply('{"vote":3,"reason":"他刚才说的，我平时还真没遇到过"}', [0, 3], '豆浆'))
      .toEqual({ targetSeatId: 3, reason: '他刚才说的，我平时还真没遇到过' });
  });

  it('取出合法候选与理由', () => {
    expect(parseVoteReply('{"vote":3,"reason":"他最虚"}', [0, 3])).toEqual({
      targetSeatId: 3,
      reason: '他最虚',
    });
  });

  it('座位号是数字字符串也接受', () => {
    expect(parseVoteReply('{"vote":"0","reason":"稳"}', [0, 3])).toEqual({
      targetSeatId: 0,
      reason: '稳',
    });
  });

  it('缺理由时补默认理由', () => {
    expect(parseVoteReply('{"vote":0}', [0, 3])).toEqual({
      targetSeatId: 0,
      reason: DEFAULT_VOTE_REASON,
    });
  });

  it('投了不在候选里的座位时返回 null', () => {
    expect(parseVoteReply('{"vote":2,"reason":"就他"}', [0, 3])).toBeNull();
  });

  it('不是 JSON 时返回 null', () => {
    expect(parseVoteReply('我投 3 号', [0, 3])).toBeNull();
  });
});
