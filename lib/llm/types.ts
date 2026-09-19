export type LlmProvider = 'zhipu' | 'deepseek';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteOptions {
  temperature?: number;
  maxTokens?: number;
}

/** 一次调用的 token 与缓存用量；供应商没给的部分记 0，并把对应的 reported 标成 false。 */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  /** 响应里完全没有可用的 usage 段时为 false，账单会据此注明「未返回 usage」。 */
  usageReported: boolean;
  /** 响应里没有任何缓存字段时为 false，界面显示「未提供」而不是 0。 */
  cacheReported: boolean;
}

export interface LlmCompletion {
  text: string;
  usage: LlmUsage;
}

export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<LlmCompletion>;
}

export class LlmError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}
