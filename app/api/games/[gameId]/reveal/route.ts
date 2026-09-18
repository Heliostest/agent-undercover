import { NextResponse } from 'next/server';

import { getSession } from '@/lib/game/registry';
import { toGodView } from '@/lib/game/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  if (process.env.ENABLE_GOD_VIEW !== 'true') {
    return NextResponse.json(
      { error: '上帝视角未启用：请在 .env.local 设置 ENABLE_GOD_VIEW=true 后重启服务' },
      { status: 403 },
    );
  }

  const { gameId } = await context.params;
  const session = getSession(gameId);
  if (!session) {
    return NextResponse.json({ error: `对局 ${gameId} 不存在或已结束` }, { status: 404 });
  }

  return NextResponse.json(toGodView(session.state));
}
