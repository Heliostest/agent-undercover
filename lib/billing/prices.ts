import type { LlmProvider } from '@/lib/llm/types';

export interface ModelPrice {
  promptPerKTokens: number;
  completionPerKTokens: number;
}

export interface ProviderPrices {
  /** 未知模型走这一档。 */
  fallback: ModelPrice;
  models: Record<string, ModelPrice>;
}

/**
 * 有内置单价的供应商。OpenRouter 的模型来自上游多家厂商、按美元实时计价，
 * 本地编不出可信的人民币单价，所以它不在这个表里，账单只统计 token。
 */
export type PricedProvider = Exclude<LlmProvider, 'openrouter'>;

/**
 * 单位：CNY / 1K tokens。这是全站唯一的价目表，改价只动这里。
 * 数值按 2026-09 的公开价维护，账单一律标「估算」，以官方账单为准。
 */
export const PRICE_TABLE: Record<PricedProvider, ProviderPrices> = {
  zhipu: {
    fallback: { promptPerKTokens: 0.001, completionPerKTokens: 0.001 },
    models: {
      'glm-4-flash': { promptPerKTokens: 0, completionPerKTokens: 0 },
      'glm-4-air': { promptPerKTokens: 0.0005, completionPerKTokens: 0.0005 },
      'glm-4-airx': { promptPerKTokens: 0.01, completionPerKTokens: 0.01 },
      'glm-4-long': { promptPerKTokens: 0.001, completionPerKTokens: 0.001 },
      'glm-4-plus': { promptPerKTokens: 0.05, completionPerKTokens: 0.05 },
    },
  },
  deepseek: {
    fallback: { promptPerKTokens: 0.002, completionPerKTokens: 0.008 },
    models: {
      'deepseek-chat': { promptPerKTokens: 0.002, completionPerKTokens: 0.008 },
      'deepseek-reasoner': { promptPerKTokens: 0.004, completionPerKTokens: 0.016 },
    },
  },
};

export function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

export function isPricedProvider(provider: LlmProvider): provider is PricedProvider {
  return provider in PRICE_TABLE;
}

export function isKnownModel(provider: LlmProvider, model: string): boolean {
  return isPricedProvider(provider) && normalizeModel(model) in PRICE_TABLE[provider].models;
}

/** 没有内置价目表的供应商返回 null——宁可显示「费用暂不可用」，也不编一个假价。 */
export function priceFor(provider: LlmProvider, model: string): ModelPrice | null {
  if (!isPricedProvider(provider)) {
    return null;
  }
  const prices = PRICE_TABLE[provider];
  return prices.models[normalizeModel(model)] ?? prices.fallback;
}
