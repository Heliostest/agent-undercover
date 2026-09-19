import { NextResponse } from 'next/server';

import { startGame } from '@/lib/game/bootstrap';
import { MissingApiKeyError } from '@/lib/llm/zhipu';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    const session = startGame();
    return NextResponse.json({ gameId: session.gameId }, { status: 201 });
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `创建对局失败：${message}` }, { status: 500 });
  }
}
