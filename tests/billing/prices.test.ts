import { describe, expect, it } from 'vitest';

import {
  PRICE_TABLE,
  isKnownModel,
  isPricedProvider,
  normalizeModel,
  priceFor,
} from '@/lib/billing/prices';

describe('PRICE_TABLE', () => {
  it('两个内置价目供应商都有 fallback 档，且单价非负', () => {
    for (const provider of ['zhipu', 'deepseek'] as const) {
      const prices = PRICE_TABLE[provider];
      expect(prices.fallback.promptPerKTokens).toBeGreaterThanOrEqual(0);
      expect(prices.fallback.completionPerKTokens).toBeGreaterThanOrEqual(0);
      for (const price of Object.values(prices.models)) {
        expect(price.promptPerKTokens).toBeGreaterThanOrEqual(0);
        expect(price.completionPerKTokens).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('覆盖 DeepSeek 的 chat 与 reasoner', () => {
    expect(Object.keys(PRICE_TABLE.deepseek.models)).toEqual(
      expect.arrayContaining(['deepseek-chat', 'deepseek-reasoner']),
    );
  });

  it('覆盖智谱默认模型 glm-4-flash', () => {
    expect(PRICE_TABLE.zhipu.models['glm-4-flash']).toBeDefined();
  });

  it('不给 OpenRouter 编造单价', () => {
    expect(Object.keys(PRICE_TABLE)).toEqual(['zhipu', 'deepseek']);
    expect(JSON.stringify(PRICE_TABLE)).not.toContain('openrouter');
  });
});

describe('isPricedProvider', () => {
  it('只有内置价目表里的供应商能估价', () => {
    expect(isPricedProvider('zhipu')).toBe(true);
    expect(isPricedProvider('deepseek')).toBe(true);
    expect(isPricedProvider('openrouter')).toBe(false);
  });
});

describe('normalizeModel', () => {
  it('去空白并转小写', () => {
    expect(normalizeModel('  DeepSeek-Chat ')).toBe('deepseek-chat');
  });
});

describe('priceFor', () => {
  it('命中内置模型时返回该模型单价', () => {
    expect(priceFor('deepseek', 'deepseek-reasoner')).toEqual(
      PRICE_TABLE.deepseek.models['deepseek-reasoner'],
    );
  });

  it('大小写与空格不影响命中', () => {
    expect(priceFor('deepseek', ' DEEPSEEK-CHAT ')).toEqual(
      PRICE_TABLE.deepseek.models['deepseek-chat'],
    );
  });

  it('未知模型回落到该供应商默认档', () => {
    expect(priceFor('deepseek', 'deepseek-v9')).toEqual(PRICE_TABLE.deepseek.fallback);
    expect(priceFor('zhipu', 'glm-未来版')).toEqual(PRICE_TABLE.zhipu.fallback);
  });

  it('没有价目表的供应商返回 null，而不是瞎猜一个价', () => {
    expect(priceFor('openrouter', 'openai/gpt-4o-mini')).toBeNull();
    expect(priceFor('openrouter', 'anything')).toBeNull();
  });
});

describe('isKnownModel', () => {
  it('内置模型为 true，未知模型为 false', () => {
    expect(isKnownModel('zhipu', 'glm-4-flash')).toBe(true);
    expect(isKnownModel('zhipu', 'GLM-4-Flash')).toBe(true);
    expect(isKnownModel('zhipu', 'glm-未来版')).toBe(false);
    expect(isKnownModel('deepseek', '')).toBe(false);
  });

  it('没有价目表的供应商一律为 false', () => {
    expect(isKnownModel('openrouter', 'openai/gpt-4o-mini')).toBe(false);
  });
});
