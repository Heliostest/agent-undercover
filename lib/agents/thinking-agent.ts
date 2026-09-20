import { PlayerAgent, type PlayerAgentDeps } from '@/lib/agents/player-agent';
import { extractJsonObject } from '@/lib/agents/prompt';
import type { ThinkingStrategy } from '@/lib/agents/strategy';
import type { AgentView, Persona, SeatAgent } from '@/lib/game/types';
import { LlmResponseError, type LlmClient, type LlmMessage } from '@/lib/llm/types';

export const THINK_TIMEOUT_MS = 20_000;
export const EVIDENCE_PROMPT = `你是当前玩家的私人决策助手。只产生简短结构化决策摘要，不写推理过程或长篇独白。
任务：观察证据→保留不同解释→选择行动→说明何时修正。你不知道自己的身份，也不知道别人的词。
先核对上次判断与现在新增的公开信息。事实只能引用 records 中真实存在的原文；quote 必须是该条 text 或 reason 的连续原文。ref 是记录下标，从 0 开始。fallback 记录不能作为证据。
保留两个不同解释，包括“我自己可能是少数那方”；解释是猜测，不是事实。缺少证据时用空数组，不能编造谁改口、谁说过什么。别人投了谁不等于对方有罪。
选择本次目标（试探、融入、辩护、排疑之一），提出一个具体但不露底的表达方向。上一轮实际说过的话才是承诺，草稿不算。用新证据修正，不要每轮重复同一句话。
输出 JSON：{"observations":[{"ref":0,"quote":"原文"}],"hypotheses":[{"claim":"简短解释","evidence":[0]},{"claim":"另一种解释","evidence":[]}],"objective":"试探","actionHint":"本次表达方向","reconsiderWhen":"什么新证据会改变判断"}。
observations 最多 3 条；hypotheses 恰好 2 条，每个 evidence 最多 3 个 records 下标且必须已列入 observations；每个字符串最多 200 字。只输出这个 JSON。`;

// V2, added after round 1: evidence memory alone encouraged retaliatory votes and weak updates.
export const DELIBERATE_EXTENSION = `
在上述摘要上增加“行动比较”，修正以下常见误判：
1. 观察与解释分开：被人投过不是对方可疑的证据；记录没出现的发言也不是“他一直沉默”。如果找不到强证据，承认暂时猜测，不编罪名。年龄、习惯、场合不同不是矛盾；优先核对同一人在相同条件下确实说了不兼容的话。
2. 两种解释分别考虑“我的词可能与多数相同”和“我的词可能与多数不同”。不需强行猜另一张词；选择在两种解释下都不容易出局的行动。多数人用相似说法只能增加一种解释的可能性，不能证明身份。
3. 产生两个不同的候选行动，然后比较各自的信息收益和暴露风险。逐个检查：对我的词真实吗？是在复读、给定义、还是提供一点新的生活细节？如果我是少数，对面听完是否容易锁定我？不能为了融入认领不属于自己词的属性；也不能用唯一特征自证清白。
4. 反向检查：若我怀疑的人其实和我同词，他这句话有没有普通的合理解释？有则降低确定性；被投后的反击必须有独立原话依据。公开发言回应眼前疑问，避免每轮泛泛讲“忘带、常用”。允许有限度试探，不要不停催别人解释。
5. 更新记忆时，检查上一条 actualAction 与新记录；只保留还站得住的判断，说明新的 reconsiderWhen。草稿不是自己已经说过的话。
保持原有字段，并增加 choices（恰好两个对象）及 selected（0 或 1）。每个 choice 格式：{"text":"可直接公开的短发言或投票理由","benefit":"收益摘要","risk":"风险摘要","targetSeatId":null,"evidence":[]}。发言时 targetSeatId 为 null；投票时必须是 candidates 中的一个座位。evidence 引用 observations 中列出的原始 records 下标，没依据就空数组。所有字符串最多 200 字，text 尽量 20~45 字、不能出现自己的词面。selected 是比较后选择的方案。只输出简短决策结果，不输出完整推理过程。`;

