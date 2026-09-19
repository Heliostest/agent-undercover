import { describe, expect, it } from 'vitest';

import { emptyUsage, parseUsage } from '@/lib/llm/usage';

describe('emptyUsage', () => {
  it('全零且两个 reported 标记都是 false', () => {
    expect(emptyUsage()).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      usageReported: false,
      cacheReported: false,
    });
  });

  it('每次都返回新对象，调用方改了不会污染下一次', () => {
    const first = emptyUsage();
    first.promptTokens = 99;
    expect(emptyUsage().promptTokens).toBe(0);
  });
});

describe('parseUsage', () => {
  it('整段 usage 缺失时记 0 并标记未上报', () => {
    expect(parseUsage(undefined)).toEqual(emptyUsage());
    expect(parseUsage(null)).toEqual(emptyUsage());
    expect(parseUsage('usage')).toEqual(emptyUsage());
  });

  it('token 字段不是数字时视为未上报', () => {
    expect(parseUsage({ prompt_tokens: 'x', completion_tokens: null })).toEqual(emptyUsage());
  });

  it('只有 token 没有缓存字段时 cacheReported 为 false', () => {
    expect(parseUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 })).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      usageReported: true,
      cacheReported: false,
    });
  });

  it('缺 total_tokens 时用 prompt + completion 补上', () => {
    expect(parseUsage({ prompt_tokens: 120, completion_tokens: 30 }).totalTokens).toBe(150);
  });

  it('映射 DeepSeek 的 prompt_cache_hit_tokens / prompt_cache_miss_tokens', () => {
    expect(
      parseUsage({
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_cache_hit_tokens: 64,
        prompt_cache_miss_tokens: 56,
      }),
    ).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cacheHitTokens: 64,
      cacheMissTokens: 56,
      usageReported: true,
      cacheReported: true,
    });
  });

  it('只给了 miss 时用 prompt - miss 反推 hit', () => {
    const usage = parseUsage({
      prompt_tokens: 120,
      completion_tokens: 30,
      prompt_cache_miss_tokens: 100,
    });
    expect(usage.cacheHitTokens).toBe(20);
    expect(usage.cacheMissTokens).toBe(100);
    expect(usage.cacheReported).toBe(true);
  });

  it('映射 OpenAI / 智谱风格的 prompt_tokens_details.cached_tokens', () => {
    const usage = parseUsage({
      prompt_tokens: 120,
      completion_tokens: 30,
      prompt_tokens_details: { cached_tokens: 80 },
    });
    expect(usage.cacheHitTokens).toBe(80);
    expect(usage.cacheMissTokens).toBe(40);
    expect(usage.cacheReported).toBe(true);
  });

  it('cached_tokens 超过 prompt_tokens 时截断，未命中不会变成负数', () => {
    const usage = parseUsage({
      prompt_tokens: 50,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 999 },
    });
    expect(usage.cacheHitTokens).toBe(50);
    expect(usage.cacheMissTokens).toBe(0);
  });
});
