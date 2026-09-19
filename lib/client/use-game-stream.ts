'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Bill } from '@/lib/billing/estimate';
import { applyEvent } from '@/lib/client/apply-event';
import { buildStartRequestBody, validateSettings, type LlmSettings } from '@/lib/client/settings-storage';
import type { GameEvent, PublicGameView } from '@/lib/game/types';

export type StreamStatus = 'idle' | 'starting' | 'streaming' | 'finished' | 'error';

export interface GameStream {
  view: PublicGameView | null;
  status: StreamStatus;
  errorMessage: string | null;
  /** 局末账单；开新局时清空。 */
  bill: Bill | null;
  start: (settings: LlmSettings) => Promise<void>;
}

const EVENT_NAMES = ['phase', 'speech', 'vote', 'result', 'error', 'bill'] as const;

export function useGameStream(): GameStream {
  const [view, setView] = useState<PublicGameView | null>(null);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  const start = useCallback(async (settings: LlmSettings) => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setView(null);
    setBill(null);
    setErrorMessage(null);

    // 先在本地拦一道，省得为了一个空 Key 跑一趟服务端。
    const invalid = validateSettings(settings);
    if (invalid !== null) {
      setErrorMessage(invalid);
      setStatus('error');
      return;
    }

    setStatus('starting');

    let response: Response;
    try {
      response = await fetch('/api/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildStartRequestBody(settings)),
      });
    } catch {
      setErrorMessage('无法连接服务端，请确认 npm run dev 正在运行');
      setStatus('error');
      return;
    }

    const payload = (await response.json()) as { gameId?: string; error?: string };
    if (!response.ok || !payload.gameId) {
      setErrorMessage(payload.error ?? '创建对局失败');
      setStatus('error');
      return;
    }

    const source = new EventSource(`/api/games/${payload.gameId}/events`);
    sourceRef.current = source;
    setStatus('streaming');

    let terminal = false;

    source.addEventListener('snapshot', (raw) => {
      setView(JSON.parse((raw as MessageEvent<string>).data) as PublicGameView);
    });

    for (const name of EVENT_NAMES) {
      source.addEventListener(name, (raw) => {
        const event = JSON.parse((raw as MessageEvent<string>).data) as GameEvent;
        setView((previous) => (previous ? applyEvent(previous, event) : previous));

        // 账单事件排在终局事件前面，这里先落袋，历史列表靠它写入 localStorage。
        if (event.type === 'bill') {
          setBill(event.bill);
        }
        if (event.type === 'error') {
          terminal = true;
          setErrorMessage(event.message);
          setStatus('error');
          source.close();
        }
        if (event.type === 'result' && event.winner !== null) {
          terminal = true;
          setStatus('finished');
          source.close();
        }
      });
    }

    source.onerror = () => {
      if (terminal) {
        return;
      }
      setErrorMessage('事件流连接中断，请点「再来一局」重试');
      setStatus('error');
      source.close();
    };
  }, []);

  return { view, status, errorMessage, bill, start };
}
