import { NextResponse } from 'next/server';

import { normalizeOmnirouteBaseUrl } from '@/lib/llm/omniroute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODELS_TIMEOUT_MS = 10_000;

function extractModelIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  const ids = data
    .map((item) =>
      item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
        ? (item as { id: string }).id.trim()
        : '',
    )
    .filter((id) => id !== '');
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/** 服务端转发 OmniRoute GET /models，避免浏览器直连 127.0.0.1（tunnel 下会连错机器）。 */
export async function GET(): Promise<Response> {
  const baseUrl = normalizeOmnirouteBaseUrl(process.env.OMNIROUTE_BASE_URL);
  const apiKey = process.env.OMNIROUTE_API_KEY?.trim() ?? '';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey !== '') {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `无法从 OmniRoute 拉取模型列表（HTTP ${response.status}）` },
        { status: 502 },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return NextResponse.json({ error: 'OmniRoute 返回了无法解析的响应' }, { status: 502 });
    }

    return NextResponse.json({ models: extractModelIds(payload) });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json(
      {
        error: aborted
          ? '连接 OmniRoute 超时，请确认本机已运行 omniroute serve'
          : '无法连接 OmniRoute，请确认本机已运行 omniroute serve',
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
