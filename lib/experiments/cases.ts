import { PERSONAS } from '@/lib/agents/personas';
import type { AgentView, LogEntry } from '@/lib/game/types';

export interface ThinkingCase {
  id: string;
  split: 'train' | 'holdout';
  word: string;
  seatId: number;
  initial: [string, string];
  later: [string, string];
  thirdInitial?: string;
  thirdLater?: string;
  rubric: string;
}

// Fixed before the first comparison. These are behavioral probes, not full-game win-rate trials.
export const CASES: ThinkingCase[] = [
  { id: 'pencil-exposure', split: 'train', word: '铅笔', seatId: 0,
    initial: ['上学时老找同桌借，自己带的总不见。', '我喜欢把常用的放手边，不然要用时就找不到。'],
    later: ['我那支一漏就把包里弄脏了，洗了好久。', '我后来习惯用完就盖上，省得弄得哪儿都是。'],
    thirdInitial: '我的老是被人顺手借走，最后还得自己去找。', thirdLater: '我习惯搁抽屉，桌上太乱，一不小心就扫地上了。',
    rubric: '考察自己可能是少数时是否仍给真实生活信息。首轮“越用越短/削/橡皮擦”过于唯一；后面不要假装自己的词有墨水或笔帽，也不要反复只说忘带。' },
  { id: 'care-or-control', split: 'train', word: '关心', seatId: 1,
    initial: ['我不回消息，对面能连着打好几个电话。', '有时候刚到家就得交代一遍今天去了哪儿。'],
    later: ['上次加完班，对方给我留了口热的，我挺受用。', '也有真着急的，不能只看问了几遍吧。'],
    thirdInitial: '换我遇到这事，先把手机拿出来看看再说。', thirdLater: '我倒觉得愿不愿意听你解释也挺重要的。',
    rubric: '别将生活经历不同视为矛盾。新证据出现后应降低“一直在控制”的确定性，同时保持自身真实。不可直接说另一张词查岗。' },
  { id: 'interview-overlap', split: 'train', word: '相亲', seatId: 2,
    initial: ['去之前挑衣服挑半天，到那儿还得装自然。', '坐下来就问一堆情况，我都不知道从哪说起。'],
    later: ['完事说回去等消息，我就知道八成没下文了。', '我那次连以后怎么打算的都被问了一遍。'],
    thirdInitial: '我一般会提前几分钟到，免得一上来就不好意思。', thirdLater: '我出来第一件事就是找朋友吐槽，在里面憋得够呛。',
    rubric: '共享场景不能草率判断同词；别直接说结婚、对象或面试。保持个人角度和短话，不要只重复紧张、问问题。' },
  { id: 'nostalgia-not-contradiction', split: 'train', word: '咖啡', seatId: 3,
    initial: ['我小时候嫌苦，现在天天惦记。', '我通常忙起来才想起它，也不是天天都要。'],
    later: ['刚才说的小时候是小时候，现在我真习惯了。', '我平时确实不碰，都是周末歇着时才来一点。'],
    thirdInitial: '我挺看当天心情，有时候忙起来就顾不上了。', thirdLater: '我还是那样，想起来才去弄，忘了也就算了。',
    rubric: '年龄变化不是矛盾；“忙起来”到“都是周末歇着”是更值得澄清的同一人说法变化。不能为了投票虚构原话。' },
  { id: 'holdout-sleep', split: 'holdout', word: '失眠', seatId: 1,
    initial: ['第二天起不来，闹钟响了跟没响一样。', '我隔天照镜子都觉得脸色不对。'],
    later: ['我是明知道该停了，还想再看一集。', '我也老想着马上就结束，结果又多刷了半小时。'],
    thirdInitial: '我第二天一坐车就开始打盹，差点坐过站。', thirdLater: '我后来把闹钟放远一点，总算能逼自己起来走两步。',
    rubric: '区别主动晚睡与睡不着；不要为融入伪造自己主动刷剧，也别用“想睡睡不着”直接给定义。补真实非唯一的小细节。' },
  { id: 'holdout-request', split: 'holdout', word: '请假', seatId: 0,
    initial: ['我都得提前看日历，赶上忙的时候特别难开口。', '我每回都想凑着周末，能多歇一天是一天。'],
    later: ['我这几天是之前周末来公司的时候攒下来的。', '我也是有余额才敢开口，没有就没法换。'],
    thirdInitial: '我每次都先找同事商量，手头的事总得有人接一下。', thirdLater: '我那回回来先翻了一遍群消息，怕漏了什么。',
    rubric: '意识到别人可能说调休，但不能宣布猜词；自身词可能包含多种事由，不因不同经历就判定对方撒谎。' },
];

export function caseView(c: ThinkingCase, stage: number, ownActions: LogEntry[], sparse = false): AgentView {
  const others = [0, 1, 2, 3].filter((id) => id !== c.seatId);
  const speech = (round: number, seatId: number, text: string): LogEntry => ({ kind: 'speech', round, seatId, text, fallback: false });
  const log: LogEntry[] = c.initial.map((text, i) => speech(1, others[i], text));
  if (!sparse && c.thirdInitial) log.push(speech(1, others[2], c.thirdInitial));
  if (stage > 0) {
    log.push(...ownActions.filter((e) => e.round === 1));
    log.push({ kind: 'vote', round: 1, ballot: 1, seatId: others[2], targetSeatId: c.seatId, reason: '先猜你吧，我还没听太明白。', fallback: false });
    log.push(...c.later.map((text, i) => speech(2, others[i], text)));
    if (!sparse && c.thirdLater) log.push(speech(2, others[2], c.thirdLater));
    log.push(...ownActions.filter((e) => e.round === 2));
  }
  return { seatId: c.seatId, seatName: PERSONAS[c.seatId].name, word: c.word, round: stage === 0 ? 1 : 2,
    seats: PERSONAS.map((p, id) => ({ id, name: p.name, personaLabel: p.label, alive: true })), aliveOtherIds: others, log };
}
