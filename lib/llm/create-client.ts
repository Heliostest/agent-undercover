import { createDeepseekClient } from '@/lib/llm/deepseek';
import { DEFAULT_MODELS, PROVIDERS, isLlmProvider } from '@/lib/llm/providers';
import type { LlmClient, LlmProvider } from '@/lib/llm/types';
import { createZhipuClient } from '@/lib/llm/zhipu';

export const MAX_API_KEY_LENGTH = 200;
export const MAX_MODEL_LENGTH = 64;

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
}

export class InvalidLlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLlmConfigError';
  }
}

/**
 * 只认 provider / model / apiKey 三个字段，多出来的一律忽略。
 * 任何错误文案都不得回显 apiKey——错误会原样返回给浏览器。
 */
export function parseLlmConfig(body: unknown): LlmConfig {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidLlmConfigError('请求体必须是 JSON 对象，需包含 provider / model / apiKey');
  }

  const raw = body as Record<string, unknown>;
  if (!isLlmProvider(raw.provider)) {
    throw new InvalidLlmConfigError(`provider 只能是 ${PROVIDERS.join(' 或 ')}`);
  }
  const provider = raw.provider;

  const rawModel = raw.model;
  if (rawModel !== undefined && typeof rawModel !== 'string') {
    throw new InvalidLlmConfigError('model 必须是字符串');
  }
  const trimmedModel = (rawModel ?? '').trim();
  const model = trimmedModel === '' ? DEFAULT_MODELS[provider] : trimmedModel;
  if (model.length > MAX_MODEL_LENGTH) {
    throw new InvalidLlmConfigError(`model 长度不能超过 ${MAX_MODEL_LENGTH} 个字符`);
  }

  const rawApiKey = raw.apiKey;
  if (typeof rawApiKey !== 'string' || rawApiKey.trim() === '') {
    throw new InvalidLlmConfigError('缺少 apiKey：请在页面「模型设置」里填入该供应商的 API Key');
  }
  const apiKey = rawApiKey.trim();
  if (apiKey.length > MAX_API_KEY_LENGTH) {
    throw new InvalidLlmConfigError(`apiKey 长度不能超过 ${MAX_API_KEY_LENGTH} 个字符`);
  }

  return { provider, model, apiKey };
}

export interface CreateClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createLlmClient(config: LlmConfig, options: CreateClientOptions = {}): LlmClient {
  const shared = {
    apiKey: config.apiKey,
    model: config.model,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  };
  return config.provider === 'deepseek' ? createDeepseekClient(shared) : createZhipuClient(shared);
}
