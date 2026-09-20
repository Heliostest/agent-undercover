'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_STRATEGY, STRATEGIES, STRATEGY_LABELS, type ThinkingStrategy } from '@/lib/agents/strategy';

import { BillHistory } from '@/components/BillHistory';
import { BillPanel } from '@/components/BillPanel';
import { GodPanel } from '@/components/GodPanel';
import { SeatCard } from '@/components/SeatCard';
import { SettingsForm } from '@/components/SettingsForm';
import { Timeline } from '@/components/Timeline';
import { TopBar } from '@/components/TopBar';
import { VoteBar } from '@/components/VoteBar';
import {
  browserStorage,
  clearStoredSettings,
  defaultSettings,
  loadSettings,
  saveSettings,
  type LlmSettings,
} from '@/lib/client/settings-storage';
import { useGameStream } from '@/lib/client/use-game-stream';

export default function HomePage() {
  // 首屏先用默认值渲染，挂载后再读 localStorage，避免服务端与客户端首帧不一致。
  const [settings, setSettings] = useState<LlmSettings>(defaultSettings);
  const [strategy, setStrategy] = useState<ThinkingStrategy>(DEFAULT_STRATEGY);
  const [storageError, setStorageError] = useState<string | null>(null);
  const { view, status, errorMessage, bill, start } = useGameStream();

  useEffect(() => {
    setSettings(loadSettings(browserStorage()));
  }, []);

  function updateSettings(next: LlmSettings) {
    setSettings(next);
    setStorageError(saveSettings(next, browserStorage()));
  }

  function clearKey() {
    const next = { ...settings, apiKey: '' };
    setSettings(next);
    clearStoredSettings(browserStorage());
    setStorageError(null);
  }

  const running = status === 'starting' || status === 'streaming';

  return (
    <main className="page">
      <TopBar view={view} status={status} onStart={() => void start(settings, strategy)} />
      <div className="panel">
        <label>思考方式 <select disabled={running} value={strategy} onChange={(e) => setStrategy(e.target.value as ThinkingStrategy)}>
          {STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>)}
        </select></label>
        <span className="muted"> 新思考方式仍处于实验阶段，会增加模型用量；可先查看对照结果。 </span>
        <a href="/lab">对照实验</a>
      </div>

      <SettingsForm
        settings={settings}
        disabled={running}
        storageError={storageError}
        onChange={updateSettings}
        onClearKey={clearKey}
      />

      {errorMessage ? <p className="panel danger">{errorMessage}</p> : null}

      {view ? (
        <>
          <section className="seat-grid">
            {view.seats.map((seat) => (
              <SeatCard key={seat.id} seat={seat} activeSeatId={view.activeSeatId} />
            ))}
          </section>
          <Timeline view={view} />
          <VoteBar view={view} />
          <GodPanel key={view.gameId} gameId={view.gameId} seats={view.seats} />
        </>
      ) : (
        <p className="panel muted">填好上面的模型设置，点「开始」让四个 AI 玩家自动打一局。</p>
      )}

      {bill ? <BillPanel bill={bill} seats={view?.seats ?? []} /> : null}

      <BillHistory latestBill={bill} />
    </main>
  );
}
