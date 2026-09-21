import type { AgentView, Persona, PublicSeat } from '@/lib/game/types';
import type { LlmMessage } from '@/lib/llm/types';

export const DEFAULT_VOTE_REASON = '（没有说明理由）';

function nameOf(seats: PublicSeat[], seatId: number): string {
  return seats.find((seat) => seat.id === seatId)?.name ?? `座位${seatId}`;
}

/** 类型上 AgentView.log 就已经是剥过内心独白的公开日志，这里只渲染公开字段。 */
export function renderTranscript(view: AgentView): string {
  if (view.log.length === 0) {
    return '（暂无公开记录）';
  }
  return view.log
    .map((entry) => {
      switch (entry.kind) {
        case 'speech':
          return `第${entry.round}轮 发言 ${nameOf(view.seats, entry.seatId)}：${entry.text}`;
        case 'vote': {
          // 平票重投是同一轮里的第二次投票，标出来模型才不会把它当成有人改票。
          const label = entry.ballot > 1 ? `第${entry.round}轮第${entry.ballot}次投票` : `第${entry.round}轮 投票`;
          return `${label} ${nameOf(view.seats, entry.seatId)} → ${nameOf(
            view.seats,
            entry.targetSeatId,
          )}，理由：${entry.reason}`;
        }
        case 'elimination':
          return `第${entry.round}轮 出局：${nameOf(view.seats, entry.seatId)}${
            entry.tieBreak ? '（平票随机）' : ''
          }`;
      }
    })
    .join('\n');
}

function renderRoster(view: AgentView): string {
  return view.seats
    .map((seat) => `${seat.id}=${seat.name}${seat.alive ? '' : '（已出局）'}`)
    .join('，');
}

/**
 * 两个字段出自同一次调用：thought 是私密的（只留在服务端日志与上帝视角），
 * speech / reason 才会公开。说清这条区别，模型才肯把真实判断写进 thought，
 * 而不是把它揉进公开发言里泄题。
 */
const THOUGHT_BRIEF =
  '你要同时给出两样东西：thought 是你的内心独白，只留在你自己脑子里，不会给任何人看，别的玩家、公开记录和时间线都读不到它；另一部分才是你公开说出口的话，桌上所有人都会看到。';

const RULES_BRIEF =
  '你正在玩「谁是卧底」。全场 4 人，其中 3 名平民拿到同一个词，1 名卧底拿到一个有关联但不同的词。没有人知道自己是不是卧底。词可能是物品、人物、行为或处境，同一句话可能说的是两回事，不要认定大家都在说同一种场景。';

function speechStrategy(view: AgentView): string {
  const pacing = view.round === 1
    ? '首轮先藏一点：只聊一个宽泛但真实的生活场景、感受或小习惯，给同词的人一点共鸣就收住。不要上来就报最有辨识度的外形、数字、习性组合。'
    : '这轮可以比上一轮多补一点：给一个新的小细节，别重复原话，也别把关键特征一次说齐。前后要自洽，不能看别人说什么就改口。';
  const hasPriorSpeech = view.log.some((entry) => entry.kind === 'speech');
  const underSuspicion = view.log.some(
    (entry) => entry.kind === 'vote' && !entry.fallback && entry.targetSeatId === view.seatId,
  );
  return [
    pacing,
    hasPriorSpeech
      ? '先在心里判断自己和大家像不像同一个词，不要宣布自己的身份。觉得对方和你同边，认下这个方向就够了：别跟着挤同一个生活场景，换个角度补一句新的，不要复述他讲过的细节。'
      : '你是第一个开口的人：先在心里想好自己从哪条线起头，不要宣布自己的身份，也别急着把最有辨识度的点抛出来，给后面的人留出别的角度。',
    // 「猜另一张词 → 判自己偏哪边 → 定说法」全靠这段提示词推动，服务端不注入任何身份信息。
    ...(hasPriorSpeech
      ? [
          '有人已经先说过了，所以先在心里过两步：一是根据他们的说法猜一猜另一张词可能是什么，二是判断自己更像平民还是卧底——多数人的说法和你的词是同一边就偏平民，多数人的说法都和你的词对不上就偏卧底。',
          '偏平民就往前顶一点：用试探的口气埋个钩子，说一句同词的人接得上、拿另一张词的人接不住的小细节，等着看谁接不上。',
          '偏卧底就转成伪装：按你猜到的那张多数词来组织这句发言，优先借用多数人已经用过的说法框架，只说两边都成立的话；不要主动强调“你们说的我都对不上”，也不要硬编自己的词没有的特点，更不能抛只有你的词才成立的独特点。',
        ]
      : []),
    '藏词不等于空话：每次仍要给一点能聊下去的真实信息，不能只说“很常见”“挺有用”，也不要只催别人发言。被点名时先自然回应，再补一小点即可。',
    '不要每次都以“我也”“那味儿我懂”“他说的我有同感”开头。前面的人聊过某种气味、外形或经历，就换个生活角度，别整桌围着同一个细节跟读。',
    ...(underSuspicion
      ? ['公开记录里有人投过你：可以用一小点生活细节回应他的疑问，别着急报出决定性特征来证明清白。']
      : []),
  ].join('\n');
}

