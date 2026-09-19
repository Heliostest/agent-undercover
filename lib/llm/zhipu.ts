import { createOpenAiCompatibleClient } from '@/lib/llm/openai-compatible';
import type { LlmClient } from '@/lib/llm/types';

export const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const ZHIPU_DEFAULT_MODEL = 'glm-4-flash';
export const ZHIPU_LABEL = '智谱';

export interface ZhipuClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createZhipuClient(options: ZhipuClientOptions): LlmClient {
  return createOpenAiCompatibleClient({
    provider: 'zhipu',
    label: ZHIPU_LABEL,
    baseUrl: options.baseUrl ?? ZHIPU_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  });
}
