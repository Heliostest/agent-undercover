import {
  buildSpeechMessages,
  buildVoteMessages,
  parseSpeechReply,
  parseVoteReply,
} from '@/lib/agents/prompt';
import type { UsagePhase, UsageSink } from '@/lib/billing/ledger';
import { pickRandom } from '@/lib/game/rules';
import type { AgentView, Persona, SeatAgent, SpeechResult, VoteResult } from '@/lib/game/types';
import type { LlmClient, LlmMessage } from '@/lib/llm/types';

export const FALLBACK_SPEECH = '（本轮没有给出有效发言）';
export const FALLBACK_VOTE_REASON = '（模型没有给出有效投票，已随机选择）';
export const AGENT_MAX_ATTEMPTS = 2;
const DEFAULT_AGENT_TEMPERATURE = 0.4;

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

  async speak(view: AgentView): Promise<SpeechResult> {
    const messages = buildSpeechMessages(this.persona, view);
    for (let attempt = 0; attempt < AGENT_MAX_ATTEMPTS; attempt += 1) {
      const raw = await this.tryComplete(messages, 'speak');
      if (raw === null) {
        continue;
      }
      const text = parseSpeechReply(raw, view.word);
      if (text !== null) {
        return { text, fallback: false };
      }
    }
    return { text: FALLBACK_SPEECH, fallback: true };
  }

  async vote(view: AgentView, candidateIds: number[], rng: () => number): Promise<VoteResult> {
    const messages = buildVoteMessages(this.persona, view, candidateIds);
    for (let attempt = 0; attempt < AGENT_MAX_ATTEMPTS; attempt += 1) {
      const raw = await this.tryComplete(messages, 'vote');
      if (raw === null) {
        continue;
      }
      const parsed = parseVoteReply(raw, candidateIds);
      if (parsed !== null) {
        return { ...parsed, fallback: false };
      }
    }
    return {
      targetSeatId: pickRandom(candidateIds, rng),
      reason: FALLBACK_VOTE_REASON,
      fallback: true,
    };
  }

  /** 模型调用失败不向外抛：交给下一次尝试，用尽后由调用方走兜底。 */
  private async tryComplete(messages: LlmMessage[], phase: UsagePhase): Promise<string | null> {
    try {
      const completion = await this.deps.llm.complete(messages, {
        temperature: this.deps.temperature ?? DEFAULT_AGENT_TEMPERATURE,
      });
      // 只要拿到了响应就记一笔：内容不合格要重试，但 token 已经花掉了。
      this.deps.onUsage?.({
        seatId: this.deps.seatId,
        phase,
        provider: this.deps.llm.provider,
        model: this.deps.llm.model,
        usage: completion.usage,
      });
      return completion.text;
    } catch {
      return null;
    }
  }
}
