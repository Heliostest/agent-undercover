import type { UsageLedger, UsageSink } from '@/lib/billing/ledger';
import type { GameEvent } from '@/lib/game/types';

export interface UsageEmitterDeps {
  ledger: UsageLedger;
  emit: (event: GameEvent) => void;
}

/**
 * 记账成功后立刻推一条 usage：callId 与 UsageRecord 同源，回放去重靠它。
 * 只挑公开字段，totalTokens 与费用留给局末的 bill，绝不含 API Key。
 */
export function createUsageSink(deps: UsageEmitterDeps): UsageSink {
  return (input) => {
    const record = deps.ledger.append(input);
    deps.emit({
      type: 'usage',
      callId: record.callId,
      seatId: record.seatId,
      phase: record.phase,
      provider: record.provider,
      model: record.model,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      cacheHitTokens: record.cacheHitTokens,
      cacheMissTokens: record.cacheMissTokens,
      cacheReported: record.cacheReported,
    });
  };
}
