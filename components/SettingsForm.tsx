'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  const isOmniroute = settings.provider === 'omniroute';
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    const current = settingsRef.current;
    try {
      const res = await fetch('/api/omniroute/models');
      const body = (await res.json()) as { models?: string[]; error?: string };
      if (!res.ok) {
        setModels([]);
        setModelsError(body.error ?? '无法拉取 OmniRoute 模型列表');
        onChangeRef.current({ ...current, provider: 'omniroute', model: '', apiKey: '' });
        return;
      }
      const list = Array.isArray(body.models) ? body.models : [];
      setModels(list);
      if (list.length === 0) {
        setModelsError('OmniRoute 未返回任何模型');
        onChangeRef.current({ ...current, provider: 'omniroute', model: '', apiKey: '' });
        return;
      }
      const preferred = DEFAULT_MODELS.omniroute;
      const nextModel = list.includes(current.model)
        ? current.model
        : list.includes(preferred)
          ? preferred
          : list[0];
      onChangeRef.current({ ...current, provider: 'omniroute', model: nextModel, apiKey: '' });
    } catch {
      setModels([]);
      setModelsError('无法拉取 OmniRoute 模型列表');
      onChangeRef.current({ ...current, provider: 'omniroute', model: '', apiKey: '' });
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOmniroute) {
      void refreshModels();
    } else {
      setModels([]);
      setModelsError(null);
    }
  }, [settings.provider, isOmniroute, refreshModels]);

  function changeProvider(provider: LlmProvider) {
    if (provider === 'omniroute') {
      onChange({ ...settings, provider, model: DEFAULT_MODELS.omniroute, apiKey: '' });
      return;
    }
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

        {isOmniroute ? (
          <label className="settings-field">
            <span className="settings-label">模型</span>
            <div className="settings-model-row">
              <select
                value={settings.model}
                disabled={disabled || modelsLoading || models.length === 0}
                onChange={(event) =>
                  onChange({ ...settings, model: event.target.value, apiKey: '' })
                }
              >
                {models.length === 0 ? (
                  <option value="">{modelsLoading ? '加载中…' : '暂无模型'}</option>
                ) : (
                  models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={() => void refreshModels()}
                disabled={disabled || modelsLoading}
              >
                {modelsLoading ? '刷新中…' : '刷新'}
              </button>
            </div>
          </label>
        ) : (
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
        )}

        {!isOmniroute ? (
          <>
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
          </>
        ) : null}
      </div>

      {modelsError && isOmniroute ? <p className="danger">{modelsError}</p> : null}
      {storageError ? <p className="danger">{storageError}</p> : null}
      <p className="muted">
        {isOmniroute
          ? '本地 OmniRoute 免填 Key：上游密钥配在 OmniRoute 内；模型列表经本机服务端代理拉取。'
          : 'Key 只保存在这台浏览器的 localStorage，并随「开始」请求发给本地服务端；服务端不写盘、不写日志。'}
      </p>
    </section>
  );
}
