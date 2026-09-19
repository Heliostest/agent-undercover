import { createOpenAiCompatibleClient } from '@/lib/llm/openai-compatible';
import type { LlmClient } from '@/lib/llm/types';

export const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const ZHIPU_DEFAULT_MODEL = 'glm-4-flash';
export const ZHIPU_LABEL = '智谱';

export class MissingApiKeyError extends Error {
  constructor() {
    super('缺少 ZHIPU_API_KEY：请在 .env.local 里配置智谱 API Key 后重启服务');
    this.name = 'MissingApiKeyError';
  }
}

export interface ZhipuConfig {
  apiKey: string;
  model: string;
}

/** @deprecated Key 已改由 POST /api/games 请求体传入，Task 9 会删掉这个函数。 */
export function readZhipuConfigFromEnv(env: Record<string, string | undefined>): ZhipuConfig {
  const apiKey = (env.ZHIPU_API_KEY ?? '').trim();
  if (apiKey === '') {
    throw new MissingApiKeyError();
  }
  const model = (env.ZHIPU_MODEL ?? '').trim();
  return { apiKey, model: model === '' ? ZHIPU_DEFAULT_MODEL : model };
}

export interface ZhipuClientOptions extends ZhipuConfig {
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
