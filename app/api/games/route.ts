import { NextResponse } from 'next/server';

import { startGame } from '@/lib/game/bootstrap';
import { InvalidLlmConfigError, parseLlmConfig } from '@/lib/llm/create-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  // 请求体解析失败按「不是 JSON 对象」处理，交给 parseLlmConfig 统一出文案。
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  try {
    const llmConfig = parseLlmConfig(body);
    const session = startGame({ llmConfig });
    return NextResponse.json({ gameId: session.gameId }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidLlmConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // 兜底文案只带错误信息，apiKey 从来不会出现在这些异常里。
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `创建对局失败：${message}` }, { status: 500 });
  }
}
