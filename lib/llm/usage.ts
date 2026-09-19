import type { LlmUsage } from '@/lib/llm/types';

export function emptyUsage(): LlmUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    usageReported: false,
    cacheReported: false,
  };
}

/** 只接受有限的非负数，其余（字符串、null、NaN、负数）一律当作「没给」。 */
function toCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

/**
 * 把 OpenAI 兼容响应里的 usage 段映射成 LlmUsage。
 * 缓存字段有两种形态：DeepSeek 给 prompt_cache_hit_tokens / prompt_cache_miss_tokens，
 * 智谱（以及 OpenAI 风格）给 prompt_tokens_details.cached_tokens；两种都没有就是没报缓存。
 */
export function parseUsage(raw: unknown): LlmUsage {
  const usage = emptyUsage();
  if (typeof raw !== 'object' || raw === null) {
    return usage;
  }

  const source = raw as Record<string, unknown>;
  const prompt = toCount(source.prompt_tokens);
  const completion = toCount(source.completion_tokens);
  const total = toCount(source.total_tokens);
  if (prompt === null && completion === null && total === null) {
    return usage;
  }

  usage.usageReported = true;
  usage.promptTokens = prompt ?? 0;
  usage.completionTokens = completion ?? 0;
  usage.totalTokens = total ?? usage.promptTokens + usage.completionTokens;

  const hit = toCount(source.prompt_cache_hit_tokens);
  const miss = toCount(source.prompt_cache_miss_tokens);
  if (hit !== null || miss !== null) {
    usage.cacheReported = true;
    usage.cacheHitTokens = hit ?? Math.max(usage.promptTokens - (miss ?? 0), 0);
    usage.cacheMissTokens = miss ?? Math.max(usage.promptTokens - usage.cacheHitTokens, 0);
    return usage;
  }

  const details = source.prompt_tokens_details;
  const cached =
    typeof details === 'object' && details !== null
      ? toCount((details as Record<string, unknown>).cached_tokens)
      : null;
  if (cached !== null) {
    usage.cacheReported = true;
    usage.cacheHitTokens = Math.min(cached, usage.promptTokens);
    usage.cacheMissTokens = Math.max(usage.promptTokens - usage.cacheHitTokens, 0);
  }

  return usage;
}
