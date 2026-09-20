export const STRATEGIES = ['baseline', 'evidence', 'deliberate', 'adaptive'] as const;
export type ThinkingStrategy = (typeof STRATEGIES)[number];
export const DEFAULT_STRATEGY: ThinkingStrategy = 'baseline';
export const STRATEGY_LABELS: Record<ThinkingStrategy, string> = {
  baseline: '直接思考（原版）',
  evidence: '证据与记忆（第一版）',
  deliberate: '比较与反向检查（第二版）',
  adaptive: '证据驱动的行动比较（第三版）',
};
export function isThinkingStrategy(value: unknown): value is ThinkingStrategy {
  return typeof value === 'string' && STRATEGIES.some((v) => v === value);
}
