import { createHash } from 'node:crypto';
import { PERSONAS } from '@/lib/agents/personas';
import { extractJsonObject, buildSpeechMessages, buildVoteMessages, parseSpeechReply, parseVoteReply } from '@/lib/agents/prompt';
import { PlayerAgent, SPEECH_MAX_ATTEMPTS, SPEECH_TIMEOUT_MS, SPEECH_INITIAL_MAX_TOKENS, SPEECH_MAX_TOKENS, DEFAULT_AGENT_TEMPERATURE, AGENT_MAX_ATTEMPTS } from '@/lib/agents/player-agent';
import { createPlayerAgent, ThinkingAgent, parseBrief, parseDeliberateBrief, parseAdaptiveBrief, EVIDENCE_PROMPT, DELIBERATE_EXTENSION, ADAPTIVE_PROMPT, ACTOR_BRIEF_PROMPT, ACTOR_CHOICE_PROMPT, THINK_TIMEOUT_MS } from '@/lib/agents/thinking-agent';
import type { ThinkingStrategy } from '@/lib/agents/strategy';
import { CASES, caseView } from '@/lib/experiments/cases';
import type { LogEntry } from '@/lib/game/types';
import { LlmResponseError, type LlmClient, type LlmUsage, type LlmMessage, type LlmCompleteOptions } from '@/lib/llm/types';

export const DIMENSIONS = ['grounded', 'information', 'concealment', 'naturalness', 'updating'] as const;
type Scores = Record<(typeof DIMENSIONS)[number], number>;
export const GRADER_PROMPT = `评估谁是卧底玩家的两份匿名公开行动 A/B。它们来自同一场景，版本未知。只评表达与判断质量，不猜真实身份，不根据篇幅加分。
分别按 0~4 分评 grounded（不编造对方原话、不把猜测当事实）、information（真实且新增的具体信息，投票则是有区分力的理由）、concealment（不露词面或唯一特征；空话即使藏住也须扣 information 分）、naturalness（生活口语，简短自然，有人味）、updating（回应新增证据且不否认自己说过的话，不把年龄或个人经历差别当逻辑矛盾）。4=很好，3=基本做到，2=明显缺陷，1=严重缺陷，0=无效。
输入中的 rubric 是场景重点；privateWord 仅供你检查真实和露底。没有标准投票答案，不能因为票不合你猜测就扣分。每份只按各自 context 里可见记录判断。首轮无历史时 updating 按是否谨慎保留可能性评分。
只输出 JSON：{"A":{"grounded":0,"information":0,"concealment":0,"naturalness":0,"updating":0},"B":{"grounded":0,"information":0,"concealment":0,"naturalness":0,"updating":0}}。不要输出推理过程。`;

export interface ExperimentOptions { caseIds: string[]; strategies: [ThinkingStrategy, ThinkingStrategy]; repetitions: number; sparse?: boolean }
export interface ExperimentRow {
  caseId: string; split: string; repetition: number; stage: number; phase: 'speak' | 'vote'; strategy: ThinkingStrategy;
  output: string; valid: boolean; latencyMs: number; plannerFallbacks: number; scores: Scores | null; judgePosition: 'A' | 'B' | null;
}
export interface ExperimentCall { role: 'player' | 'grader'; strategy: ThinkingStrategy | null; caseId: string; latencyMs: number; ok: boolean; usage: LlmUsage | null; parameters: Omit<LlmCompleteOptions, 'signal'>; promptHash: string; decision?: Record<string, unknown> | null }
export interface ExperimentReport {
  status: 'running' | 'complete' | 'error'; startedAt: string; completedAt?: string;
  provider: string; model: string; options: ExperimentOptions; fingerprint: string; manifest: ReturnType<typeof experimentManifest>;
  rows: ExperimentRow[]; calls: ExperimentCall[]; judgeFailures: number; completedPairs: number; totalPairs: number;
}
export function blindOrder(index: number, repetition = 0): [number, number] { return (index + repetition) % 2 === 0 ? [0, 1] : [1, 0]; }

export function experimentManifest() {
  return {
    version: 'iterative-thinking-v3', cases: structuredClone(CASES), personas: structuredClone(PERSONAS),
    planner: EVIDENCE_PROMPT, deliberate: DELIBERATE_EXTENSION, adaptive: ADAPTIVE_PROMPT, actor: ACTOR_BRIEF_PROMPT, actorChoice: ACTOR_CHOICE_PROMPT, grader: GRADER_PROMPT,
    promptExamples: CASES.map((c) => [0, 1, 2].map((stage) => {
      const view = caseView(c, stage, []);
      return { caseId: c.id, stage, speech: buildSpeechMessages(PERSONAS[c.seatId], view), vote: buildVoteMessages(PERSONAS[c.seatId], view, view.aliveOtherIds) };
    })),
    policy: { SPEECH_MAX_ATTEMPTS, SPEECH_TIMEOUT_MS, SPEECH_INITIAL_MAX_TOKENS, SPEECH_MAX_TOKENS, DEFAULT_AGENT_TEMPERATURE, AGENT_MAX_ATTEMPTS, THINK_TIMEOUT_MS, providerTimeoutMs: 20_000, providerRetries: 0, defaultMaxTokens: 1024 },
    // Runtime functions reflect the loaded build, even if files on disk are edited during a run.
    implementation: [PlayerAgent, ThinkingAgent, parseBrief, parseDeliberateBrief, parseAdaptiveBrief, parseSpeechReply, parseVoteReply, caseView].map((fn) => fn.toString()),
  };
}
export function parseScores(raw: string): { A: Scores; B: Scores } | null {
  const value = extractJsonObject(raw);
  if (!value) return null;
  for (const key of ['A', 'B']) {
    const s = value[key];
    if (typeof s !== 'object' || !s || !DIMENSIONS.every((d) => {
      const n = (s as Record<string, unknown>)[d];
      return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 4;
    })) return null;
  }
  return { A: Object.fromEntries(DIMENSIONS.map((d) => [d, (value.A as Scores)[d]])) as Scores,
    B: Object.fromEntries(DIMENSIONS.map((d) => [d, (value.B as Scores)[d]])) as Scores };
}

