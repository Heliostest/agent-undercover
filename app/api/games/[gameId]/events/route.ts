import { getSession } from '@/lib/game/registry';
import { isTerminalEvent, subscribe } from '@/lib/game/session';
import { toPublicView } from '@/lib/game/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function frame(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
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

      controller.enqueue(encoder.encode(frame('snapshot', toPublicView(session.state))));

      unsubscribe = subscribe(session, (event) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(frame(event.type, event)));
        if (isTerminalEvent(event)) {
          close();
        }
      });

      // 回放时就已经读到终局事件的话，上面的 close() 还拿不到 unsubscribe，这里补一次。
      if (closed) {
        unsubscribe();
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
