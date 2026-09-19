import { DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_LABEL } from '@/lib/llm/deepseek';
import type { LlmProvider } from '@/lib/llm/types';
import { ZHIPU_DEFAULT_MODEL, ZHIPU_LABEL } from '@/lib/llm/zhipu';

/** 下拉框顺序就按这个数组来。 */
export const PROVIDERS: readonly LlmProvider[] = ['zhipu', 'deepseek'];

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  zhipu: ZHIPU_LABEL,
  deepseek: DEEPSEEK_LABEL,
};

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  zhipu: ZHIPU_DEFAULT_MODEL,
  deepseek: DEEPSEEK_DEFAULT_MODEL,
};

export function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && PROVIDERS.includes(value as LlmProvider);
}