export const ACTOR_BRIEF_PROMPT = '以下是你自己的私人决策摘要，不是权威事实。只用它帮助做决定，不要公开摘要、假设、词面或内部术语。仍遵守上面的 JSON 格式与生活口语要求。';
export const ACTOR_CHOICE_PROMPT = '只采用 selected 指定的公开方案，可按自己的性格把它说得更自然；不要加新的特征或扩大指控，不要复述未选方案、收益和风险。投票使用已选方案的 targetSeatId。';

export const ADAPTIVE_PROMPT = `你是当前玩家的私人决策助手。输出短小的决策记录，不输出推理过程。只知道自己的词和公开 records，不知道自己的身份或别人的词。
用以下循环：核对事实 → 两种解释 → 两个行动 → 比较后选择 → 下次用新证据修正。
事实：引用 records.id（例如 L0），绝不是 seatId。quote 原样摘录 text，不改写。忽略 fallback。上一份 previous.actualAction 是真正说过的话，草稿不是承诺；前后变化只有在同一人、同一条件下才算矛盾。
解释：一种考虑自己与多数同词，一种考虑自己可能不同词；都只是猜测。不必猜出另一张词。缺失记录不能证明沉默；被投票不是对方可疑的独立证据。新证据能推翻旧判断时要修正。
行动：给两个不同的、可直接公开的方案，各写一句收益和风险。发言必须补充一个符合自己词的新生活细节，不能只附和、反问或复述前人的细节。先选真实的生活行为，再降低独特程度：不要报定义、组成、标志性特征或多个线索组合；不能为了融入编造属性。被怀疑时也只补一点，别急着证明自己。
投票：每个方案的 evidence 必须包含目标本人至少一句 speech 的 L 编号，并列入 observations。先问那句话是否有普通的合理解释；有则用试探语气。优先处理确切的前后变化，不能只因他投过我、没回我的问题就投他。所有候选都没有发言记录时才允许空 evidence，并明确只是猜测。
比较：排除失真、露底、复读或无依据的方案；从剩下的方案中选能增加信息且两种身份下都较稳妥的一个。不要只求安全而选择空话。按性格自然说话，text 尽量 20~45 字。
仅输出 JSON：{"observations":[{"ref":"L0","quote":"原文"}],"hypotheses":[{"claim":"解释一","evidence":["L0"]},{"claim":"解释二","evidence":[]}],"objective":"这次要解决的问题","actionHint":"选中方案的表达方向","reconsiderWhen":"什么新证据会改变判断","choices":[{"text":"公开发言或投票理由","benefit":"具体收益","risk":"具体风险","targetSeatId":null,"evidence":[]},{"text":"另一个方案","benefit":"收益","risk":"风险","targetSeatId":null,"evidence":[]}],"selected":0}。
observations 最多3条，hypotheses 和 choices 各恰好2项，每项 evidence 最多3条且只用 observations 列过的 L 编号。所有字符串最多200字，text 不能出现自己的词面。selected 为0或1；发言时 targetSeatId 为 null，投票时为 candidates 中的座位数字。`;

