import { describe, expect, it, vi } from 'vitest';

import { buildBill, type Bill } from '@/lib/billing/estimate';
import type { UsageRecord } from '@/lib/billing/ledger';
import {
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  HISTORY_WRITE_ERROR,
  appendBill,
  clearHistory,
  loadHistory,
  parseHistory,
  removeBill,
  saveHistory,
  serializeHistory,
} from '@/lib/client/bill-history';
import type { SettingsStorage } from '@/lib/client/settings-storage';

function record(): UsageRecord {
  return {
    callId: 'c-1',
    at: 1_000,
    seatId: 0,
    phase: 'speak',
    provider: 'deepseek',
    model: 'deepseek-chat',
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    cacheHitTokens: 800,
    cacheMissTokens: 200,
    usageReported: true,
    cacheReported: true,
  };
}

function bill(gameId: string): Bill {
  return buildBill({
    gameId,
    provider: 'deepseek',
    model: 'deepseek-chat',
    finishedAt: 5_000,
    records: [record()],
  });
}

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

describe('parseHistory', () => {
  it('null / 非法 JSON / 非数组都得到空列表', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('{坏掉的')).toEqual([]);
    expect(parseHistory('{"gameId":"g-1"}')).toEqual([]);
  });

  it('序列化后能原样读回', () => {
    const entries = [{ gameId: 'g-1', savedAt: 10, bill: bill('g-1') }];
    expect(parseHistory(serializeHistory(entries))).toEqual(entries);
  });

  it('丢掉结构不合法的条目，保留合法的', () => {
    const good = { gameId: 'g-1', savedAt: 10, bill: bill('g-1') };
    const raw = JSON.stringify([good, { gameId: 'g-2' }, null, 42]);

    expect(parseHistory(raw)).toEqual([good]);
  });
});

describe('appendBill', () => {
  it('新账单排在最前面', () => {
    const first = appendBill([], bill('g-1'), 10);
    const second = appendBill(first, bill('g-2'), 20);

    expect(second.map((entry) => entry.gameId)).toEqual(['g-2', 'g-1']);
    expect(second[0].savedAt).toBe(20);
  });

  it('同一局重复写入只保留最新一条', () => {
    const entries = appendBill(appendBill([], bill('g-1'), 10), bill('g-1'), 30);

    expect(entries).toHaveLength(1);
    expect(entries[0].savedAt).toBe(30);
  });

  it(`最多保留 ${HISTORY_LIMIT} 条，超出的最旧记录被丢掉`, () => {
    let entries = [] as ReturnType<typeof appendBill>;
    for (let index = 0; index <= HISTORY_LIMIT; index += 1) {
      entries = appendBill(entries, bill(`g-${index}`), index);
    }

    expect(entries).toHaveLength(HISTORY_LIMIT);
    expect(entries[0].gameId).toBe(`g-${HISTORY_LIMIT}`);
    expect(entries.some((entry) => entry.gameId === 'g-0')).toBe(false);
  });

  it('不改传入的数组', () => {
    const original = appendBill([], bill('g-1'), 10);
    appendBill(original, bill('g-2'), 20);

    expect(original).toHaveLength(1);
  });
});

describe('removeBill', () => {
  it('按 gameId 删一条，其余不动', () => {
    const entries = appendBill(appendBill([], bill('g-1'), 10), bill('g-2'), 20);

    expect(removeBill(entries, 'g-1').map((entry) => entry.gameId)).toEqual(['g-2']);
    expect(removeBill(entries, '不存在')).toHaveLength(2);
  });
});

describe('loadHistory / saveHistory / clearHistory', () => {
  it('存进去能原样读回来', () => {
    const { storage } = memoryStorage();
    const entries = appendBill([], bill('g-1'), 10);

    expect(saveHistory(entries, storage)).toBeNull();
    expect(loadHistory(storage)).toEqual(entries);
  });

  it('storage 为 null 时返回空列表且不抛', () => {
    expect(loadHistory(null)).toEqual([]);
    expect(saveHistory([], null)).toBeNull();
    expect(() => clearHistory(null)).not.toThrow();
  });

  it('写入失败时返回可读提示', () => {
    const { storage } = memoryStorage();
    const failing: SettingsStorage = {
      ...storage,
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
    };

    expect(saveHistory(appendBill([], bill('g-1'), 10), failing)).toBe(HISTORY_WRITE_ERROR);
  });

  it('clearHistory 删掉整条记录', () => {
    const { storage, map } = memoryStorage();
    saveHistory(appendBill([], bill('g-1'), 10), storage);

    clearHistory(storage);

    expect(map.has(HISTORY_STORAGE_KEY)).toBe(false);
    expect(loadHistory(storage)).toEqual([]);
  });
});

describe('历史里不含 API Key', () => {
  it('序列化结果里既没有 apiKey 字段也没有 Key 值', () => {
    const serialized = serializeHistory(appendBill([], bill('g-1'), 10));

    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('sk-');
    expect(serialized).toContain('deepseek-chat');
  });
});
