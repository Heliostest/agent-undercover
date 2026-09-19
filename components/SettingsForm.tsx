'use client';

import type { LlmSettings } from '@/lib/client/settings-storage';
import { DEFAULT_MODELS, PROVIDERS, PROVIDER_LABELS } from '@/lib/llm/providers';
import type { LlmProvider } from '@/lib/llm/types';

export interface SettingsFormProps {
  settings: LlmSettings;
  disabled: boolean;
  storageError: string | null;
  onChange: (next: LlmSettings) => void;
  onClearKey: () => void;
}

export function SettingsForm({
  settings,
  disabled,
  storageError,
  onChange,
  onClearKey,
}: SettingsFormProps) {
  // 换供应商时把模型也换成新供应商的默认值，省得拿智谱模型去打 DeepSeek。
  function changeProvider(provider: LlmProvider) {
    onChange({ ...settings, provider, model: DEFAULT_MODELS[provider] });
  }

  return (
    <section className="panel settings">
      <h2 className="section-title">模型设置（只存在你自己的浏览器里）</h2>

      <div className="settings-row">
        <label className="settings-field">
          <span className="settings-label">供应商</span>
          <select
            value={settings.provider}
            disabled={disabled}
            onChange={(event) => changeProvider(event.target.value as LlmProvider)}
          >
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-field">
          <span className="settings-label">模型</span>
          <input
            type="text"
            value={settings.model}
            disabled={disabled}
            placeholder={DEFAULT_MODELS[settings.provider]}
            onChange={(event) => onChange({ ...settings, model: event.target.value })}
          />
        </label>

        <label className="settings-field settings-field-wide">
          <span className="settings-label">API Key</span>
          <input
            type="password"
            value={settings.apiKey}
            disabled={disabled}
            autoComplete="off"
            placeholder="只会随本局请求发给服务端，不落盘"
            onChange={(event) => onChange({ ...settings, apiKey: event.target.value })}
          />
        </label>

        <button type="button" onClick={onClearKey} disabled={disabled}>
          清除已保存的 Key
        </button>
      </div>

      {storageError ? <p className="danger">{storageError}</p> : null}
      <p className="muted">
        Key 只保存在这台浏览器的 localStorage，并随「开始」请求发给本地服务端；服务端不写盘、不写日志。
      </p>
    </section>
  );
}