export interface DecisionBrief {
  observations: { ref: number; quote: string }[];
  hypotheses: { claim: string; evidence: number[] }[];
  objective: string;
  actionHint: string;
  reconsiderWhen: string;
  choices?: { text: string; benefit: string; risk: string; targetSeatId: number | null; evidence: number[] }[];
  selected?: number;
}
const short = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseBrief(raw: string, view: AgentView): DecisionBrief | null {
  if (raw.length > 6000) return null;
  const b = extractJsonObject(raw);
  if (!b || !Array.isArray(b.observations) || b.observations.length > 3 || !Array.isArray(b.hypotheses) || b.hypotheses.length !== 2) return null;
  const observations: DecisionBrief['observations'] = [];
  for (const obs of b.observations) {
    if (!object(obs) || !Number.isInteger(obs.ref) || !short(obs.quote)) return null;
    const ref = obs.ref as number;
    const record = view.log[ref];
    if (!record || record.kind === 'elimination' || record.fallback) return null;
    const source = record.kind === 'speech' ? record.text : record.reason;
    if (!source.includes(obs.quote)) return null;
    observations.push({ ref, quote: obs.quote });
  }
  const refs = new Set(observations.map((o) => o.ref));
  const hypotheses: DecisionBrief['hypotheses'] = [];
  for (const h of b.hypotheses) {
    if (!object(h) || !short(h.claim) || !Array.isArray(h.evidence) || h.evidence.length > 3 || !h.evidence.every((r) => Number.isInteger(r) && refs.has(r))) return null;
    hypotheses.push({ claim: h.claim, evidence: h.evidence });
  }
  if (!short(b.objective) || !short(b.actionHint) || !short(b.reconsiderWhen)) return null;
  return { observations, hypotheses, objective: b.objective, actionHint: b.actionHint, reconsiderWhen: b.reconsiderWhen };
}

export function parseDeliberateBrief(raw: string, view: AgentView, phase: 'speak' | 'vote', candidates: number[]): DecisionBrief | null {
  const brief = parseBrief(raw, view);
  const b = extractJsonObject(raw);
  if (!brief || !b || !Array.isArray(b.choices) || b.choices.length !== 2 || (b.selected !== 0 && b.selected !== 1)) return null;
  const refs = new Set(brief.observations.map((o) => o.ref));
  const choices: NonNullable<DecisionBrief['choices']> = [];
  for (const c of b.choices) {
    if (!object(c) || !short(c.text) || c.text.includes(view.word) || !short(c.benefit) || !short(c.risk) || !Array.isArray(c.evidence) || c.evidence.length > 3 || !c.evidence.every((r) => refs.has(r))) return null;
    if (phase === 'speak' ? c.targetSeatId !== null : typeof c.targetSeatId !== 'number' || !candidates.includes(c.targetSeatId)) return null;
    choices.push({ text: c.text, benefit: c.benefit, risk: c.risk, targetSeatId: c.targetSeatId as number | null, evidence: c.evidence });
  }
  return { ...brief, choices, selected: b.selected };
}

export function parseAdaptiveBrief(raw: string, view: AgentView, phase: 'speak' | 'vote', candidates: number[]): DecisionBrief | null {
  if (raw.length > 6000) return null;
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;
  const id = (v: unknown) => typeof v === 'string' && /^L\d+$/.test(v) ? Number(v.slice(1)) : -1;
  const normalized = JSON.stringify(parsed, (key, value) => key === 'ref' ? id(value) : key === 'evidence' && Array.isArray(value) ? value.map(id) : value);
  const brief = parseDeliberateBrief(normalized, view, phase, candidates);
  if (!brief) return null;
  const hasSpeech = view.log.some((e) => e.kind === 'speech' && !e.fallback && candidates.includes(e.seatId));
  if (phase === 'vote' && hasSpeech && !brief.choices!.every((choice) => choice.evidence.some((ref) => {
    const e = view.log[ref];
    return e.kind === 'speech' && !e.fallback && e.seatId === choice.targetSeatId;
  }))) return null;
  return brief;
}

interface ThinkingDeps extends PlayerAgentDeps {
  /** Only status leaves the planner; no private brief is sent to game events. */
  onPlan?: (status: 'ok' | 'fallback') => void;
}

export class ThinkingAgent implements SeatAgent {
  private memory: { decision: DecisionBrief | null; actualAction: string } | null = null;
  constructor(private readonly persona: Persona, private readonly deps: ThinkingDeps, private readonly strategy: Exclude<ThinkingStrategy, 'baseline'>) {}

