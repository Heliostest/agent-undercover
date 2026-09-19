import { buildBill } from '@/lib/billing/estimate';
import type { UsageLedger } from '@/lib/billing/ledger';
import { isTerminalEvent } from '@/lib/game/session';
import type { GameEvent } from '@/lib/game/types';
import type { LlmProvider } from '@/lib/llm/types';

export interface BillEmitterDeps {
  gameId: string;
  provider: LlmProvider;
  model: string;
  ledger: UsageLedger;
  now: () => number;
  emit: (event: GameEvent) => void;
}

/**
 * 包住 Judge 的 emit：SSE 路由一见到终局事件就关流，
 * 所以账单必须抢在终局事件前面发，而且一局只发一次。
 */
export function createBillEmitter(deps: BillEmitterDeps): (event: GameEvent) => void {
  let billed = false;

  return (event) => {
    if (isTerminalEvent(event) && !billed) {
      billed = true;
      deps.emit({
        type: 'bill',
        bill: buildBill({
          gameId: deps.gameId,
          provider: deps.provider,
          model: deps.model,
          finishedAt: deps.now(),
          records: deps.ledger.records(),
        }),
      });
    }
    deps.emit(event);
  };
}
