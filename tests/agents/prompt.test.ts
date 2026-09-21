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
import type { AgentView, LogEntry } from '@/lib/game/types';

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

  it('绝不把任何人的内心独白写进给 agent 看的公开记录', () => {
    // 服务端日志里带着内心独白，渲染给模型的抄本必须把它整条挡掉。
    const log: LogEntry[] = [
      {
        kind: 'speech',
        round: 1,
        seatId: 0,
        text: '白白的，早上喝',
        fallback: false,
        thought: '我的词是牛奶，先别说透',
      },
      {
        kind: 'vote',
        round: 1,
        ballot: 1,
        seatId: 0,
        targetSeatId: 1,
        reason: '他太笼统',
        fallback: false,
        thought: '我怀疑他拿的是豆浆',
      },
    ];

    const transcript = renderTranscript({ ...VIEW, log });

    expect(transcript).toBe(
      ['第1轮 发言 阿岚：白白的，早上喝', '第1轮 投票 阿岚 → 小柯，理由：他太笼统'].join('\n'),
    );
    expect(transcript).not.toContain('牛奶');
    expect(transcript).not.toContain('豆浆');
    expect(transcript).not.toContain('thought');
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
    expect(messages[1].content).toContain('{"thought":"你的内心推理","speech":"你的发言"}');
    expect(messages[1].content).toContain('1=小柯（已出局）');
  });

  it('说明 thought 是私密的、可以提到自己的词，speech 才是公开的', () => {
    const content = buildSpeechMessages(PERSONAS[2], VIEW)[1].content;
    expect(content).toContain('thought');
    expect(content).toContain('不会给任何人看');
  });

  it('已有人发言时，thought 按「猜另一张词 → 判平民或卧底 → 定策略 → 规划发言」的顺序推理', () => {
    const content = buildSpeechMessages(PERSONAS[2], VIEW)[1].content;
    const guess = content.indexOf('另一张词可能是什么');
    const side = content.indexOf('我更像平民还是卧底');
    // speechStrategy 里也讲了两种打法，这里认 thoughtPlan 独有的第三步措辞。
    const strategy = content.indexOf('偏平民就写清');
    const plan = content.indexOf('最后才说你这轮打算藏什么');

    expect(guess).toBeGreaterThan(-1);
    expect(side).toBeGreaterThan(guess);
    expect(strategy).toBeGreaterThan(side);
    expect(plan).toBeGreaterThan(strategy);
  });

  it('允许猜错另一张词，并要求在 thought 里把猜的词直说出来', () => {
    const content = buildSpeechMessages(PERSONAS[2], VIEW)[1].content;
    expect(content).toContain('猜错');
    expect(content).toContain('你猜的另一张词');
  });

  it('偏平民走试探埋钩，偏卧底按猜到的多数词伪装、只说两边都成立的话', () => {
    const content = buildSpeechMessages(PERSONAS[2], VIEW)[1].content;
    expect(content).toMatch(/偏平民.*试探|试探.*钩/);
    expect(content).toContain('偏卧底');
    expect(content).toContain('两边都成立');
    expect(content).toContain('独特点');
  });

  it('多数与自己同边偏平民、多数对不上偏卧底的判据写进提示词', () => {
    const content = buildSpeechMessages(PERSONAS[2], VIEW)[1].content;
    expect(content).toMatch(/多数.*同.*边.*偏平民/);
    expect(content).toMatch(/多数.*对不上.*偏卧底/);
  });

  it('自己是第一个开口的人时不要求对齐判断，只规划自己的发言', () => {
    const content = buildSpeechMessages(PERSONAS[2], { ...VIEW, round: 1, log: [] })[1].content;
    expect(content).toContain('还没有人发言');
    expect(content).not.toContain('另一张词可能是什么');
    expect(content).not.toContain('我更像平民还是卧底');
  });

  it('只有投票和出局、没人发过言时，同样按第一个开口的人处理', () => {
    // 首轮平票重投后有人出局，日志非空但一条发言都没有：没有可对齐的话可听。
    const content = buildSpeechMessages(PERSONAS[2], {
      ...VIEW,
      log: [
        { kind: 'vote', round: 1, ballot: 1, seatId: 0, targetSeatId: 1, reason: '他太笼统', fallback: false },
        { kind: 'elimination', round: 1, seatId: 1, tieBreak: true },
      ],
    })[1].content;
    expect(content).toContain('还没有人发言');
    expect(content).not.toContain('另一张词可能是什么');
  });

  it('有前人发言时要求判断自己偏平民还是偏卧底，并禁止挤同一个场景', () => {
    const content = buildSpeechMessages(PERSONAS[2], VIEW)[1].content;
    expect(content).toMatch(/平民|卧底/);
    expect(content).toMatch(/同一.*场景|挤/);
    // 自觉偏卧底时的伪装策略：贴多数人的说法框架，避开只属于自己词的独特点。
    expect(content).toContain('借用');
    expect(content).toContain('独特点');
  });

  it('自己是第一个开口的人时不谈伪装，没人可贴', () => {
    const content = buildSpeechMessages(PERSONAS[2], { ...VIEW, round: 1, log: [] })[1].content;
    expect(content).not.toContain('借用');
    expect(content).not.toContain('独特点');
  });

  it('有 speechAngle 时注入 label 与 hint', () => {
    const content = buildSpeechMessages(PERSONAS[2], {
      ...VIEW,
      speechAngle: { id: 'habit', label: '个人小习惯', hint: '一个很小的个人习惯' },
    })[1].content;
    expect(content).toContain('本轮你的发言角度是「个人小习惯」');
    expect(content).toContain('一个很小的个人习惯');
  });

  it('无 speechAngle 时不出现角度硬约束套话', () => {
    expect(buildSpeechMessages(PERSONAS[2], VIEW)[1].content).not.toMatch(/本轮你的发言角度/);
  });


  it('两种情形下 thought 都允许写出自己的词，speech 仍禁止泄词', () => {
    const views: AgentView[] = [VIEW, { ...VIEW, round: 1, log: [] }];
    for (const view of views) {
      const content = buildSpeechMessages(PERSONAS[2], view)[1].content;
      expect(content).toContain('可以直接写出你的词');
      expect(content).toContain('不会给任何人看');
      expect(content).toContain('绝对不能写出词面本身');
    }
  });
});

