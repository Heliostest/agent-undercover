import { createOpenAiCompatibleClient } from '@/lib/llm/openai-compatible';
import type { LlmClient } from '@/lib/llm/types';

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';
export const OPENROUTER_LABEL = 'OpenRouter';
/** OpenRouter 用这两个头做应用排行榜展示，不填也能用，填了更礼貌。 */
export const OPENROUTER_REFERER = 'http://localhost:3000';
export const OPENROUTER_TITLE = 'agent-undercover';

export interface OpenrouterClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createOpenrouterClient(options: OpenrouterClientOptions): LlmClient {
  return createOpenAiCompatibleClient({
    provider: 'openrouter',
    label: OPENROUTER_LABEL,
    baseUrl: options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    model: options.model,
    extraHeaders: { 'HTTP-Referer': OPENROUTER_REFERER, 'X-Title': OPENROUTER_TITLE },
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  });
}
