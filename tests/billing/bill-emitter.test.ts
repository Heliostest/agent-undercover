import { describe, expect, it } from 'vitest';

import { createBillEmitter } from '@/lib/billing/bill-emitter';
import { UsageLedger } from '@/lib/billing/ledger';
import { BILL_ESTIMATE_NOTE } from '@/lib/billing/estimate';
import type { GameEvent } from '@/lib/game/types';

function setup() {
  const ledger = new UsageLedger(() => 100);
  ledger.append({
    seatId: 0,
    phase: 'speak',
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cacheHitTokens: 800,
      cacheMissTokens: 200,
      usageReported: true,
      cacheReported: true,
    },
  });

  const events: GameEvent[] = [];
  const emit = createBillEmitter({
    gameId: 'g-1',
    provider: 'deepseek',
    model: 'deepseek-chat',
    ledger,
    now: () => 777,
    emit: (event) => events.push(event),
  });

  return { emit, events, ledger };
}

const TERMINAL_RESULT: GameEvent = {
  type: 'result',
  round: 2,
  eliminatedSeatId: 3,
  tieBreak: false,
  winner: 'civilians',
  reveal: [],
};

describe('createBillEmitter', () => {
  it('非终局事件原样透传，不发账单', () => {
    const { emit, events } = setup();

    emit({ type: 'phase', phase: 'speak', round: 1, activeSeatId: 0 });
    emit({ type: 'result', round: 1, eliminatedSeatId: 1, tieBreak: false, winner: null, reveal: null });

    expect(events.map((event) => event.type)).toEqual(['phase', 'result']);
  });

  it('终局 result 之前插一条 bill', () => {
    const { emit, events } = setup();

    emit(TERMINAL_RESULT);

    expect(events.map((event) => event.type)).toEqual(['bill', 'result']);
  });

  it('error 终局同样先发 bill', () => {
    const { emit, events } = setup();

    emit({ type: 'error', message: '单局硬超时，已终止本局' });

    expect(events.map((event) => event.type)).toEqual(['bill', 'error']);
  });

  it('账单内容来自 ledger 快照与 now()', () => {
    const { emit, events } = setup();

    emit(TERMINAL_RESULT);

    const billEvent = events[0];
    if (billEvent.type !== 'bill') {
      throw new Error('第一条事件应该是 bill');
    }
    expect(billEvent.bill.gameId).toBe('g-1');
    expect(billEvent.bill.provider).toBe('deepseek');
    expect(billEvent.bill.model).toBe('deepseek-chat');
    expect(billEvent.bill.finishedAt).toBe(777);
    expect(billEvent.bill.estimated).toBe(true);
    expect(billEvent.bill.calls).toHaveLength(1);
    expect(billEvent.bill.totals.cacheHitTokens).toBe(800);
    expect(billEvent.bill.notes[0]).toBe(BILL_ESTIMATE_NOTE);
  });

  it('一局只发一次 bill，终局后再来事件也不会重复', () => {
    const { emit, events } = setup();

    emit(TERMINAL_RESULT);
    emit({ type: 'error', message: '又炸了' });

    expect(events.filter((event) => event.type === 'bill')).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(['bill', 'result', 'error']);
  });
});
