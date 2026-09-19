import { describe, expect, it, vi } from 'vitest';

import {
  SETTINGS_STORAGE_KEY,
  STORAGE_WRITE_ERROR,
  buildStartRequestBody,
  clearStoredSettings,
  defaultSettings,
  loadSettings,
  parseSettings,
  saveSettings,
  serializeSettings,
  validateSettings,
  type LlmSettings,
  type SettingsStorage,
} from '@/lib/client/settings-storage';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: SettingsStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return { storage, map };
}

const FILLED: LlmSettings = { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-1' };

describe('defaultSettings', () => {
  it('默认是智谱 + glm-4-flash + 空 Key', () => {
    expect(defaultSettings()).toEqual({ provider: 'zhipu', model: 'glm-4-flash', apiKey: '' });
  });
});

describe('parseSettings', () => {
  it('完整 JSON 原样读回', () => {
    expect(parseSettings(serializeSettings(FILLED))).toEqual(FILLED);
  });

  it('null / 非法 JSON / 非对象都回落到默认值', () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings('{坏掉的')).toEqual(defaultSettings());
    expect(parseSettings('"zhipu"')).toEqual(defaultSettings());
    expect(parseSettings('[]')).toEqual(defaultSettings());
  });

  it('未知 provider 回落到默认供应商与默认模型', () => {
    expect(parseSettings('{"provider":"openai","model":"gpt","apiKey":"k"}')).toEqual({
      provider: 'zhipu',
      model: 'glm-4-flash',
      apiKey: 'k',
    });
  });

  it('model 缺失时按该供应商默认模型补齐', () => {
    expect(parseSettings('{"provider":"deepseek","apiKey":"k"}')).toEqual({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'k',
    });
  });

  it('apiKey 不是字符串时当作空', () => {
    expect(parseSettings('{"provider":"zhipu","model":"glm-4-flash","apiKey":123}').apiKey).toBe('');
  });
});

describe('validateSettings', () => {
  it('三项齐全时返回 null', () => {
    expect(validateSettings(FILLED)).toBeNull();
  });

  it('空 Key 给出可读提示', () => {
    expect(validateSettings({ ...FILLED, apiKey: '   ' })).toBe('请先填写 API Key 再开局');
  });

  it('空模型给出可读提示', () => {
    expect(validateSettings({ ...FILLED, model: '' })).toBe('请先填写模型名再开局');
  });

  it('非法 provider 给出可读提示', () => {
    expect(
      validateSettings({ ...FILLED, provider: 'openai' as LlmSettings['provider'] }),
    ).toBe('请选择供应商：智谱 或 DeepSeek');
  });
});

describe('buildStartRequestBody', () => {
  it('只带 provider / model / apiKey 三项，并 trim', () => {
    expect(buildStartRequestBody({ provider: 'deepseek', model: ' m ', apiKey: ' k ' })).toEqual({
      provider: 'deepseek',
      model: 'm',
      apiKey: 'k',
    });
  });

  it('返回对象的键固定为这三个，不会夹带别的状态', () => {
    expect(Object.keys(buildStartRequestBody(FILLED)).sort()).toEqual([
      'apiKey',
      'model',
      'provider',
    ]);
  });
});

describe('loadSettings / saveSettings / clearStoredSettings', () => {
  it('存进去能原样读回来（刷新后 Key 仍在）', () => {
    const { storage } = memoryStorage();

    expect(saveSettings(FILLED, storage)).toBeNull();
    expect(loadSettings(storage)).toEqual(FILLED);
  });

  it('storage 为 null（服务端渲染）时返回默认值且不抛', () => {
    expect(loadSettings(null)).toEqual(defaultSettings());
    expect(saveSettings(FILLED, null)).toBeNull();
    expect(() => clearStoredSettings(null)).not.toThrow();
  });

  it('写入失败（隐私模式）时返回可读提示而不是抛错', () => {
    const { storage } = memoryStorage();
    const failing: SettingsStorage = {
      ...storage,
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
    };

    expect(saveSettings(FILLED, failing)).toBe(STORAGE_WRITE_ERROR);
  });

  it('读取时 storage 抛错也回落到默认值', () => {
    const failing: SettingsStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {},
    };

    expect(loadSettings(failing)).toEqual(defaultSettings());
  });

  it('clearStoredSettings 删掉整条记录', () => {
    const { storage, map } = memoryStorage();
    saveSettings(FILLED, storage);

    clearStoredSettings(storage);

    expect(map.has(SETTINGS_STORAGE_KEY)).toBe(false);
    expect(loadSettings(storage)).toEqual(defaultSettings());
  });
});