/**
 * 推理链得有话可推：公开记录里一条发言都没有时（自己是第一个开口的人），
 * 再逼它猜另一张词、判断自己偏哪边，只会凭空编出一个答案，所以那种局面只让它规划自己怎么说。
 */
function thoughtPlan(view: AgentView): string {
  const hasPriorSpeech = view.log.some((entry) => entry.kind === 'speech');
  if (!hasPriorSpeech) {
    return 'thought 写 1~3 句你真正的判断：现在还没有人发言，没有别人的说法可推，别凭空猜另一张词、也别凭空猜谁跟你一边，只规划你这轮自己先说什么、藏什么。这里可以直接写出你的词，因为不会给任何人看。';
  }
  return 'thought 写 3~5 句你真正的判断，严格按这个顺序推理：第一步，根据别人已经说过的话猜一句「另一张词可能是什么」，把猜的那个词直接写出来，猜错也没关系，写上就行；第二步，回答一句「我更像平民还是卧底」——多数人的说法和我的词是同一边就偏平民，多数人的说法都和我的词对不上就偏卧底；第三步，照这个判断定说法：偏平民就写清这轮怎么试探、往话里埋个什么钩子，偏卧底就写清怎么按猜到的那张多数词伪装、贴谁的说法、避开哪个只有自己词才成立的独特点；最后才说你这轮打算藏什么、怎么说。这里可以直接写出你的词和你猜的另一张词，因为不会给任何人看。';
}

/**
 * 本轮分到的发言角度：裁判给每位存活玩家岔开一条线，免得整桌围着同一个生活场景聊。
 * 它是这位玩家的私有信息，只出现在他自己的提示词里。
 */
function angleConstraint(view: AgentView): string[] {
  const angle = view.speechAngle;
  if (!angle) {
    return [];
  }
  return [
    `本轮你的发言角度是「${angle.label}」：${angle.hint}。speech 必须落在这个角度；不要改聊别人已经占满的同一场景。thought 里可以提及其他角度，但 speech 只走这一条。`,
  ];
}

export function buildSpeechMessages(persona: Persona, view: AgentView): LlmMessage[] {
  return [
    { role: 'system', content: persona.systemPrompt },
    {
      role: 'user',
      content: [
        RULES_BRIEF,
        `你是 ${view.seatName}（座位 ${view.seatId}）。你拿到的词是「${view.word}」。`,
        `座位表：${renderRoster(view)}`,
        `现在是第 ${view.round} 轮发言。到目前为止的公开记录：`,
        renderTranscript(view),
        speechStrategy(view),
        ...angleConstraint(view),
        THOUGHT_BRIEF,
        thoughtPlan(view),
        'speech 只写 1~2 句生活里的短话，尽量 20~45 个汉字，说完就收，不必每次都反问大家。不要列清单或做总结。绝对不能写出词面本身，也不能拆字、谐音或拼音暗示；不要复述别人的原句。',
        '只输出 JSON，格式严格为：{"thought":"你的内心推理","speech":"你的发言"}',
      ].join('\n'),
    },
  ];
}

/** 本轮已经投过几次，这次就是第几+1 次；视图里的日志只含已完成的那几次投票。 */
function ballotOf(view: AgentView): number {
  return view.log.reduce(
    (next, entry) =>
      entry.kind === 'vote' && entry.round === view.round ? Math.max(next, entry.ballot + 1) : next,
    1,
  );
}

