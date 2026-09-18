import { LlmError, type LlmClient, type LlmCompleteOptions, type LlmMessage } from '@/lib/llm/types';

export const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const ZHIPU_DEFAULT_MODEL = 'glm-4-flash';

const RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 400;

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

/** 429 / 5xx / 网络错误 / 超时都值得重试；其余 4xx 是我们自己的请求有问题，重试没意义。 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof LlmError && error.status !== undefined) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

export function createZhipuClient(options: ZhipuClientOptions): LlmClient {
  const baseUrl = options.baseUrl ?? ZHIPU_DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function attempt(messages: LlmMessage[], completeOptions?: LlmCompleteOptions): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          temperature: completeOptions?.temperature ?? DEFAULT_TEMPERATURE,
          max_tokens: completeOptions?.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new LlmError(`智谱接口返回 ${response.status}：${body.slice(0, 200)}`, response.status);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new LlmError('智谱接口返回了空内容');
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async complete(messages, completeOptions) {
      let lastError: unknown = new LlmError('智谱请求未执行');
      for (let retry = 0; retry <= maxRetries; retry += 1) {
        try {
          return await attempt(messages, completeOptions);
        } catch (error) {
          lastError = error;
          if (!isRetryable(error) || retry === maxRetries) {
            break;
          }
          await sleep(RETRY_BASE_DELAY_MS * 2 ** retry);
        }
      }
      throw lastError instanceof Error ? lastError : new LlmError(String(lastError));
    },
  };
}
