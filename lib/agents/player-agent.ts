import {
  buildSpeechMessages,
  buildVoteMessages,
  extractJsonObject,
  parseSpeechReply,
  diagnoseVoteFailure,
  parseVoteReply,
} from '@/lib/agents/prompt';
import type { UsagePhase, UsageSink } from '@/lib/billing/ledger';
import { pickRandom } from '@/lib/game/rules';
import type { AgentView, Persona, SeatAgent, SpeechResult, VoteResult } from '@/lib/game/types';
import {
  LlmError,
  LlmResponseError,
  type LlmClient,
  type LlmMessage,
  type LlmUsage,
} from '@/lib/llm/types';

export const FALLBACK_VOTE_REASON = '（模型没有给出有效投票，已随机选择）';
export function formatFallbackVoteReason(detail: string): string {
  const clean = detail.trim() || '未知原因';
  return `（模型没有给出有效投票：${clean}，已随机选择）`;
}
export const AGENT_MAX_ATTEMPTS = 2;
/**
 * 发言/投票的重试次数与墙上时钟时限是两道独立的闸：
 * 时限包住整轮重试（不是每次尝试各给一份），所以重试不会把 90 秒乘成好几份。
 * 但次数也不能随便加：单次请求最多 20 秒（见 lib/llm/openai-compatible 的 DEFAULT_TIMEOUT_MS），
 * 再加上尝试之间的退避，3 次发言尝试最坏 3×20+0.5+1=61.5 秒，90 秒装得下；
 * 原先的 5 次最坏要 107.5 秒，第 5 次根本轮不到发出去，用户只会看到一句笼统的超时。
 * 投票比发言简单、只重试 2 次（最坏 40 秒），时限收到 60 秒。
 */
export const SPEECH_MAX_ATTEMPTS = 3;
export const SPEECH_TIMEOUT_MS = 90_000;
export const VOTE_TIMEOUT_MS = 60_000;

/** 第 attempt 次失败后等多久再试；上限 4 秒，免得退避本身吃掉时限。 */
export function speechRetryDelayMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 4000);
}
export const SPEECH_INITIAL_MAX_TOKENS = 1024;
export const SPEECH_MAX_TOKENS = 4096;
export const DEFAULT_AGENT_TEMPERATURE = 0.4;

export interface PlayerAgentDeps {
  llm: LlmClient;
  /** 座位号会写进每条用量记录，账单据此按座位分组。 */
  seatId: number;
  /** 不传就是不记账（比如纯逻辑测试）。 */
  onUsage?: UsageSink;
  temperature?: number;
}

export class PlayerAgent implements SeatAgent {
  constructor(
    private readonly persona: Persona,
    private readonly deps: PlayerAgentDeps,
  ) {}

  async speak(view: AgentView, signal?: AbortSignal): Promise<SpeechResult> {
    return withDeadline(
      SPEECH_TIMEOUT_MS,
      `${view.seatName}发言等待超过 ${SPEECH_TIMEOUT_MS / 1000} 秒，已停止本局，请检查模型服务后重新开局`,
      signal,
      (deadlineSignal) => this.retrySpeech(view, deadlineSignal),
    );
  }