describe('buildVoteMessages', () => {
  it('user 消息里只列出候选座位', () => {
    const messages = buildVoteMessages(PERSONAS[2], VIEW, [0, 3]);
    expect(messages[1].content).toContain('可投的座位号：0（阿岚）、3（沉舟）');
    expect(messages[1].content).toContain('{"thought":"你的内心推理","vote":0,"reason":"一句话理由"}');
    expect(messages[1].content).not.toContain('2（雷子）');
  });

  it('提醒不要只因为对方没复述自己熟悉的场景就投票', () => {
    const content = buildVoteMessages(PERSONAS[2], VIEW, [0, 3])[1].content;
    expect(content).toMatch(/场景/);
    expect(content).toContain('相容');
  });

  it('投票依据是「谁更像另一张词」，thought 先猜词再判自己偏平民还是偏卧底', () => {
    const content = buildVoteMessages(PERSONAS[2], VIEW, [0, 3])[1].content;
    const guess = content.indexOf('另一张词可能是什么');
    const side = content.indexOf('我更像平民还是卧底');
    const pick = content.indexOf('更像「另一张词」的人');

    expect(guess).toBeGreaterThan(-1);
    expect(side).toBeGreaterThan(guess);
    expect(pick).toBeGreaterThan(side);
    expect(content).toMatch(/不.*只因为.*场景/);
  });

  it('公开的 reason 既不能说出词面，也不能说出猜到的另一张词', () => {
    const content = buildVoteMessages(PERSONAS[2], VIEW, [0, 3])[1].content;
    expect(content).toContain('不要说你猜到的另一张词');
    expect(content).toMatch(/reason 是公开的/);
  });

  it('投票也说明 thought 私密、reason 公开', () => {
    const content = buildVoteMessages(PERSONAS[2], VIEW, [0, 3])[1].content;
    expect(content).toContain('thought');
    expect(content).toContain('不会给任何人看');
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
  it('同时取出内心独白与发言，各自去掉首尾空白', () => {
    expect(parseSpeechReply('{"thought":"  先藏一手  ","speech":"  白白的，早上喝  "}', '豆浆')).toEqual({
      thought: '先藏一手',
      text: '白白的，早上喝',
    });
  });

  it('内心独白允许出现自己的词：那是私密推理，不会被别人看到', () => {
    expect(parseSpeechReply('{"thought":"我拿的是豆浆，得藏住","speech":"早上常喝的白色饮品"}', '豆浆')).toEqual({
      thought: '我拿的是豆浆，得藏住',
      text: '早上常喝的白色饮品',
    });
  });

  it('发言里出现自己的词时判为不合格，哪怕内心独白是干净的', () => {
    expect(parseSpeechReply('{"thought":"随便想想","speech":"我的词是豆浆"}', '豆浆')).toBeNull();
  });

  it('模型漏写 thought 时按空字符串处理，不影响发言', () => {
    expect(parseSpeechReply('{"speech":"白白的"}', '豆浆')).toEqual({ thought: '', text: '白白的' });
    expect(parseSpeechReply('{"thought":123,"speech":"白白的"}', '豆浆')).toEqual({
      thought: '',
      text: '白白的',
    });
  });

  it('speech 缺失或为空时返回 null', () => {
    expect(parseSpeechReply('{"thought":"想好了","speech":""}', '豆浆')).toBeNull();
    expect(parseSpeechReply('{"reason":"x"}', '豆浆')).toBeNull();
    expect(parseSpeechReply('不是 JSON', '豆浆')).toBeNull();
  });
});

describe('parseVoteReply', () => {
  it('拒绝在投票理由里泄露自己的词，但接受生活化的不泄词理由', () => {
    expect(parseVoteReply('{"vote":3,"reason":"他说的不像豆浆"}', [0, 3], '豆浆')).toBeNull();
    expect(parseVoteReply('{"vote":3,"reason":"他刚才说的，我平时还真没遇到过"}', [0, 3], '豆浆'))
      .toEqual({ targetSeatId: 3, reason: '他刚才说的，我平时还真没遇到过', thought: '' });
  });

  it('内心独白允许出现自己的词，公开理由仍然必须藏住', () => {
    expect(
      parseVoteReply('{"thought":"我的豆浆跟他说的对不上","vote":3,"reason":"他说得太顺了"}', [0, 3], '豆浆'),
    ).toEqual({ targetSeatId: 3, reason: '他说得太顺了', thought: '我的豆浆跟他说的对不上' });
    expect(
      parseVoteReply('{"thought":"我的豆浆跟他对不上","vote":3,"reason":"跟豆浆差太远"}', [0, 3], '豆浆'),
    ).toBeNull();
  });

  it('取出合法候选与理由', () => {
    expect(parseVoteReply('{"thought":"他最可疑","vote":3,"reason":"他最虚"}', [0, 3])).toEqual({
      targetSeatId: 3,
      reason: '他最虚',
      thought: '他最可疑',
    });
  });

  it('座位号是数字字符串也接受', () => {
    expect(parseVoteReply('{"vote":"0","reason":"稳"}', [0, 3])).toEqual({
      targetSeatId: 0,
      reason: '稳',
      thought: '',
    });
  });

  it('缺理由时补默认理由', () => {
    expect(parseVoteReply('{"vote":0}', [0, 3])).toEqual({
      targetSeatId: 0,
      reason: DEFAULT_VOTE_REASON,
      thought: '',
    });
  });

  it('投了不在候选里的座位时返回 null', () => {
    expect(parseVoteReply('{"vote":2,"reason":"就他"}', [0, 3])).toBeNull();
  });

  it('不是 JSON 时返回 null', () => {
    expect(parseVoteReply('我投 3 号', [0, 3])).toBeNull();
  });
});
