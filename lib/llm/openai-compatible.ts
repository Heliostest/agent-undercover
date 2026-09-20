import { parseUsage } from '@/lib/llm/usage';
import {
  LlmError,
  LlmResponseError,
  type LlmClient,
  type LlmCompleteOptions,
  type LlmCompletion,
  type LlmMessage,
  type LlmProvider,
} from '@/lib/llm/types';

export const RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_TEMPERATURE = 0.4;
export const DEFAULT_MAX_TOKENS = 1024;

export interface OpenAiCompatibleOptions {
  provider: LlmProvider;
  /** 出现在错误文案里的供应商名，例如「智谱」「DeepSeek」。 */
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 供应商额外要求的请求头（如 OpenRouter 的 HTTP-Referer / X-Title）；不会覆盖认证与 content-type。 */
  extraHeaders?: Record<string, string>;
  /** 仅在明确支持该参数的供应商适配器中启用。 */
  disableThinking?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

/** 429 / 5xx / 网络错误 / 超时都值得重试；其余 4xx 是我们自己的请求有问题，重试没意义。 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof LlmResponseError) {
    return false;
  }
  if (error instanceof LlmError && error.status !== undefined) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

export function createOpenAiCompatibleClient(options: OpenAiCompatibleOptions): LlmClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function attempt(
    messages: LlmMessage[],
    completeOptions?: LlmCompleteOptions,
  ): Promise<LlmCompletion> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    completeOptions?.signal?.throwIfAborted();
    completeOptions?.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        ...options.extraHeaders,
        'content-type': 'application/json',
      };
      if (options.apiKey.trim() !== '') {
        headers.authorization = `Bearer ${options.apiKey}`;
      }
      const response = await fetchImpl(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: options.model,
          messages,
          temperature: completeOptions?.temperature ?? DEFAULT_TEMPERATURE,
          max_tokens: completeOptions?.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: false,
          ...(options.disableThinking ? { thinking: { type: 'disabled' } } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // 只截错误正文前 200 字符，且绝不把 apiKey 拼进文案。
        const body = await response.text();
        throw new LlmError(
          `${options.label}接口返回 ${response.status}：${body.slice(0, 200)}`,
          response.status,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: unknown;
      };
      const content = payload.choices?.[0]?.message?.content;
      const usage = parseUsage(payload.usage);
      if (payload.choices?.[0]?.finish_reason === 'length') {
        throw new LlmResponseError(`${options.label}输出达到长度限制`, 'truncated', usage);
      }
      if (typeof content !== 'string' || content.trim() === '') {
        throw new LlmResponseError(`${options.label}接口返回了空内容`, 'empty', usage);
      }
      return { text: content, usage };
    } finally {
      clearTimeout(timer);
      completeOptions?.signal?.removeEventListener('abort', abort);
    }
  }

  return {
    provider: options.provider,
    model: options.model,
    async complete(messages, completeOptions) {
      const retryLimit = completeOptions?.maxRetries ?? maxRetries;
      let lastError: unknown = new LlmError(`${options.label}请求未执行`);
      for (let retry = 0; retry <= retryLimit; retry += 1) {
        completeOptions?.signal?.throwIfAborted();
        try {
          return await attempt(messages, completeOptions);
        } catch (error) {
          lastError = error;
          if (completeOptions?.signal?.aborted || !isRetryable(error) || retry === retryLimit) {
            break;
          }
          await sleep(RETRY_BASE_DELAY_MS * 2 ** retry);
        }
      }
      throw lastError instanceof Error ? lastError : new LlmError(String(lastError));
    },
  };
}
