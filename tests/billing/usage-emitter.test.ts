import { describe, expect, it } from 'vitest';

import { UsageLedger } from '@/lib/billing/ledger';
import { createUsageSink } from '@/lib/billing/usage-emitter';
import type { GameEvent } from '@/lib/game/types';

describe('createUsageSink', () => {
  it('append 成功后立刻发出形状正确的 usage 事件', () => {
    const events: GameEvent[] = [];
    const ledger = new UsageLedger(
      () => 100,
      () => 'cid-1',
    );
    const onUsage = createUsageSink({
      ledger,
      emit: (event) => events.push(event),
    });

    onUsage({
      seatId: 2,
      phase: 'vote',
      provider: 'deepseek',
      model: 'deepseek-chat',
      usage: {
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cacheHitTokens: 64,
        cacheMissTokens: 56,
        usageReported: true,
        cacheReported: true,
      },
    });

    expect(ledger.size).toBe(1);
    expect(events).toEqual([
      {
        type: 'usage',
        callId: 'cid-1',
        seatId: 2,
        phase: 'vote',
        provider: 'deepseek',
        model: 'deepseek-chat',
        promptTokens: 120,
        completionTokens: 30,
        cacheHitTokens: 64,
        cacheMissTokens: 56,
        cacheReported: true,
      },
    ]);
  });

  it('usage 事件不含 totalTokens / 费用 / apiKey', () => {
    const events: GameEvent[] = [];
    const ledger = new UsageLedger(
      () => 0,
      () => 'cid-2',
    );
    createUsageSink({ ledger, emit: (e) => events.push(e) })({
      seatId: 0,
      phase: 'speak',
      provider: 'zhipu',
      model: 'glm-4-flash',
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        usageReported: true,
        cacheReported: false,
      },
    });
    const raw = JSON.stringify(events[0]);
    expect(raw).not.toContain('totalTokens');
    expect(raw).not.toContain('estimatedCost');
    expect(raw).not.toContain('apiKey');
    expect(events[0]).toMatchObject({ cacheReported: false, cacheHitTokens: 0 });
  });
});
