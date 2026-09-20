export const PRESET_LABELS = {
  first: '第一轮：原版 / 证据记忆（稀疏记录）',
  second: '第二轮：证据记忆 / 反向检查（稀疏记录）',
  third: '第三轮：原版 / 证据行动（完整发言）',
  holdout: '留出复测：原版 / 证据行动（2 个新场景，各跑 2 次）',
};
export type ExperimentPreset = keyof typeof PRESET_LABELS;
