import { createOpenAiCompatibleClient } from '@/lib/llm/openai-compatible';
import type { LlmClient } from '@/lib/llm/types';

export const OMNIROUTE_DEFAULT_BASE_URL = 'http://127.0.0.1:20128/v1';
export const OMNIROUTE_DEFAULT_MODEL = 'deepseek/deepseek-flash';
export const OMNIROUTE_LABEL = '本地 OmniRoute';

/** 去掉首尾空白与尾斜杠；空串回落默认。 */
export function normalizeOmnirouteBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? OMNIROUTE_DEFAULT_BASE_URL : trimmed;
}

export interface OmnirouteClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createOmnirouteClient(options: OmnirouteClientOptions): LlmClient {
  return createOpenAiCompatibleClient({
    provider: 'omniroute',
    label: OMNIROUTE_LABEL,
    baseUrl: normalizeOmnirouteBaseUrl(options.baseUrl),
    apiKey: options.apiKey ?? '',
    model: options.model,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  });
}
