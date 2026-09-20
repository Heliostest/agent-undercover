import { describe, expect, it } from 'vitest';

import {
  PRICE_TABLE,
  isKnownModel,
  isPricedProvider,
  normalizeModel,
  priceFor,
} from '@/lib/billing/prices';

describe('PRICE_TABLE', () => {
  it('只有智谱有内置价目，且单价非负', () => {
    expect(Object.keys(PRICE_TABLE)).toEqual(['zhipu']);
    const prices = PRICE_TABLE.zhipu;
    expect(prices.fallback.promptPerKTokens).toBeGreaterThanOrEqual(0);
    expect(prices.fallback.completionPerKTokens).toBeGreaterThanOrEqual(0);
    for (const price of Object.values(prices.models)) {
      expect(price.promptPerKTokens).toBeGreaterThanOrEqual(0);
      expect(price.completionPerKTokens).toBeGreaterThanOrEqual(0);
    }
  });

  it('覆盖智谱默认模型 glm-4-flash', () => {
    expect(PRICE_TABLE.zhipu.models['glm-4-flash']).toBeDefined();
  });

  it('不为 DeepSeek / OpenRouter 编造单价', () => {
    expect(JSON.stringify(PRICE_TABLE)).not.toContain('deepseek');
    expect(JSON.stringify(PRICE_TABLE)).not.toContain('openrouter');
  });
});

describe('isPricedProvider', () => {
  it('只有智谱能估价', () => {
    expect(isPricedProvider('zhipu')).toBe(true);
    expect(isPricedProvider('deepseek')).toBe(false);
    expect(isPricedProvider('openrouter')).toBe(false);
  });
});

describe('normalizeModel', () => {
  it('去空白并转小写', () => {
    expect(normalizeModel('  GLM-4-Air ')).toBe('glm-4-air');
  });
});

describe('priceFor', () => {
  it('命中智谱内置模型时返回该模型单价', () => {
    expect(priceFor('zhipu', 'glm-4-air')).toEqual(PRICE_TABLE.zhipu.models['glm-4-air']);
  });

  it('大小写与空格不影响命中', () => {
    expect(priceFor('zhipu', ' GLM-4-Air ')).toEqual(PRICE_TABLE.zhipu.models['glm-4-air']);
  });

  it('未知智谱模型回落默认档', () => {
    expect(priceFor('zhipu', 'glm-未来版')).toEqual(PRICE_TABLE.zhipu.fallback);
  });

  it('DeepSeek 与 OpenRouter 返回 null', () => {
    expect(priceFor('deepseek', 'deepseek-chat')).toBeNull();
    expect(priceFor('openrouter', 'openai/gpt-4o-mini')).toBeNull();
  });
});

describe('isKnownModel', () => {
  it('内置模型为 true，未知模型为 false', () => {
    expect(isKnownModel('zhipu', 'glm-4-flash')).toBe(true);
    expect(isKnownModel('zhipu', 'GLM-4-Flash')).toBe(true);
    expect(isKnownModel('zhipu', 'glm-未来版')).toBe(false);
    expect(isKnownModel('zhipu', '')).toBe(false);
  });

  it('没有价目表的供应商一律为 false', () => {
    expect(isKnownModel('deepseek', 'deepseek-chat')).toBe(false);
    expect(isKnownModel('openrouter', 'openai/gpt-4o-mini')).toBe(false);
  });
});
