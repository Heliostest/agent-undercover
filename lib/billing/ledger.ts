import type { LlmProvider, LlmUsage } from '@/lib/llm/types';

export type UsagePhase = 'speak' | 'vote' | 'think';

export interface UsageRecordInput {
  seatId: number;
  phase: UsagePhase;
  provider: LlmProvider;
  model: string;
  usage: LlmUsage;
}

/** 把 LlmUsage 摊平进记录，UI 与 JSON 都少一层嵌套。 */
export interface UsageRecord {
  at: number;
  seatId: number;
  phase: UsagePhase;
  provider: LlmProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  usageReported: boolean;
  cacheReported: boolean;
}

export type UsageSink = (input: UsageRecordInput) => void;

/** 一局一个，纯内存，跟着 session 一起被 GC；绝不写盘。 */
export class UsageLedger {
  private readonly entries: UsageRecord[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  append(input: UsageRecordInput): UsageRecord {
    const record: UsageRecord = {
      at: this.now(),
      seatId: input.seatId,
      phase: input.phase,
      provider: input.provider,
      model: input.model,
      ...input.usage,
    };
    this.entries.push(record);
    return record;
  }

  records(): UsageRecord[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }

  /** agent 只需要一个回调，不需要认识整个账本。 */
  sink(): UsageSink {
    return (input) => {
      this.append(input);
    };
  }
}
