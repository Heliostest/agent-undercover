import { DEFAULT_MODELS, PROVIDER_LABELS, PROVIDERS, isLlmProvider } from '@/lib/llm/providers';
import type { LlmProvider } from '@/lib/llm/types';

export const SETTINGS_STORAGE_KEY = 'agent-undercover:llm-settings';
export const STORAGE_WRITE_ERROR = '浏览器拒绝保存设置（可能是隐私模式），本局仍可正常进行';

export interface LlmSettings {
  provider: LlmProvider;
  model: string;
  apiKey: string;
}

/** 只要求 localStorage 的三个方法，测试里塞个假对象就够了。 */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultSettings(): LlmSettings {
  return { provider: 'zhipu', model: DEFAULT_MODELS.zhipu, apiKey: '' };
}

/** localStorage 里的东西是用户可改的脏数据：任何异常都回落到默认值，绝不抛。 */
export function parseSettings(raw: string | null): LlmSettings {
  if (raw === null) {
    return defaultSettings();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultSettings();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return defaultSettings();
  }

  const source = parsed as Record<string, unknown>;
  const rawProvider = source.provider;
  const knownProvider = isLlmProvider(rawProvider);
  const provider = knownProvider ? rawProvider : defaultSettings().provider;
  // provider 不认识时连带它的 model 一起丢掉，避免把 gpt 挂到智谱上。
  const model = knownProvider && typeof source.model === 'string' && source.model.trim() !== ''
    ? source.model.trim()
    : DEFAULT_MODELS[provider];
  const apiKey = typeof source.apiKey === 'string' ? source.apiKey : '';

  return { provider, model, apiKey };
}

export function serializeSettings(settings: LlmSettings): string {
  return JSON.stringify(settings);
}

/** 返回给用户看的错误文案，或 null 表示可以开局。 */
export function validateSettings(settings: LlmSettings): string | null {
  if (!isLlmProvider(settings.provider)) {
    return `请选择供应商：${PROVIDERS.map((provider) => PROVIDER_LABELS[provider]).join(' 或 ')}`;
  }
  if (settings.model.trim() === '') {
    return '请先填写模型名再开局';
  }
  if (settings.provider !== 'omniroute' && settings.apiKey.trim() === '') {
    return '请先填写 API Key 再开局';
  }
  return null;
}

export function buildStartRequestBody(settings: LlmSettings): {
  provider: LlmProvider;
  model: string;
  apiKey: string;
} {
  return {
    provider: settings.provider,
    model: settings.model.trim(),
    apiKey: settings.provider === 'omniroute' ? '' : settings.apiKey.trim(),
  };
}

export function loadSettings(storage: SettingsStorage | null): LlmSettings {
  if (!storage) {
    return defaultSettings();
  }
  try {
    return parseSettings(storage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return defaultSettings();
  }
}

/** 写失败只返回提示文案，绝不影响本局。 */
export function saveSettings(settings: LlmSettings, storage: SettingsStorage | null): string | null {
  if (!storage) {
    return null;
  }
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
    return null;
  } catch {
    return STORAGE_WRITE_ERROR;
  }
}

export function clearStoredSettings(storage: SettingsStorage | null): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // 删不掉就算了，不能因为清理失败卡住界面。
  }
}

/** 服务端渲染时没有 window，返回 null 让上面几个函数走降级路径。 */
export function browserStorage(): SettingsStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
