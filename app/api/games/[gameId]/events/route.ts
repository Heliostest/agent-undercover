import type { Bill } from '@/lib/billing/estimate';
import { getSession } from '@/lib/game/registry';
import {
  isTerminalEvent,
  subscribe,
  usageEventsBefore,
  type GameSession,
} from '@/lib/game/session';
import { toPublicView } from '@/lib/game/state';
import type { PublicGameView } from '@/lib/game/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function frame(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 账单不进 GameState，重连时只能从已发生的事件里捞回来，否则刷新后账单会丢。 */
function billBefore(session: GameSession, watermark: number): Bill | null {
  for (let index = watermark - 1; index >= 0; index -= 1) {
    const event = session.events[index];
    if (event.type === 'bill') {
      return event.bill;
    }
  }
  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId } = await context.params;
  const session = getSession(gameId);
  if (!session) {
    return new Response(JSON.stringify({ error: `对局 ${gameId} 不存在或已结束` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // 流已经被对端关掉了，忽略即可。
        }
      };

      // 先定格快照，再用当前事件数当水位线：快照里已经有的日志不再回放，重连才不会把日志刷成两份。
      const snapshot: PublicGameView = toPublicView(session.state);
      const watermark = session.events.length;
      // 对局已经结束时账单就留在 session 上，直接取；进行中则只认水位线之前的那张。
      snapshot.bill = session.finished ? session.lastBill ?? null : billBefore(session, watermark);
      snapshot.usageLog = usageEventsBefore(session, watermark);
      controller.enqueue(encoder.encode(frame('snapshot', snapshot)));

      unsubscribe = subscribe(
        session,
        (event) => {
          if (closed) {
            return;
          }
          controller.enqueue(encoder.encode(frame(event.type, event)));
          if (isTerminalEvent(event)) {
            close();
          }
        },
        watermark,
      );

      // 快照已经是终局：后面不会再有事件了，直接关流，别让浏览器挂着一条空连接。
      if (session.finished) {
        close();
      }

      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