  private async plan(view: AgentView, phase: 'speak' | 'vote', candidates: number[]): Promise<DecisionBrief | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('planning timeout')); }, THINK_TIMEOUT_MS);
    });
    // Whitelist visible fields: never serialize GameState or LlmConfig.
    const input = {
      self: { seatId: view.seatId, name: view.seatName, word: view.word },
      round: view.round, phase, candidates, seats: view.seats,
      records: view.log.map((entry, ref) => this.strategy === 'adaptive' ? { id: `L${ref}`, ...entry } : { ref, ...entry }),
      previous: this.strategy === 'adaptive' ? JSON.parse(JSON.stringify(this.memory, (key, value) => key === 'ref' ? `L${value}` : key === 'evidence' && Array.isArray(value) ? value.map((n) => `L${n}`) : value)) : this.memory,
    };
    const messages: LlmMessage[] = [
      { role: 'system', content: this.strategy === 'adaptive' ? ADAPTIVE_PROMPT : EVIDENCE_PROMPT + (this.strategy === 'deliberate' ? DELIBERATE_EXTENSION : '') },
      { role: 'user', content: JSON.stringify(input) },
    ];
    const record = (usage: Parameters<NonNullable<PlayerAgentDeps['onUsage']>>[0]['usage']) => {
      this.deps.onUsage?.({ seatId: this.deps.seatId, phase: 'think', provider: this.deps.llm.provider, model: this.deps.llm.model, usage });
    };
    try {
      for (let attempt = 0; attempt < (this.strategy === 'adaptive' ? 2 : 1); attempt++) {
        const result = await Promise.race([
          this.deps.llm.complete(messages, { temperature: 0.2, maxTokens: this.strategy === 'evidence' ? 1200 : 1800, maxRetries: 0, signal: controller.signal }), timeout,
        ]);
        record(result.usage);
        const brief = this.strategy === 'adaptive' ? parseAdaptiveBrief(result.text, view, phase, candidates) : this.strategy === 'deliberate' ? parseDeliberateBrief(result.text, view, phase, candidates) : parseBrief(result.text, view);
        if (brief) return brief;
        if (this.strategy === 'adaptive' && attempt === 0) messages.push({ role: 'user', content: '上一份结构未通过校验。重新生成：引用必须用 records.id 的 L 编号而非 seatId；quote 必须原样引用；evidence 先列在 observations；投票的两个方案都需引用目标本人发言；selected 只能是 0/1；发言 targetSeatId=null，投票用合法座位；text 不写自己的词面。' });
      }
      return null;
    } catch (error) {
      if (!controller.signal.aborted && error instanceof LlmResponseError) record(error.usage);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private actor(brief: DecisionBrief | null): PlayerAgent {
    const original = this.deps.llm;
    const llm: LlmClient = {
      provider: original.provider, model: original.model,
      complete: (messages, options) => original.complete(brief ? [
        ...messages,
        { role: 'user', content: `${ACTOR_BRIEF_PROMPT}\n${JSON.stringify(brief)}${brief.choices ? '\n' + ACTOR_CHOICE_PROMPT : ''}` },
      ] : messages, options),
    };
    return new PlayerAgent(this.persona, { ...this.deps, llm });
  }

  async speak(view: AgentView) {
    const brief = await this.plan(view, 'speak', []);
    this.deps.onPlan?.(brief ? 'ok' : 'fallback');
    const result = await this.actor(brief).speak(view);
    this.memory = { decision: brief, actualAction: result.text };
    return result;
  }

  async vote(view: AgentView, candidates: number[], rng: () => number) {
    const brief = await this.plan(view, 'vote', candidates);
    this.deps.onPlan?.(brief ? 'ok' : 'fallback');
    const result = await this.actor(brief).vote(view, candidates, rng);
    this.memory = { decision: brief, actualAction: JSON.stringify(result) };
    return result;
  }
}

export function createPlayerAgent(persona: Persona, deps: ThinkingDeps, strategy: ThinkingStrategy): SeatAgent {
  return strategy === 'baseline' ? new PlayerAgent(persona, deps) : new ThinkingAgent(persona, deps, strategy);
}