  private async retrySpeech(view: AgentView, signal: AbortSignal): Promise<SpeechResult> {
    const baseMessages = buildSpeechMessages(this.persona, view);
    let correction = '';
    let lastReason = '未取得合格发言';
    let maxTokens = SPEECH_INITIAL_MAX_TOKENS;
    for (let attempt = 1; attempt <= SPEECH_MAX_ATTEMPTS; attempt += 1) {
      signal.throwIfAborted();
      const messages: LlmMessage[] = correction
        ? [
            ...baseMessages,
            {
              role: 'user',
              content: `上次回答未通过校验：${correction} 请重新回答，只输出 {"thought":"你的内心推理","speech":"你的发言"}。thought 是私密的，可以直接写出你的词；speech 保持一两句生活口语，只补一点信息，不要为了通过校验罗列特征或输出分析。`,
            },
          ]
        : baseMessages;
      let raw: string;
      try {
        const completion = await this.deps.llm.complete(messages, {
          temperature: this.deps.temperature ?? DEFAULT_AGENT_TEMPERATURE,
          maxTokens,
          maxRetries: 0,
          signal,
        });
        // 超时后迟到的响应不得修改已经发出的账单或游戏状态。
        signal.throwIfAborted();
        this.recordUsage('speak', completion.usage);
        raw = completion.text;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof LlmResponseError) {
          this.recordUsage('speak', error.usage);
          maxTokens = Math.min(maxTokens * 2, SPEECH_MAX_TOKENS);
          lastReason = error.kind === 'truncated' ? '输出被截断' : '模型返回空内容';
          correction = `${lastReason}。输出额度已增加，请直接给出完整的简短 JSON。`;
        } else {
          lastReason = speechRequestError(error);
          if (
            error instanceof LlmError && error.status !== undefined &&
            error.status < 500 && error.status !== 429
          ) {
            throw new Error(`${view.seatName}发言失败：${lastReason}，已停止本局`);
          }
          if (attempt < SPEECH_MAX_ATTEMPTS) {
            await waitForRetry(speechRetryDelayMs(attempt), signal);
          }
        }
        continue;
      }
      const parsed = parseSpeechReply(raw, view.word);
      if (parsed !== null) {
        return { ...parsed, fallback: false };
      }
      const speech = extractJsonObject(raw)?.speech;
      const leakedWord = typeof speech === 'string' && speech.includes(view.word);
      correction = leakedWord
        ? '公开发言 speech 包含了你的词面，必须改用特征、用途或场景描述，不能直接写出词面；想到词面本身的部分放进私密的 thought 里。'
        : '必须输出同时包含 thought 与非空 speech 字符串的合法 JSON 对象。';
      lastReason = leakedWord ? '发言包含词面' : '发言格式不合格';
    }
    throw new Error(`${view.seatName}尝试 ${SPEECH_MAX_ATTEMPTS} 次后仍未取得合格发言（${lastReason}），已停止本局，请检查模型设置后重新开局`);
  }

  private recordUsage(phase: UsagePhase, usage: LlmUsage): void {
    this.deps.onUsage?.({
      seatId: this.deps.seatId,
      phase,
      provider: this.deps.llm.provider,
      model: this.deps.llm.model,
      usage,
    });
  }

  async vote(
    view: AgentView,
    candidateIds: number[],
    rng: () => number,
    signal?: AbortSignal,
  ): Promise<VoteResult> {
    return withDeadline(
      VOTE_TIMEOUT_MS,
      `${view.seatName}投票等待超过 ${VOTE_TIMEOUT_MS / 1000} 秒，已停止本局，请检查模型服务后重新开局`,
      signal,
      (deadlineSignal) => this.retryVote(view, candidateIds, rng, deadlineSignal),
    );
  }

  private async retryVote(
    view: AgentView,
    candidateIds: number[],
    rng: () => number,
    signal: AbortSignal,
  ): Promise<VoteResult> {
    const baseMessages = buildVoteMessages(this.persona, view, candidateIds);
    let correction = '';
    let lastFailure = '未知原因';
    for (let attempt = 0; attempt < AGENT_MAX_ATTEMPTS; attempt += 1) {
      signal.throwIfAborted();
      const messages: LlmMessage[] = correction
        ? [...baseMessages, { role: 'user', content: correction }]
        : baseMessages;
      const raw = await this.tryComplete(messages, 'vote', signal);
      if (raw === null) {
        lastFailure = diagnoseVoteFailure(null, candidateIds, view.word);
        continue;
      }
      const parsed = parseVoteReply(raw, candidateIds, view.word);
      if (parsed !== null) {
        return { ...parsed, fallback: false };
      }
      lastFailure = diagnoseVoteFailure(raw, candidateIds, view.word);
      const reason = extractJsonObject(raw)?.reason;
      correction = typeof reason === 'string' && reason.includes(view.word)
        ? '上次投票理由泄露了你的词面。reason 是公开的，请藏住词面，改用一句日常口语指出对方发言让你疑惑的地方，不要报答案；涉及词面的推理写进私密的 thought 里。重新输出合法的 {"thought":"你的内心推理","vote":座位号,"reason":"一句口语理由"}。'
        : `上次投票格式或座位不合法。请从 ${candidateIds.join('、')} 中选一个座位，只输出 {"thought":"你的内心推理","vote":座位号,"reason":"一句口语理由"}，reason 里不要写出自己的词面。`;
    }
    return {
      targetSeatId: pickRandom(candidateIds, rng),
      reason: formatFallbackVoteReason(lastFailure),
      // 兜底票不是模型的判断，没有真实内心活动可记，留空而不是编一段。
      thought: '',
      fallback: true,
    };
  }

  /** 模型调用失败不向外抛：交给下一次尝试，用尽后由调用方走兜底；只有取消要立刻传出去。 */
  private async tryComplete(
    messages: LlmMessage[],
    phase: UsagePhase,
    signal: AbortSignal,
  ): Promise<string | null> {
    try {
      const completion = await this.deps.llm.complete(messages, {
        temperature: this.deps.temperature ?? DEFAULT_AGENT_TEMPERATURE,
        // 重试由这一层统管，客户端再重试一遍会把请求数相乘。
        maxRetries: 0,
        signal,
      });
      // 取消后迟到的响应不得再记账或参与决策。
      signal.throwIfAborted();
      // 只要拿到了响应就记一笔：内容不合格要重试，但 token 已经花掉了。
      this.recordUsage(phase, completion.usage);
      return completion.text;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof LlmResponseError) {
        this.recordUsage(phase, error.usage);
      }
      return null;
    }
  }
}

/** 外部（整局）取消信号并进本次调用的 controller：任一方触发都立刻停手。 */
export function linkAbort(controller: AbortController, external?: AbortSignal): () => void {
  if (!external) {
    return () => {};
  }
  if (external.aborted) {
    controller.abort(external.reason);
    return () => {};
  }
  const forward = () => controller.abort(external.reason);
  external.addEventListener('abort', forward, { once: true });
  return () => external.removeEventListener('abort', forward);
}

/**
 * 给「一次决策 + 它的全部重试」罩一层墙上时钟时限：
 * 到点就取消在途请求并向外抛，外部取消信号走同一条路，
 * 调用方绝不会因为模型不回话而无限期等下去。
 */
export async function withDeadline<T>(
  timeoutMs: number,
  timeoutMessage: string,
  external: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const detach = linkAbort(controller, external);
  const timer = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (controller.signal.aborted) {
      reject(controller.signal.reason);
      return;
    }
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
  try {
    return await Promise.race([run(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    detach();
  }
}

/** 不转发供应商原始正文：其中可能有 Key、提示词或私有词。 */
function speechRequestError(error: unknown): string {
  if (error instanceof LlmError) {
    if (error.status === 401 || error.status === 403) return '认证失败，请检查 API Key 和模型权限';
    if (error.status === 402) return '账户余额不足，请检查供应商账户';
    if (error.status === 429) return '模型服务限流，请稍后重试';
    if (error.status !== undefined) return `模型服务返回 HTTP ${error.status}，请检查模型名称及服务状态`;
  }
  if (error instanceof Error && error.name === 'AbortError') return '模型请求超时';
  return '模型请求失败或网络异常';
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