export function buildVoteMessages(
  persona: Persona,
  view: AgentView,
  candidateIds: number[],
): LlmMessage[] {
  const ballot = ballotOf(view);
  const candidates = candidateIds
    .map((seatId) => `${seatId}（${nameOf(view.seats, seatId)}）`)
    .join('、');
  return [
    { role: 'system', content: persona.systemPrompt },
    {
      role: 'user',
      content: [
        RULES_BRIEF,
        `你是 ${view.seatName}（座位 ${view.seatId}）。你拿到的词是「${view.word}」。`,
        `座位表：${renderRoster(view)}`,
        ballot > 1
          ? `现在是第 ${view.round} 轮第 ${ballot} 次投票：上一次投票平票，需要在并列的人里重投一次。到目前为止的公开记录：`
          : `现在是第 ${view.round} 轮投票。到目前为止的公开记录：`,
        renderTranscript(view),
        `可投的座位号：${candidates}。你必须从中选一个，不能弃票，不能投自己。`,
        '投票理由也是公开发言：一句口语就够，只挑对方真正说过的一处让你犯嘀咕的地方，不做长篇判案。绝不能报出自己的词面，也不要说你猜到的另一张词，更不能用完整定义暗示答案。',
        '你也可能拿了不同的词，别默认自己一定是平民。想想谁前后改口、谁跟着别人说、谁的生活细节不太搭；有理由地选人，不必为了与多数人一致就暴露自己的词。',
        '别照搬前面玩家的投票理由；已经有人投他不算新证据。小时候和长大后的感受不同，不等于前后矛盾；没把握就承认是在猜，别为了投票硬编破绽。',
        '投票依据只有一条：谁的说法更像你猜到的那张另一张词，就投谁。不要只因为对方没复述你熟悉的那个场景就投票；先看他的细节是否和你的词相容。',
        THOUGHT_BRIEF,
        'thought 写 2~4 句你真正的推理，严格按这个顺序：第一步，根据大家说过的话猜一句「另一张词可能是什么」，把猜的词直接写出来，猜错也没关系；第二步，回答一句「我更像平民还是卧底」——多数人的说法和我的词是同一边就偏平民，多数人的说法都和我的词对不上就偏卧底；第三步，照这个判断挑人：投那个说法更像「另一张词」的人，而不是投你最看不懂的人。这里可以直接写出你的词和你猜的另一张词，因为不会给任何人看；reason 是公开的，必须藏住词面，也不能说出你猜的那张词。',
        '只输出 JSON，格式严格为：{"thought":"你的内心推理","vote":0,"reason":"一句话理由"}',
      ].join('\n'),
    },
  ];
}

/**
 * 扫出所有花括号配对完整的顶层片段（字符串里的花括号不参与配对）。
 * 「第一个 { 到最后一个 }」的老做法会把前后废话里的花括号一起圈进来，
 * 比如「之前有人说 { 像牛奶 } 但我选 {"speech":"…"}」整段都解析不了。
 */
function balancedCandidates(text: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        candidates.push(text.slice(start, i + 1));
      }
    }
  }
  return candidates;
}

/**
 * 取最后一个能解析成对象的候选：模型习惯先说废话再给 JSON，
 * 被要求改写时也常把最终答案放在末尾，最后一个可解析的片段才是它真正想交的。
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const withoutFence = raw.replace(/```(?:json)?/gi, '');
  const candidates = balancedCandidates(withoutFence);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidates[i]);
    } catch {
      continue;
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * thought 是私密字段，所以它不参与藏词校验：
 * 模型本来就该在内心独白里直呼自己的词来推理。漏写或写成非字符串都按空处理，
 * 不能因为少了一段内心戏就把一条合格发言判死。
 */
function parseThought(parsed: Record<string, unknown>): string {
  return typeof parsed.thought === 'string' ? parsed.thought.trim() : '';
}

export function parseSpeechReply(
  raw: string,
  forbiddenWord: string,
): { text: string; thought: string } | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return null;
  }
  const speech = parsed.speech;
  if (typeof speech !== 'string') {
    return null;
  }
  const text = speech.trim();
  if (text === '' || text.includes(forbiddenWord)) {
    return null;
  }
  return { text, thought: parseThought(parsed) };
}


/** 说明 parseVoteReply 为何判不合格，给投票兜底理由用（公开可见，勿回填模型原文）。 */
export function diagnoseVoteFailure(
  raw: string | null,
  candidateIds: number[],
  forbiddenWord?: string,
): string {
  if (raw === null || raw.trim() === '') {
    return '模型调用失败或返回空';
  }
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return '输出不是合法 JSON';
  }
  const rawVote = parsed.vote;
  const targetSeatId =
    typeof rawVote === 'number' ? rawVote : typeof rawVote === 'string' ? Number(rawVote) : Number.NaN;
  if (!Number.isInteger(targetSeatId)) {
    return 'vote 不是整数座位号';
  }
  if (!candidateIds.includes(targetSeatId)) {
    return `vote=${targetSeatId} 不在候选 ${candidateIds.join('、')}`;
  }
  const rawReason = parsed.reason;
  if (
    forbiddenWord &&
    typeof rawReason === 'string' &&
    rawReason.includes(forbiddenWord)
  ) {
    return '公开理由写出了自己的词';
  }
  return '投票未通过校验';
}

export function parseVoteReply(
  raw: string,
  candidateIds: number[],
  forbiddenWord?: string,
): { targetSeatId: number; reason: string; thought: string } | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return null;
  }
  const rawVote = parsed.vote;
  const targetSeatId =
    typeof rawVote === 'number' ? rawVote : typeof rawVote === 'string' ? Number(rawVote) : Number.NaN;
  if (!Number.isInteger(targetSeatId) || !candidateIds.includes(targetSeatId)) {
    return null;
  }
  const rawReason = parsed.reason;
  const reason = typeof rawReason === 'string' && rawReason.trim() !== '' ? rawReason.trim() : DEFAULT_VOTE_REASON;
  if (forbiddenWord && reason.includes(forbiddenWord)) {
    return null;
  }
  return { targetSeatId, reason, thought: parseThought(parsed) };
}