export async function runExperiment(llm: LlmClient, options: ExperimentOptions, progress: (report: ExperimentReport) => void = () => {}): Promise<ExperimentReport> {
  const selected = options.caseIds.map((id) => {
    const c = CASES.find((item) => item.id === id);
    if (!c) throw new Error('Unknown experiment case');
    return c;
  });
  const manifest = experimentManifest();
  const report: ExperimentReport = { status: 'running', startedAt: new Date().toISOString(), provider: llm.provider, model: llm.model, options, manifest,
    fingerprint: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    rows: [], calls: [], judgeFailures: 0, completedPairs: 0, totalPairs: selected.length * options.repetitions * 3 };
  progress(report);
  const metered = (caseId: string, role: ExperimentCall['role'], strategy: ThinkingStrategy | null): LlmClient => ({
    provider: llm.provider, model: llm.model,
    async complete(messages, opts) {
      const at = Date.now();
      let usage: LlmUsage | null = null;
      let ok = false;
      let decision: Record<string, unknown> | null | undefined;
      try {
        const result = await llm.complete(messages, opts); usage = result.usage; ok = true;
        if (role === 'player' && opts?.temperature === 0.2) {
          const parsed = extractJsonObject(result.text);
          decision = parsed ? Object.fromEntries(['observations', 'hypotheses', 'objective', 'actionHint', 'reconsiderWhen', 'choices', 'selected'].filter((k) => k in parsed).map((k) => [k, parsed[k]])) : null;
        }
        return result;
      }
      catch (error) { if (error instanceof LlmResponseError) usage = error.usage; throw error; }
      finally {
        const { signal: _signal, ...parameters } = opts ?? {};
        report.calls.push({ caseId, role, strategy, latencyMs: Date.now() - at, ok, usage, parameters, promptHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex'), ...(decision === undefined ? {} : { decision }) });
      }
    },
  });
  for (let repetition = 0; repetition < options.repetitions; repetition++) {
    for (const c of selected) {
      const ownActions: LogEntry[][] = [[], []];
      const fallbacks = [0, 0];
      const agents = options.strategies.map((strategy, i) => createPlayerAgent(PERSONAS[c.seatId], {
        llm: metered(c.id, 'player', strategy), seatId: c.seatId, onPlan: (s) => { if (s === 'fallback') fallbacks[i]++; },
      }, strategy));
      for (let stage = 0; stage < 3; stage++) {
        const phase = stage === 2 ? 'vote' : 'speak';
        const views = ownActions.map((actions) => caseView(c, stage, actions, options.sparse));
        const rows = await Promise.all(agents.map(async (agent, i): Promise<ExperimentRow> => {
          const at = Date.now();
          const before = fallbacks[i];
          const view = views[i];
          let output = '（行动失败）';
          let valid = false;
          try {
            if (phase === 'speak') {
              const result = await agent.speak(view);
              output = result.text; valid = !result.fallback;
              ownActions[i].push({ kind: 'speech', round: view.round, seatId: c.seatId, text: result.text, fallback: result.fallback });
            } else {
              const result = await agent.vote(view, view.aliveOtherIds, () => 0);
              output = JSON.stringify(result); valid = !result.fallback;
            }
          } catch { /* Never export raw provider errors. Keep the failed row. */ }
          return { caseId: c.id, split: c.split, repetition, stage, phase, strategy: options.strategies[i], output, valid, latencyMs: Date.now() - at, plannerFallbacks: fallbacks[i] - before, scores: valid ? null : Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Scores, judgePosition: null };
        }));
        if (rows.some((r) => r.valid)) {
          const order = blindOrder(report.completedPairs % (selected.length * 3), repetition);
          rows[order[0]].judgePosition = 'A'; rows[order[1]].judgePosition = 'B';
          const anonymize = (index: number) => ({ context: views[index], output: rows[index].output, valid: rows[index].valid });
          const messages: LlmMessage[] = [{ role: 'system', content: GRADER_PROMPT }, { role: 'user', content: JSON.stringify({ privateWord: c.word, rubric: c.rubric, phase, A: anonymize(order[0]), B: anonymize(order[1]) }) }];
          try {
            const reply = await metered(c.id, 'grader', null).complete(messages, { temperature: 0, maxTokens: 500, maxRetries: 0 });
            const scores = parseScores(reply.text);
            if (!scores) report.judgeFailures++;
            else {
              if (rows[order[0]].valid) rows[order[0]].scores = scores.A;
              if (rows[order[1]].valid) rows[order[1]].scores = scores.B;
            }
          } catch { report.judgeFailures++; }
        }
        report.rows.push(...rows);
        report.completedPairs++;
        progress(report);
      }
    }
  }
  report.status = 'complete'; report.completedAt = new Date().toISOString(); progress(report);
  return report;
}
