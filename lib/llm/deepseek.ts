import { createOpenAiCompatibleClient } from '@/lib/llm/openai-compatible';
import type { LlmClient } from '@/lib/llm/types';

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';
export const DEEPSEEK_LABEL = 'DeepSeek';

export interface DeepseekClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createDeepseekClient(options: DeepseekClientOptions): LlmClient {
  return createOpenAiCompatibleClient({
    provider: 'deepseek',
    label: DEEPSEEK_LABEL,
    baseUrl: options.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  });
}
