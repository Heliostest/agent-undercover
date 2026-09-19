# DeepSeek 配置 + Token 用量 + 每局账单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有 v1 旁观局（`Heliostest/agent-undercover` main 分支）上加一层「网页里配供应商 / 模型 / API Key → 每次 LLM 调用记录 token 与缓存命中 → 局末推送一份估算账单并在浏览器保存历史」。

**Architecture:** `LlmClient.complete()` 的返回值从 `string` 升级成 `{ text, usage }`，智谱与 DeepSeek 共用一个 OpenAI 兼容 chat completions 核心（`lib/llm/openai-compatible.ts`），差异只有 baseUrl / 供应商名 / 缓存字段形态；一个纯内存的 `UsageLedger` 随 session 建立，四个 `PlayerAgent` 每次成功调用后往里追加一条 `UsageRecord`；`createBillEmitter` 包住 Judge 的 `emit`，在终局事件（`result` 带 winner 或 `error`）**之前**插一条 `bill` 事件，因为 SSE 路由见到终局事件就会关流；浏览器用现有的 `applyEvent` 把 `bill` 归约进 `PublicGameView`，再由纯函数模块写入 localStorage 历史。API Key 只沿着 `POST /api/games` 的请求体进入该局 session 内存，不落盘、不进日志、不进历史。

**Tech Stack:** Next.js 15（App Router）、React 19、TypeScript 5.9（strict）、Vitest 3（node 环境，`tests/**/*.test.ts`）、原生 `fetch` + SSE、智谱 BigModel 与 DeepSeek 的 OpenAI 兼容 chat completions 接口、浏览器 `localStorage`。无新增运行时依赖。

## Global Constraints

本节是全局约束，每个 Task 的要求都隐含包含它们。

- **一局一个供应商**：同一局不混用多个供应商；`provider` 在开局时固定，写进每条 `UsageRecord` 与 `Bill`。
- **Key 仅 session 内存**：API Key 只随 `POST /api/games` 请求体进入该局 session 内存；不写盘、不写日志、不进 SSE 事件、不进账单历史。任何错误文案都不得回显 Key。
- **账单标估算**：`Bill.estimated` 恒为 `true`，`notes[0]` 恒为常量 `BILL_ESTIMATE_NOTE = '本账单为本地估算，实际费用以供应商官方账单为准。'`。
- **每次调用明细含 cache**：每条 `UsageRecord` 带 `cacheHitTokens` / `cacheMissTokens` / `cacheReported`；响应里没有缓存字段时 `cacheReported: false`，UI 显示 `CACHE_UNKNOWN_TEXT = '未提供'`。
- **usage 整段缺失**：tokens 一律记 0、`usageReported: false`、`cacheReported: false`，并在账单 `notes` 里注明「有 N 次调用没有返回 usage，这些调用按 0 token 计入。」。
- **计价内置**：`lib/billing/prices.ts` 是唯一价目表，单位 **CNY / 1K tokens**；未知 model 走该供应商的 `fallback` 档并在 `notes` 里说明；网页**不提供**改价入口。
- **本迭代非目标**（不要顺手做）：服务端持久化账单或 Key、登录 / 多用户账本、网页自定义单价、同局混用多供应商、浏览器 E2E。
- **测试纪律**：LLM 一律 mock（`fetchImpl` 注入或脚本化 `LlmClient`），任何测试都不得发真实外网请求；`npm test` 环境是 node，没有 DOM，因此 React 组件不写单测，靠 `typecheck` + `build` + 手工验收兜底。
- **Node.js >= 20.9**；包管理 npm；不新增依赖。
- **语言**：注释与用户可见文案中文，标识符与代码英文。
- **每个 Task 的收尾**：`npm test` 与 `npm run typecheck` 必须全绿后才提交。

---

## File Structure

### 新建

| 文件 | 职责 |
|------|------|
| `lib/llm/usage.ts` | `emptyUsage()` / `parseUsage()`：把 OpenAI 兼容响应的 `usage` 段（含两种缓存字段形态）映射成 `LlmUsage` |
| `lib/llm/openai-compatible.ts` | 智谱与 DeepSeek 共用的 chat completions 核心：超时、退避重试、错误文案、usage 解析 |
| `lib/llm/deepseek.ts` | DeepSeek 客户端（baseUrl、默认模型、供应商名） |
| `lib/llm/providers.ts` | 供应商常量单一来源：`PROVIDERS` / `PROVIDER_LABELS` / `DEFAULT_MODELS` / `isLlmProvider()`；不含任何 HTTP 逻辑，前后端都能安全引用 |
| `lib/llm/create-client.ts` | `parseLlmConfig()`（请求体校验）+ `createLlmClient()`（按 provider 分发） |
| `lib/billing/ledger.ts` | `UsagePhase` / `UsageRecord` / `UsageSink` / `UsageLedger`：一局一个的内存流水账 |
| `lib/billing/prices.ts` | 内置 CNY/1K tokens 价目表与查价函数 |
| `lib/billing/estimate.ts` | `Bill` / `SeatBill` / `BillTotals` 类型与 `buildBill()`：由流水账算出估算账单 |
| `lib/billing/bill-emitter.ts` | 包住 Judge 的 `emit`，在终局事件前插一条 `bill` 事件（每局只插一次） |
| `lib/client/settings-storage.ts` | 模型设置的 localStorage 读写、校验、开局请求体构造（纯函数为主） |
| `lib/client/bill-history.ts` | 账单历史的 localStorage 读写与增删（纯函数为主） |
| `lib/client/bill-format.ts` | 账单展示用的格式化纯函数（金额、token、缓存单元格、时间） |
| `components/SettingsForm.tsx` | 供应商 / 模型 / API Key 表单 |
| `components/BillPanel.tsx` | 局末账单：总览 + 按座位 + 可展开的每次调用明细 |
| `components/BillHistory.tsx` | 历史账单列表（新→旧），支持展开、删除单条、清空 |
| `tests/llm/usage.test.ts` | `parseUsage` 的字段映射与容错 |
| `tests/llm/deepseek.test.ts` | DeepSeek 客户端请求形态、缓存字段映射、重试 |
| `tests/llm/create-client.test.ts` | `parseLlmConfig` 校验矩阵 + `createLlmClient` 分发 |
| `tests/billing/ledger.test.ts` | `UsageLedger` 追加与快照语义 |
| `tests/billing/prices.test.ts` | 查价与未知模型回退 |
| `tests/billing/estimate.test.ts` | 估价、按座位汇总、notes 文案 |
| `tests/billing/bill-emitter.test.ts` | bill 事件必须在终局事件之前且只发一次 |
| `tests/client/settings-storage.test.ts` | 设置的解析 / 序列化 / 校验 / 存储容错 / 请求体构造 |
| `tests/client/bill-history.test.ts` | 历史的解析 / 追加去重 / 截断 / 删除 / 不含 Key |

### 修改

| 文件 | 改动 |
|------|------|
| `lib/llm/types.ts` | 新增 `LlmProvider` / `LlmUsage` / `LlmCompletion`；`LlmClient` 增加只读 `provider` / `model`，`complete()` 返回 `LlmCompletion` |
| `lib/llm/zhipu.ts` | 改为 `createOpenAiCompatibleClient` 的薄封装；删除 `MissingApiKeyError` 与 `readZhipuConfigFromEnv`（Key 不再来自环境变量） |
| `lib/agents/player-agent.ts` | `PlayerAgentDeps` 增加 `seatId` 与 `onUsage`；每次成功调用后上报用量 |
| `lib/game/types.ts` | `GameEvent` 增加 `bill` 分支；`PublicGameView` 增加 `bill: Bill \| null` |
| `lib/game/state.ts` | `toPublicView()` 补 `bill: null` |
| `lib/game/bootstrap.ts` | 不再读环境变量；接受 `llmConfig`，建 `UsageLedger`、装配 `onUsage`、用 `createBillEmitter` 包住 `publish` |
| `app/api/games/route.ts` | 读并校验请求体，400 分支改成 `InvalidLlmConfigError` |
| `lib/client/apply-event.ts` | 新增 `bill` 分支 |
| `lib/client/use-game-stream.ts` | `start(settings)` 带请求体、订阅 `bill` 事件、对外暴露 `bill` |
| `app/page.tsx` | 装配 `SettingsForm` / `BillPanel` / `BillHistory` 与设置状态 |
| `app/globals.css` | 新增账单与表单用的类 |
| `README.md` | 环境变量表、快速开始、SSE 事件列表、容错小节 |
| `tests/llm/zhipu.test.ts` | 适配新的返回形态，删掉 env 相关用例 |
| `tests/agents/player-agent.test.ts` | 适配 `LlmCompletion` 与 `seatId`，新增用量上报用例 |
| `tests/game/bootstrap.test.ts` | 适配 `llmConfig`，新增 bill 事件用例 |
| `tests/api/routes.test.ts` | 请求体校验用例 + SSE 里 bill 在 result 之前 |
| `tests/client/apply-event.test.ts` | 基线视图补 `bill: null`，新增 bill 归约用例 |

### 不动

`lib/game/judge.ts`（Judge 只认注入的 `emit`，账单在外层包装，不改判定逻辑）、`lib/game/session.ts`、`lib/game/registry.ts`、`lib/game/rules.ts`、`lib/game/word-bank.ts`、`lib/agents/prompt.ts`、`lib/agents/personas.ts`、`app/api/games/[gameId]/events/route.ts`（`frame(event.type, event)` 天然支持新事件名）、`app/api/games/[gameId]/reveal/route.ts`、`components/SeatCard.tsx` / `Timeline.tsx` / `VoteBar.tsx` / `TopBar.tsx` / `GodPanel.tsx`。

---

## Task 依赖顺序

```
Task 1  (LLM 用量类型 + usage 映射 + 智谱适配)
  ├─ Task 2 (OpenAI 兼容核心 + DeepSeek 客户端)
  │    └─ Task 3 (providers + createLlmClient + parseLlmConfig)
  ├─ Task 4 (UsageLedger) ── Task 7 (PlayerAgent 上报)
  └─ Task 5 (价目表) ── Task 6 (buildBill) ── Task 8 (bill 事件 + emitter + 视图)
                                                  └─ Task 9 (bootstrap + POST 请求体)
                                                       └─ Task 11 (SSE hook)
Task 10 (settings-storage) ── Task 11 ── Task 13 (SettingsForm + page)
Task 12 (bill-history) ── Task 15 (BillHistory + 文档 + 验收)
Task 6 ── Task 14 (bill-format + BillPanel)
```

---

### Task 1: LLM 用量类型与 usage/cache 映射

把 `LlmClient.complete()` 的返回值从 `string` 升级成 `{ text, usage }`，并给客户端加上只读的 `provider` / `model`。这是一次必须原子落地的类型迁移：同一个 Task 里要把智谱客户端、`PlayerAgent` 和三个测试里的假模型一起改完，否则 `npm run typecheck` 不会绿。

**Files:**
- Modify: `lib/llm/types.ts`
- Create: `lib/llm/usage.ts`
- Modify: `lib/llm/zhipu.ts:56-111`
- Modify: `lib/agents/player-agent.ts:62-70`
- Create: `tests/llm/usage.test.ts`
- Modify: `tests/llm/zhipu.test.ts`
- Modify: `tests/agents/player-agent.test.ts:27-38`
- Modify: `tests/game/bootstrap.test.ts:9-21`
- Modify: `tests/api/routes.test.ts:9-21`

**Interfaces:**
- Consumes: 现有 `LlmMessage` / `LlmCompleteOptions` / `LlmError` / `createZhipuClient`。
- Produces:
  - `type LlmProvider = 'zhipu' | 'deepseek'`
  - `interface LlmUsage { promptTokens: number; completionTokens: number; totalTokens: number; cacheHitTokens: number; cacheMissTokens: number; usageReported: boolean; cacheReported: boolean }`
  - `interface LlmCompletion { text: string; usage: LlmUsage }`
  - `interface LlmClient { readonly provider: LlmProvider; readonly model: string; complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<LlmCompletion> }`
  - `emptyUsage(): LlmUsage`
  - `parseUsage(raw: unknown): LlmUsage`

- [ ] **Step 1: 写 `parseUsage` 的失败测试**

创建 `tests/llm/usage.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { emptyUsage, parseUsage } from '@/lib/llm/usage';

describe('emptyUsage', () => {
  it('全零且两个 reported 标记都是 false', () => {
    expect(emptyUsage()).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      usageReported: false,
      cacheReported: false,
    });
  });

  it('每次都返回新对象，调用方改了不会污染下一次', () => {
    const first = emptyUsage();
    first.promptTokens = 99;
    expect(emptyUsage().promptTokens).toBe(0);
  });
});

describe('parseUsage', () => {
  it('整段 usage 缺失时记 0 并标记未上报', () => {
    expect(parseUsage(undefined)).toEqual(emptyUsage());
    expect(parseUsage(null)).toEqual(emptyUsage());
    expect(parseUsage('usage')).toEqual(emptyUsage());
  });

  it('token 字段不是数字时视为未上报', () => {
    expect(parseUsage({ prompt_tokens: 'x', completion_tokens: null })).toEqual(emptyUsage());
  });

  it('只有 token 没有缓存字段时 cacheReported 为 false', () => {
    expect(parseUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 })).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      usageReported: true,
      cacheReported: false,
    });
  });

  it('缺 total_tokens 时用 prompt + completion 补上', () => {
    expect(parseUsage({ prompt_tokens: 120, completion_tokens: 30 }).totalTokens).toBe(150);
  });

  it('映射 DeepSeek 的 prompt_cache_hit_tokens / prompt_cache_miss_tokens', () => {
    expect(
      parseUsage({
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_cache_hit_tokens: 64,
        prompt_cache_miss_tokens: 56,
      }),
    ).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cacheHitTokens: 64,
      cacheMissTokens: 56,
      usageReported: true,
      cacheReported: true,
    });
  });

  it('只给了 miss 时用 prompt - miss 反推 hit', () => {
    const usage = parseUsage({
      prompt_tokens: 120,
      completion_tokens: 30,
      prompt_cache_miss_tokens: 100,
    });
    expect(usage.cacheHitTokens).toBe(20);
    expect(usage.cacheMissTokens).toBe(100);
    expect(usage.cacheReported).toBe(true);
  });

  it('映射 OpenAI / 智谱风格的 prompt_tokens_details.cached_tokens', () => {
    const usage = parseUsage({
      prompt_tokens: 120,
      completion_tokens: 30,
      prompt_tokens_details: { cached_tokens: 80 },
    });
    expect(usage.cacheHitTokens).toBe(80);
    expect(usage.cacheMissTokens).toBe(40);
    expect(usage.cacheReported).toBe(true);
  });

  it('cached_tokens 超过 prompt_tokens 时截断，未命中不会变成负数', () => {
    const usage = parseUsage({
      prompt_tokens: 50,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 999 },
    });
    expect(usage.cacheHitTokens).toBe(50);
    expect(usage.cacheMissTokens).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/llm/usage.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/llm/usage"`。

- [ ] **Step 3: 扩写 `lib/llm/types.ts`**

把整个文件替换为：

```ts
export type LlmProvider = 'zhipu' | 'deepseek';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteOptions {
  temperature?: number;
  maxTokens?: number;
}

/** 一次调用的 token 与缓存用量；供应商没给的部分记 0，并把对应的 reported 标成 false。 */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  /** 响应里完全没有可用的 usage 段时为 false，账单会据此注明「未返回 usage」。 */
  usageReported: boolean;
  /** 响应里没有任何缓存字段时为 false，界面显示「未提供」而不是 0。 */
  cacheReported: boolean;
}

export interface LlmCompletion {
  text: string;
  usage: LlmUsage;
}

export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<LlmCompletion>;
}

export class LlmError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}
```

- [ ] **Step 4: 实现 `lib/llm/usage.ts`**

```ts
import type { LlmUsage } from '@/lib/llm/types';

export function emptyUsage(): LlmUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    usageReported: false,
    cacheReported: false,
  };
}

/** 只接受有限的非负数，其余（字符串、null、NaN、负数）一律当作「没给」。 */
function toCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

/**
 * 把 OpenAI 兼容响应里的 usage 段映射成 LlmUsage。
 * 缓存字段有两种形态：DeepSeek 给 prompt_cache_hit_tokens / prompt_cache_miss_tokens，
 * 智谱（以及 OpenAI 风格）给 prompt_tokens_details.cached_tokens；两种都没有就是没报缓存。
 */
export function parseUsage(raw: unknown): LlmUsage {
  const usage = emptyUsage();
  if (typeof raw !== 'object' || raw === null) {
    return usage;
  }

  const source = raw as Record<string, unknown>;
  const prompt = toCount(source.prompt_tokens);
  const completion = toCount(source.completion_tokens);
  const total = toCount(source.total_tokens);
  if (prompt === null && completion === null && total === null) {
    return usage;
  }

  usage.usageReported = true;
  usage.promptTokens = prompt ?? 0;
  usage.completionTokens = completion ?? 0;
  usage.totalTokens = total ?? usage.promptTokens + usage.completionTokens;

  const hit = toCount(source.prompt_cache_hit_tokens);
  const miss = toCount(source.prompt_cache_miss_tokens);
  if (hit !== null || miss !== null) {
    usage.cacheReported = true;
    usage.cacheHitTokens = hit ?? Math.max(usage.promptTokens - (miss ?? 0), 0);
    usage.cacheMissTokens = miss ?? Math.max(usage.promptTokens - usage.cacheHitTokens, 0);
    return usage;
  }

  const details = source.prompt_tokens_details;
  const cached =
    typeof details === 'object' && details !== null
      ? toCount((details as Record<string, unknown>).cached_tokens)
      : null;
  if (cached !== null) {
    usage.cacheReported = true;
    usage.cacheHitTokens = Math.min(cached, usage.promptTokens);
    usage.cacheMissTokens = Math.max(usage.promptTokens - usage.cacheHitTokens, 0);
  }

  return usage;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/llm/usage.test.ts`
Expected: PASS，11 个用例全绿。

- [ ] **Step 6: 让智谱客户端返回 `LlmCompletion`**

修改 `lib/llm/zhipu.ts`：第 1 行的 import 换成下面这句，`attempt` 的签名与返回、以及 `return` 的对象字面量按下面改（其余部分不动）。

```ts
import { parseUsage } from '@/lib/llm/usage';
import {
  LlmError,
  type LlmClient,
  type LlmCompleteOptions,
  type LlmCompletion,
  type LlmMessage,
} from '@/lib/llm/types';
```

```ts
  async function attempt(
    messages: LlmMessage[],
    completeOptions?: LlmCompleteOptions,
  ): Promise<LlmCompletion> {
```

```ts
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: unknown;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new LlmError('智谱接口返回了空内容');
      }
      return { text: content, usage: parseUsage(payload.usage) };
```

```ts
  return {
    provider: 'zhipu',
    model: options.model,
    async complete(messages, completeOptions) {
      let lastError: unknown = new LlmError('智谱请求未执行');
      for (let retry = 0; retry <= maxRetries; retry += 1) {
        try {
          return await attempt(messages, completeOptions);
        } catch (error) {
          lastError = error;
          if (!isRetryable(error) || retry === maxRetries) {
            break;
          }
          await sleep(RETRY_BASE_DELAY_MS * 2 ** retry);
        }
      }
      throw lastError instanceof Error ? lastError : new LlmError(String(lastError));
    },
  };
```

- [ ] **Step 7: 让 `PlayerAgent` 取 `.text`**

修改 `lib/agents/player-agent.ts`：把第 9 行的 import 改成同时引入 `LlmMessage`，并替换 `tryComplete`。

```ts
import type { LlmClient, LlmMessage } from '@/lib/llm/types';
```

```ts
  /** 模型调用失败不向外抛：交给下一次尝试，用尽后由调用方走兜底。 */
  private async tryComplete(messages: LlmMessage[]): Promise<string | null> {
    try {
      const completion = await this.deps.llm.complete(messages, {
        temperature: this.deps.temperature ?? DEFAULT_AGENT_TEMPERATURE,
      });
      return completion.text;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 8: 更新智谱测试**

修改 `tests/llm/zhipu.test.ts`：`okResponse` 支持带 usage；断言从 `toBe('文本')` 改成 `toMatchObject({ text: '文本' })`；补两条 usage 用例。完整替换文件内容为：

```ts
import { describe, expect, it, vi } from 'vitest';

import { ZHIPU_DEFAULT_BASE_URL, createZhipuClient } from '@/lib/llm/zhipu';

function okResponse(content: string, usage?: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: '炸了' } }), { status });
}

function makeClient(fetchImpl: typeof fetch, sleep = vi.fn(async () => {})) {
  const client = createZhipuClient({
    apiKey: 'test-key',
    model: 'glm-4-flash',
    fetchImpl,
    sleep,
  });
  return { client, sleep };
}

describe('createZhipuClient', () => {
  it('暴露 provider 与 model，供账单记录用', () => {
    const { client } = makeClient(vi.fn() as unknown as typeof fetch);
    expect(client.provider).toBe('zhipu');
    expect(client.model).toBe('glm-4-flash');
  });

  it('把消息发到 chat/completions 并返回首个 choice 的文本', async () => {
    const fetchImpl = vi.fn(async () => okResponse('白白的液体'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: '描述一下' }], {
      temperature: 0.2,
    });

    expect(completion.text).toBe('白白的液体');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ZHIPU_DEFAULT_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'glm-4-flash',
      temperature: 0.2,
      stream: false,
      messages: [{ role: 'user', content: '描述一下' }],
    });
  });

  it('响应带 usage 时映射成 LlmUsage', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse('白白的液体', {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 80 },
      }),
    );
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: 'hi' }]);

    expect(completion.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cacheHitTokens: 80,
      cacheMissTokens: 40,
      usageReported: true,
      cacheReported: true,
    });
  });

  it('响应没有 usage 时记 0 并标记未上报', async () => {
    const fetchImpl = vi.fn(async () => okResponse('白白的液体'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: 'hi' }]);

    expect(completion.usage.usageReported).toBe(false);
    expect(completion.usage.cacheReported).toBe(false);
    expect(completion.usage.totalTokens).toBe(0);
  });

  it('429 后退避重试并最终成功，退避是 500ms / 1000ms', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse('成功'));
    const { client, sleep } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      text: '成功',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('5xx 重试用尽后抛 LlmError', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '智谱接口返回 500',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('4xx（非 429）立即失败，不重试', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(400));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '智谱接口返回 400',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('网络错误也会重试', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(okResponse('恢复了'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      text: '恢复了',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('内容为空时按错误处理', async () => {
    const fetchImpl = vi.fn(async () => okResponse('   '));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '智谱接口返回了空内容',
    );
  });
});
```

注意：`readZhipuConfigFromEnv` / `MissingApiKeyError` 的三条用例在这里被删掉了，但这两个导出本身要到 Task 9 才删（`app/api/games/route.ts` 还在引用）。

- [ ] **Step 9: 更新三个假模型**

`tests/agents/player-agent.test.ts`：把第 10 行的 import 和 `scriptedLlm` 换成：

```ts
import type { LlmClient, LlmUsage } from '@/lib/llm/types';
```

```ts
const SAMPLE_USAGE: LlmUsage = {
  promptTokens: 120,
  completionTokens: 30,
  totalTokens: 150,
  cacheHitTokens: 64,
  cacheMissTokens: 56,
  usageReported: true,
  cacheReported: true,
};

function scriptedLlm(
  replies: Array<string | Error>,
  usage: LlmUsage = SAMPLE_USAGE,
): LlmClient & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async () => {
    const next = replies.shift();
    if (next === undefined) {
      throw new Error('脚本用尽：不应该再调用模型');
    }
    if (next instanceof Error) {
      throw next;
    }
    return { text: next, usage };
  });
  return { provider: 'zhipu', model: 'glm-4-flash', complete } as unknown as LlmClient & {
    complete: ReturnType<typeof vi.fn>;
  };
}
```

`tests/game/bootstrap.test.ts` 与 `tests/api/routes.test.ts`：两个文件里的 `fakeLlm` 统一换成下面这份（两处代码完全一致，直接各粘一份）：

```ts
/** 永远给出合法发言与合法投票（总投候选里的第一个）的假模型，并固定上报一份 usage。 */
function fakeLlm(): LlmClient {
  return {
    provider: 'zhipu',
    model: 'glm-4-flash',
    async complete(messages) {
      const prompt = messages[messages.length - 1].content;
      const text = prompt.includes('"speech"')
        ? '{"speech":"一种常见的日常事物"}'
        : `{"vote":${Number(prompt.match(/可投的座位号：(\d+)/)?.[1] ?? 0)},"reason":"先投票再说"}`;
      return {
        text,
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          cacheHitTokens: 64,
          cacheMissTokens: 36,
          usageReported: true,
          cacheReported: true,
        },
      };
    },
  };
}
```

- [ ] **Step 10: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS，两条命令都无报错。

- [ ] **Step 11: 提交**

```bash
git add lib/llm/types.ts lib/llm/usage.ts lib/llm/zhipu.ts lib/agents/player-agent.ts tests/llm/usage.test.ts tests/llm/zhipu.test.ts tests/agents/player-agent.test.ts tests/game/bootstrap.test.ts tests/api/routes.test.ts
git commit -m "feat(llm): complete() 返回 token 与缓存用量"
```

---

### Task 2: OpenAI 兼容核心与 DeepSeek 客户端

智谱和 DeepSeek 都是 OpenAI 兼容的 chat completions，差别只有 baseUrl、错误文案里的供应商名和缓存字段形态（缓存差异已经在 `parseUsage` 里吃掉了）。把重试 / 超时 / 解析逻辑抽成一个核心，两个客户端各自只剩常量。

**Files:**
- Create: `lib/llm/openai-compatible.ts`
- Create: `lib/llm/deepseek.ts`
- Modify: `lib/llm/zhipu.ts`（整文件重写为薄封装）
- Create: `tests/llm/deepseek.test.ts`
- Test（回归，不改）: `tests/llm/zhipu.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `LlmClient` / `LlmCompletion` / `LlmProvider` / `parseUsage`；现有 `LlmError`。
- Produces:
  - `interface OpenAiCompatibleOptions { provider: LlmProvider; label: string; baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number; timeoutMs?: number }`
  - `createOpenAiCompatibleClient(options: OpenAiCompatibleOptions): LlmClient`
  - `isRetryable(error: unknown): boolean`
  - 常量 `RETRY_BASE_DELAY_MS = 500` / `DEFAULT_MAX_RETRIES = 2` / `DEFAULT_TIMEOUT_MS = 20_000` / `DEFAULT_TEMPERATURE = 0.4` / `DEFAULT_MAX_TOKENS = 400`
  - `DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'`、`DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat'`、`DEEPSEEK_LABEL = 'DeepSeek'`
  - `interface DeepseekClientOptions { apiKey: string; model: string; baseUrl?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number; timeoutMs?: number }`
  - `createDeepseekClient(options: DeepseekClientOptions): LlmClient`
  - `ZHIPU_DEFAULT_BASE_URL` / `ZHIPU_DEFAULT_MODEL` / `ZHIPU_LABEL` / `ZhipuClientOptions` / `createZhipuClient`（签名不变）

- [ ] **Step 1: 写 DeepSeek 客户端的失败测试**

创建 `tests/llm/deepseek.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';

import { DEEPSEEK_DEFAULT_BASE_URL, createDeepseekClient } from '@/lib/llm/deepseek';

function okResponse(content: string, usage?: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: '炸了' } }), { status });
}

function makeClient(fetchImpl: typeof fetch, sleep = vi.fn(async () => {})) {
  const client = createDeepseekClient({
    apiKey: 'ds-key',
    model: 'deepseek-chat',
    fetchImpl,
    sleep,
  });
  return { client, sleep };
}

describe('createDeepseekClient', () => {
  it('暴露 provider 与 model', () => {
    const { client } = makeClient(vi.fn() as unknown as typeof fetch);
    expect(client.provider).toBe('deepseek');
    expect(client.model).toBe('deepseek-chat');
  });

  it('打到 DeepSeek 的 chat/completions 并带上 Bearer Key', async () => {
    const fetchImpl = vi.fn(async () => okResponse('一种早餐饮品'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: '描述一下' }], {
      temperature: 0.2,
    });

    expect(completion.text).toBe('一种早餐饮品');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${DEEPSEEK_DEFAULT_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ds-key');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'deepseek-chat',
      temperature: 0.2,
      stream: false,
      messages: [{ role: 'user', content: '描述一下' }],
    });
  });

  it('映射 DeepSeek 官方的缓存命中 / 未命中字段', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse('一种早餐饮品', {
        prompt_tokens: 1000,
        completion_tokens: 50,
        total_tokens: 1050,
        prompt_cache_hit_tokens: 896,
        prompt_cache_miss_tokens: 104,
      }),
    );
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const completion = await client.complete([{ role: 'user', content: 'hi' }]);

    expect(completion.usage).toEqual({
      promptTokens: 1000,
      completionTokens: 50,
      totalTokens: 1050,
      cacheHitTokens: 896,
      cacheMissTokens: 104,
      usageReported: true,
      cacheReported: true,
    });
  });

  it('错误文案用 DeepSeek 作为供应商名，且不含 Key', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'DeepSeek接口返回 500',
    );
    await expect(
      client.complete([{ role: 'user', content: 'hi' }]).catch((error: Error) => error.message),
    ).resolves.not.toContain('ds-key');
  });

  it('429 后按 500ms / 1000ms 退避重试', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse('成功'));
    const { client, sleep } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      text: '成功',
    });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('4xx（非 429）立即失败', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(401));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'DeepSeek接口返回 401',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('内容为空时按错误处理', async () => {
    const fetchImpl = vi.fn(async () => okResponse(''));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'DeepSeek接口返回了空内容',
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/llm/deepseek.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/llm/deepseek"`。

- [ ] **Step 3: 实现 `lib/llm/openai-compatible.ts`**

```ts
import { parseUsage } from '@/lib/llm/usage';
import {
  LlmError,
  type LlmClient,
  type LlmCompleteOptions,
  type LlmCompletion,
  type LlmMessage,
  type LlmProvider,
} from '@/lib/llm/types';

export const RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_TEMPERATURE = 0.4;
export const DEFAULT_MAX_TOKENS = 400;

export interface OpenAiCompatibleOptions {
  provider: LlmProvider;
  /** 出现在错误文案里的供应商名，例如「智谱」「DeepSeek」。 */
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

/** 429 / 5xx / 网络错误 / 超时都值得重试；其余 4xx 是我们自己的请求有问题，重试没意义。 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof LlmError && error.status !== undefined) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

export function createOpenAiCompatibleClient(options: OpenAiCompatibleOptions): LlmClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function attempt(
    messages: LlmMessage[],
    completeOptions?: LlmCompleteOptions,
  ): Promise<LlmCompletion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          temperature: completeOptions?.temperature ?? DEFAULT_TEMPERATURE,
          max_tokens: completeOptions?.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // 只截错误正文前 200 字符，且绝不把 apiKey 拼进文案。
        const body = await response.text();
        throw new LlmError(
          `${options.label}接口返回 ${response.status}：${body.slice(0, 200)}`,
          response.status,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: unknown;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new LlmError(`${options.label}接口返回了空内容`);
      }
      return { text: content, usage: parseUsage(payload.usage) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    provider: options.provider,
    model: options.model,
    async complete(messages, completeOptions) {
      let lastError: unknown = new LlmError(`${options.label}请求未执行`);
      for (let retry = 0; retry <= maxRetries; retry += 1) {
        try {
          return await attempt(messages, completeOptions);
        } catch (error) {
          lastError = error;
          if (!isRetryable(error) || retry === maxRetries) {
            break;
          }
          await sleep(RETRY_BASE_DELAY_MS * 2 ** retry);
        }
      }
      throw lastError instanceof Error ? lastError : new LlmError(String(lastError));
    },
  };
}
```

- [ ] **Step 4: 实现 `lib/llm/deepseek.ts`**

```ts
import { createOpenAiCompatibleClient } from '@/lib/llm/openai-compatible';
import type { LlmClient } from '@/lib/llm/types';

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';
export const DEEPSEEK_LABEL = 'DeepSeek';

export interface DeepseekClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createDeepseekClient(options: DeepseekClientOptions): LlmClient {
  return createOpenAiCompatibleClient({
    provider: 'deepseek',
    label: DEEPSEEK_LABEL,
    baseUrl: options.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  });
}
```

- [ ] **Step 5: 跑 DeepSeek 测试确认通过**

Run: `npx vitest run tests/llm/deepseek.test.ts`
Expected: PASS，7 个用例全绿。

- [ ] **Step 6: 把智谱客户端改成同一个核心的薄封装**

把 `lib/llm/zhipu.ts` 整文件替换为：

```ts
import { createOpenAiCompatibleClient } from '@/lib/llm/openai-compatible';
import type { LlmClient } from '@/lib/llm/types';

export const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const ZHIPU_DEFAULT_MODEL = 'glm-4-flash';
export const ZHIPU_LABEL = '智谱';

export class MissingApiKeyError extends Error {
  constructor() {
    super('缺少 ZHIPU_API_KEY：请在 .env.local 里配置智谱 API Key 后重启服务');
    this.name = 'MissingApiKeyError';
  }
}

export interface ZhipuConfig {
  apiKey: string;
  model: string;
}

/** @deprecated Key 已改由 POST /api/games 请求体传入，Task 9 会删掉这个函数。 */
export function readZhipuConfigFromEnv(env: Record<string, string | undefined>): ZhipuConfig {
  const apiKey = (env.ZHIPU_API_KEY ?? '').trim();
  if (apiKey === '') {
    throw new MissingApiKeyError();
  }
  const model = (env.ZHIPU_MODEL ?? '').trim();
  return { apiKey, model: model === '' ? ZHIPU_DEFAULT_MODEL : model };
}

export interface ZhipuClientOptions extends ZhipuConfig {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createZhipuClient(options: ZhipuClientOptions): LlmClient {
  return createOpenAiCompatibleClient({
    provider: 'zhipu',
    label: ZHIPU_LABEL,
    baseUrl: options.baseUrl ?? ZHIPU_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  });
}
```

- [ ] **Step 7: 跑智谱测试确认重构没有改变行为**

Run: `npx vitest run tests/llm/zhipu.test.ts`
Expected: PASS，9 个用例全绿且**一行都不用改**——核心里的文案模板是 `` `${options.label}接口返回 ...` ``，`ZHIPU_LABEL = '智谱'` 拼出来正是旧文案「智谱接口返回 500」。如果这里红了，说明模板里多打了空格。

- [ ] **Step 8: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。`tests/llm/zhipu.test.ts` 与 `tests/llm/deepseek.test.ts` 都绿，说明两个客户端跑在同一个核心上。

- [ ] **Step 9: 提交**

```bash
git add lib/llm/openai-compatible.ts lib/llm/deepseek.ts lib/llm/zhipu.ts tests/llm/deepseek.test.ts tests/llm/zhipu.test.ts
git commit -m "feat(llm): 抽出 OpenAI 兼容核心并接入 DeepSeek"
```

---

### Task 3: 供应商常量、客户端工厂与请求体校验

把「provider / model / apiKey」这三件事的常量、校验和分发集中到两个文件：`providers.ts` 只有常量（前端也能安全引用），`create-client.ts` 负责把请求体变成合法配置再变成客户端。

**Files:**
- Create: `lib/llm/providers.ts`
- Create: `lib/llm/create-client.ts`
- Create: `tests/llm/create-client.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `LlmProvider` / `LlmClient`；Task 2 的 `createZhipuClient` / `ZHIPU_DEFAULT_MODEL` / `createDeepseekClient` / `DEEPSEEK_DEFAULT_MODEL`。
- Produces:
  - `PROVIDERS: readonly LlmProvider[]`（顺序固定为 `['zhipu', 'deepseek']`）
  - `PROVIDER_LABELS: Record<LlmProvider, string>`（`{ zhipu: '智谱', deepseek: 'DeepSeek' }`）
  - `DEFAULT_MODELS: Record<LlmProvider, string>`（`{ zhipu: 'glm-4-flash', deepseek: 'deepseek-chat' }`）
  - `isLlmProvider(value: unknown): value is LlmProvider`
  - `interface LlmConfig { provider: LlmProvider; model: string; apiKey: string }`
  - `class InvalidLlmConfigError extends Error`
  - `parseLlmConfig(body: unknown): LlmConfig`
  - `interface CreateClientOptions { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number; timeoutMs?: number }`
  - `createLlmClient(config: LlmConfig, options?: CreateClientOptions): LlmClient`
  - 常量 `MAX_API_KEY_LENGTH = 200` / `MAX_MODEL_LENGTH = 64`

- [ ] **Step 1: 写校验与分发的失败测试**

创建 `tests/llm/create-client.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  InvalidLlmConfigError,
  MAX_API_KEY_LENGTH,
  MAX_MODEL_LENGTH,
  createLlmClient,
  parseLlmConfig,
} from '@/lib/llm/create-client';
import { DEFAULT_MODELS, PROVIDERS, PROVIDER_LABELS, isLlmProvider } from '@/lib/llm/providers';

describe('providers 常量', () => {
  it('供应商顺序固定，标签与默认模型齐全', () => {
    expect(PROVIDERS).toEqual(['zhipu', 'deepseek']);
    expect(PROVIDER_LABELS).toEqual({ zhipu: '智谱', deepseek: 'DeepSeek' });
    expect(DEFAULT_MODELS).toEqual({ zhipu: 'glm-4-flash', deepseek: 'deepseek-chat' });
  });

  it('isLlmProvider 只认这两个字符串', () => {
    expect(isLlmProvider('zhipu')).toBe(true);
    expect(isLlmProvider('deepseek')).toBe(true);
    expect(isLlmProvider('openai')).toBe(false);
    expect(isLlmProvider(undefined)).toBe(false);
  });
});

describe('parseLlmConfig', () => {
  it('三项齐全时原样返回并 trim', () => {
    expect(
      parseLlmConfig({ provider: 'deepseek', model: ' deepseek-reasoner ', apiKey: ' sk-1 ' }),
    ).toEqual({ provider: 'deepseek', model: 'deepseek-reasoner', apiKey: 'sk-1' });
  });

  it('model 缺失或全空白时回落到该供应商默认模型', () => {
    expect(parseLlmConfig({ provider: 'zhipu', apiKey: 'k' }).model).toBe('glm-4-flash');
    expect(parseLlmConfig({ provider: 'deepseek', model: '   ', apiKey: 'k' }).model).toBe(
      'deepseek-chat',
    );
  });

  it('请求体不是对象时抛 InvalidLlmConfigError', () => {
    expect(() => parseLlmConfig(null)).toThrow(InvalidLlmConfigError);
    expect(() => parseLlmConfig('zhipu')).toThrow('请求体必须是 JSON 对象');
  });

  it('未知 provider 抛错并给出可选值', () => {
    expect(() => parseLlmConfig({ provider: 'openai', apiKey: 'k' })).toThrow(
      'provider 只能是 zhipu 或 deepseek',
    );
    expect(() => parseLlmConfig({ apiKey: 'k' })).toThrow(InvalidLlmConfigError);
  });

  it('缺 Key 或 Key 全空白时抛错', () => {
    expect(() => parseLlmConfig({ provider: 'zhipu', model: 'glm-4-flash' })).toThrow(
      '缺少 apiKey',
    );
    expect(() => parseLlmConfig({ provider: 'zhipu', apiKey: '   ' })).toThrow('缺少 apiKey');
    expect(() => parseLlmConfig({ provider: 'zhipu', apiKey: 123 })).toThrow('缺少 apiKey');
  });

  it('model 不是字符串时抛错', () => {
    expect(() => parseLlmConfig({ provider: 'zhipu', model: 42, apiKey: 'k' })).toThrow(
      'model 必须是字符串',
    );
  });

  it('超长的 model 与 apiKey 被拒绝', () => {
    expect(() =>
      parseLlmConfig({ provider: 'zhipu', model: 'm'.repeat(MAX_MODEL_LENGTH + 1), apiKey: 'k' }),
    ).toThrow(`model 长度不能超过 ${MAX_MODEL_LENGTH}`);
    expect(() =>
      parseLlmConfig({ provider: 'zhipu', apiKey: 'k'.repeat(MAX_API_KEY_LENGTH + 1) }),
    ).toThrow(`apiKey 长度不能超过 ${MAX_API_KEY_LENGTH}`);
  });

  it('错误文案里绝不回显 Key', () => {
    try {
      parseLlmConfig({ provider: 'openai', apiKey: 'sk-secret-value' });
      throw new Error('should not reach');
    } catch (error) {
      expect((error as Error).message).not.toContain('sk-secret-value');
    }
  });

  it('忽略请求体里多出来的字段', () => {
    expect(
      parseLlmConfig({ provider: 'zhipu', apiKey: 'k', baseUrl: 'http://evil.example' }),
    ).toEqual({ provider: 'zhipu', model: 'glm-4-flash', apiKey: 'k' });
  });
});

describe('createLlmClient', () => {
  it('按 provider 分发，并把 model 透传给客户端', () => {
    const zhipu = createLlmClient({ provider: 'zhipu', model: 'glm-4-plus', apiKey: 'k' });
    const deepseek = createLlmClient({
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      apiKey: 'k',
    });

    expect(zhipu.provider).toBe('zhipu');
    expect(zhipu.model).toBe('glm-4-plus');
    expect(deepseek.provider).toBe('deepseek');
    expect(deepseek.model).toBe('deepseek-reasoner');
  });

  it('注入的 fetchImpl 会被真正用上（测试里绝不发真实请求）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '嗨' } }] }), {
          status: 200,
        }),
    );
    const client = createLlmClient(
      { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'k' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      text: '嗨',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/llm/create-client.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/llm/create-client"`。

- [ ] **Step 3: 实现 `lib/llm/providers.ts`**

```ts
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
```

- [ ] **Step 4: 实现 `lib/llm/create-client.ts`**

```ts
import { createDeepseekClient } from '@/lib/llm/deepseek';
import { DEFAULT_MODELS, PROVIDERS, isLlmProvider } from '@/lib/llm/providers';
import type { LlmClient, LlmProvider } from '@/lib/llm/types';
import { createZhipuClient } from '@/lib/llm/zhipu';

export const MAX_API_KEY_LENGTH = 200;
export const MAX_MODEL_LENGTH = 64;

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
}

export class InvalidLlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLlmConfigError';
  }
}

/**
 * 只认 provider / model / apiKey 三个字段，多出来的一律忽略。
 * 任何错误文案都不得回显 apiKey——错误会原样返回给浏览器。
 */
export function parseLlmConfig(body: unknown): LlmConfig {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidLlmConfigError('请求体必须是 JSON 对象，需包含 provider / model / apiKey');
  }

  const raw = body as Record<string, unknown>;
  if (!isLlmProvider(raw.provider)) {
    throw new InvalidLlmConfigError(`provider 只能是 ${PROVIDERS.join(' 或 ')}`);
  }
  const provider = raw.provider;

  const rawModel = raw.model;
  if (rawModel !== undefined && typeof rawModel !== 'string') {
    throw new InvalidLlmConfigError('model 必须是字符串');
  }
  const trimmedModel = (rawModel ?? '').trim();
  const model = trimmedModel === '' ? DEFAULT_MODELS[provider] : trimmedModel;
  if (model.length > MAX_MODEL_LENGTH) {
    throw new InvalidLlmConfigError(`model 长度不能超过 ${MAX_MODEL_LENGTH} 个字符`);
  }

  const rawApiKey = raw.apiKey;
  if (typeof rawApiKey !== 'string' || rawApiKey.trim() === '') {
    throw new InvalidLlmConfigError('缺少 apiKey：请在页面「模型设置」里填入该供应商的 API Key');
  }
  const apiKey = rawApiKey.trim();
  if (apiKey.length > MAX_API_KEY_LENGTH) {
    throw new InvalidLlmConfigError(`apiKey 长度不能超过 ${MAX_API_KEY_LENGTH} 个字符`);
  }

  return { provider, model, apiKey };
}

export interface CreateClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createLlmClient(config: LlmConfig, options: CreateClientOptions = {}): LlmClient {
  const shared = {
    apiKey: config.apiKey,
    model: config.model,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  };
  return config.provider === 'deepseek' ? createDeepseekClient(shared) : createZhipuClient(shared);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/llm/create-client.test.ts`
Expected: PASS，12 个用例全绿。

- [ ] **Step 6: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add lib/llm/providers.ts lib/llm/create-client.ts tests/llm/create-client.test.ts
git commit -m "feat(llm): 供应商常量、请求体校验与客户端工厂"
```

---

### Task 4: UsageLedger（每局的内存流水账）

一局一个 `UsageLedger`，只做一件事：按时间顺序追加每次调用的用量记录，并给出只读快照。它不知道价格，也不知道 SSE。

**Files:**
- Create: `lib/billing/ledger.ts`
- Create: `tests/billing/ledger.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `LlmProvider` / `LlmUsage`。
- Produces:
  - `type UsagePhase = 'speak' | 'vote'`
  - `interface UsageRecordInput { seatId: number; phase: UsagePhase; provider: LlmProvider; model: string; usage: LlmUsage }`
  - `interface UsageRecord { at: number; seatId: number; phase: UsagePhase; provider: LlmProvider; model: string; promptTokens: number; completionTokens: number; totalTokens: number; cacheHitTokens: number; cacheMissTokens: number; usageReported: boolean; cacheReported: boolean }`
  - `type UsageSink = (input: UsageRecordInput) => void`
  - `class UsageLedger { constructor(now?: () => number); append(input: UsageRecordInput): UsageRecord; records(): UsageRecord[]; get size(): number; sink(): UsageSink }`

- [ ] **Step 1: 写 ledger 的失败测试**

创建 `tests/billing/ledger.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { UsageLedger, type UsageRecordInput } from '@/lib/billing/ledger';
import type { LlmUsage } from '@/lib/llm/types';

const USAGE: LlmUsage = {
  promptTokens: 100,
  completionTokens: 20,
  totalTokens: 120,
  cacheHitTokens: 64,
  cacheMissTokens: 36,
  usageReported: true,
  cacheReported: true,
};

function input(seatId: number, phase: UsageRecordInput['phase'] = 'speak'): UsageRecordInput {
  return { seatId, phase, provider: 'deepseek', model: 'deepseek-chat', usage: USAGE };
}

describe('UsageLedger', () => {
  it('append 把 usage 摊平成一条带时间戳的记录', () => {
    let clock = 1_700_000_000_000;
    const ledger = new UsageLedger(() => clock);

    const record = ledger.append(input(2, 'vote'));

    expect(record).toEqual({
      at: 1_700_000_000_000,
      seatId: 2,
      phase: 'vote',
      provider: 'deepseek',
      model: 'deepseek-chat',
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheHitTokens: 64,
      cacheMissTokens: 36,
      usageReported: true,
      cacheReported: true,
    });
    clock += 1;
    expect(ledger.append(input(2)).at).toBe(1_700_000_000_001);
  });

  it('按追加顺序保存，size 同步增长', () => {
    const ledger = new UsageLedger(() => 0);
    ledger.append(input(0));
    ledger.append(input(3, 'vote'));
    ledger.append(input(1));

    expect(ledger.size).toBe(3);
    expect(ledger.records().map((record) => record.seatId)).toEqual([0, 3, 1]);
    expect(ledger.records().map((record) => record.phase)).toEqual(['speak', 'vote', 'speak']);
  });

  it('records() 返回快照，外部改它不影响账本', () => {
    const ledger = new UsageLedger(() => 0);
    ledger.append(input(0));

    const snapshot = ledger.records();
    snapshot.pop();

    expect(ledger.size).toBe(1);
    expect(ledger.records()).toHaveLength(1);
  });

  it('空账本的快照是空数组', () => {
    expect(new UsageLedger(() => 0).records()).toEqual([]);
  });

  it('sink() 给出可直接交给 agent 的回调', () => {
    const ledger = new UsageLedger(() => 7);
    const sink = ledger.sink();

    sink(input(1));

    expect(ledger.records()).toEqual([
      expect.objectContaining({ at: 7, seatId: 1, provider: 'deepseek' }),
    ]);
  });

  it('未上报 usage 的调用也照样记一条，只是 token 全 0', () => {
    const ledger = new UsageLedger(() => 0);
    ledger.append({
      seatId: 0,
      phase: 'speak',
      provider: 'zhipu',
      model: 'glm-4-flash',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        usageReported: false,
        cacheReported: false,
      },
    });

    expect(ledger.records()[0]).toMatchObject({ usageReported: false, cacheReported: false });
    expect(ledger.size).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/billing/ledger.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/billing/ledger"`。

- [ ] **Step 3: 实现 `lib/billing/ledger.ts`**

```ts
import type { LlmProvider, LlmUsage } from '@/lib/llm/types';

export type UsagePhase = 'speak' | 'vote';

export interface UsageRecordInput {
  seatId: number;
  phase: UsagePhase;
  provider: LlmProvider;
  model: string;
  usage: LlmUsage;
}

/** 把 LlmUsage 摊平进记录，UI 与 JSON 都少一层嵌套。 */
export interface UsageRecord {
  at: number;
  seatId: number;
  phase: UsagePhase;
  provider: LlmProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  usageReported: boolean;
  cacheReported: boolean;
}

export type UsageSink = (input: UsageRecordInput) => void;

/** 一局一个，纯内存，跟着 session 一起被 GC；绝不写盘。 */
export class UsageLedger {
  private readonly entries: UsageRecord[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  append(input: UsageRecordInput): UsageRecord {
    const record: UsageRecord = {
      at: this.now(),
      seatId: input.seatId,
      phase: input.phase,
      provider: input.provider,
      model: input.model,
      ...input.usage,
    };
    this.entries.push(record);
    return record;
  }

  records(): UsageRecord[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }

  /** agent 只需要一个回调，不需要认识整个账本。 */
  sink(): UsageSink {
    return (input) => {
      this.append(input);
    };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/billing/ledger.test.ts`
Expected: PASS，6 个用例全绿。

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add lib/billing/ledger.ts tests/billing/ledger.test.ts
git commit -m "feat(billing): 每局内存用量流水账"
```

---

### Task 5: 内置价目表

唯一的一张价目表，单位是 **CNY / 1K tokens**。未知模型回落到该供应商的 `fallback` 档，并让上层能问出「这是不是回落档」以便在账单里注明。

**Files:**
- Create: `lib/billing/prices.ts`
- Create: `tests/billing/prices.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `LlmProvider`；Task 3 的 `PROVIDER_LABELS`（仅在 Task 6 的文案里用，这里只确保不重复定义供应商名）。
- Produces:
  - `interface ModelPrice { promptPerKTokens: number; completionPerKTokens: number }`
  - `interface ProviderPrices { fallback: ModelPrice; models: Record<string, ModelPrice> }`
  - `PRICE_TABLE: Record<LlmProvider, ProviderPrices>`
  - `normalizeModel(model: string): string`
  - `isKnownModel(provider: LlmProvider, model: string): boolean`
  - `priceFor(provider: LlmProvider, model: string): ModelPrice`

- [ ] **Step 1: 写价目表的失败测试**

创建 `tests/billing/prices.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { PRICE_TABLE, isKnownModel, normalizeModel, priceFor } from '@/lib/billing/prices';

describe('PRICE_TABLE', () => {
  it('两个供应商都有 fallback 档，且单价非负', () => {
    for (const provider of ['zhipu', 'deepseek'] as const) {
      const prices = PRICE_TABLE[provider];
      expect(prices.fallback.promptPerKTokens).toBeGreaterThanOrEqual(0);
      expect(prices.fallback.completionPerKTokens).toBeGreaterThanOrEqual(0);
      for (const price of Object.values(prices.models)) {
        expect(price.promptPerKTokens).toBeGreaterThanOrEqual(0);
        expect(price.completionPerKTokens).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('覆盖 DeepSeek 的 chat 与 reasoner', () => {
    expect(Object.keys(PRICE_TABLE.deepseek.models)).toEqual(
      expect.arrayContaining(['deepseek-chat', 'deepseek-reasoner']),
    );
  });

  it('覆盖智谱默认模型 glm-4-flash', () => {
    expect(PRICE_TABLE.zhipu.models['glm-4-flash']).toBeDefined();
  });
});

describe('normalizeModel', () => {
  it('去空白并转小写', () => {
    expect(normalizeModel('  DeepSeek-Chat ')).toBe('deepseek-chat');
  });
});

describe('priceFor', () => {
  it('命中内置模型时返回该模型单价', () => {
    expect(priceFor('deepseek', 'deepseek-reasoner')).toEqual(
      PRICE_TABLE.deepseek.models['deepseek-reasoner'],
    );
  });

  it('大小写与空格不影响命中', () => {
    expect(priceFor('deepseek', ' DEEPSEEK-CHAT ')).toEqual(
      PRICE_TABLE.deepseek.models['deepseek-chat'],
    );
  });

  it('未知模型回落到该供应商默认档', () => {
    expect(priceFor('deepseek', 'deepseek-v9')).toEqual(PRICE_TABLE.deepseek.fallback);
    expect(priceFor('zhipu', 'glm-未来版')).toEqual(PRICE_TABLE.zhipu.fallback);
  });
});

describe('isKnownModel', () => {
  it('内置模型为 true，未知模型为 false', () => {
    expect(isKnownModel('zhipu', 'glm-4-flash')).toBe(true);
    expect(isKnownModel('zhipu', 'GLM-4-Flash')).toBe(true);
    expect(isKnownModel('zhipu', 'glm-未来版')).toBe(false);
    expect(isKnownModel('deepseek', '')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/billing/prices.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/billing/prices"`。

- [ ] **Step 3: 实现 `lib/billing/prices.ts`**

```ts
import type { LlmProvider } from '@/lib/llm/types';

export interface ModelPrice {
  promptPerKTokens: number;
  completionPerKTokens: number;
}

export interface ProviderPrices {
  /** 未知模型走这一档。 */
  fallback: ModelPrice;
  models: Record<string, ModelPrice>;
}

/**
 * 单位：CNY / 1K tokens。这是全站唯一的价目表，改价只动这里。
 * 数值按 2026-09 的公开价维护，账单一律标「估算」，以官方账单为准。
 */
export const PRICE_TABLE: Record<LlmProvider, ProviderPrices> = {
  zhipu: {
    fallback: { promptPerKTokens: 0.001, completionPerKTokens: 0.001 },
    models: {
      'glm-4-flash': { promptPerKTokens: 0, completionPerKTokens: 0 },
      'glm-4-air': { promptPerKTokens: 0.0005, completionPerKTokens: 0.0005 },
      'glm-4-airx': { promptPerKTokens: 0.01, completionPerKTokens: 0.01 },
      'glm-4-long': { promptPerKTokens: 0.001, completionPerKTokens: 0.001 },
      'glm-4-plus': { promptPerKTokens: 0.05, completionPerKTokens: 0.05 },
    },
  },
  deepseek: {
    fallback: { promptPerKTokens: 0.002, completionPerKTokens: 0.008 },
    models: {
      'deepseek-chat': { promptPerKTokens: 0.002, completionPerKTokens: 0.008 },
      'deepseek-reasoner': { promptPerKTokens: 0.004, completionPerKTokens: 0.016 },
    },
  },
};

export function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

export function isKnownModel(provider: LlmProvider, model: string): boolean {
  return normalizeModel(model) in PRICE_TABLE[provider].models;
}

export function priceFor(provider: LlmProvider, model: string): ModelPrice {
  const prices = PRICE_TABLE[provider];
  return prices.models[normalizeModel(model)] ?? prices.fallback;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/billing/prices.test.ts`
Expected: PASS，8 个用例全绿。

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add lib/billing/prices.ts tests/billing/prices.test.ts
git commit -m "feat(billing): 内置 CNY/1K tokens 价目表"
```

---

### Task 6: 估算账单 buildBill

把流水账算成一份 `Bill`：全部调用明细（按时间）、按座位汇总、全局合计与估算费用、以及固定的「估算」提示与各种缺字段说明。

**Files:**
- Create: `lib/billing/estimate.ts`
- Create: `tests/billing/estimate.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `UsageRecord`；Task 5 的 `priceFor` / `isKnownModel`；Task 3 的 `PROVIDER_LABELS`；Task 1 的 `LlmProvider`。
- Produces:
  - `BILL_ESTIMATE_NOTE: string`（常量，值为 `'本账单为本地估算，实际费用以供应商官方账单为准。'`）
  - `interface SeatBill { seatId: number; calls: number; promptTokens: number; completionTokens: number; totalTokens: number; cacheHitTokens: number; cacheMissTokens: number; estimatedCostCny: number }`
  - `interface BillTotals { calls: number; promptTokens: number; completionTokens: number; totalTokens: number; cacheHitTokens: number; cacheMissTokens: number; cacheReportedCalls: number; usageMissingCalls: number; estimatedCostCny: number }`
  - `interface Bill { gameId: string; provider: LlmProvider; model: string; finishedAt: number; estimated: true; calls: UsageRecord[]; bySeat: SeatBill[]; totals: BillTotals; notes: string[] }`
  - `roundCny(value: number): number`
  - `estimateCallCostCny(record: UsageRecord): number`
  - `interface BuildBillInput { gameId: string; provider: LlmProvider; model: string; finishedAt: number; records: UsageRecord[] }`
  - `buildBill(input: BuildBillInput): Bill`

- [ ] **Step 1: 写账单估算的失败测试**

创建 `tests/billing/estimate.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import type { UsageRecord } from '@/lib/billing/ledger';
import {
  BILL_ESTIMATE_NOTE,
  buildBill,
  estimateCallCostCny,
  roundCny,
} from '@/lib/billing/estimate';

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
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
    ...overrides,
  };
}

describe('roundCny', () => {
  it('保留 4 位小数', () => {
    expect(roundCny(0.00123456)).toBe(0.0012);
    expect(roundCny(1.23455)).toBe(1.2346);
    expect(roundCny(0)).toBe(0);
  });
});

describe('estimateCallCostCny', () => {
  it('按 prompt / completion 各自的每 1K 单价计价', () => {
    // deepseek-chat：prompt 0.002、completion 0.008 → 1*0.002 + 0.5*0.008 = 0.006
    expect(estimateCallCostCny(record())).toBeCloseTo(0.006, 10);
  });

  it('未知模型走供应商默认档', () => {
    expect(estimateCallCostCny(record({ model: 'deepseek-v9' }))).toBeCloseTo(0.006, 10);
  });

  it('零 token 的调用费用为 0', () => {
    expect(
      estimateCallCostCny(
        record({ promptTokens: 0, completionTokens: 0, totalTokens: 0, usageReported: false }),
      ),
    ).toBe(0);
  });
});

describe('buildBill', () => {
  it('明细按时间排序，且带上局号与供应商', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 9_999,
      records: [record({ at: 300, seatId: 1 }), record({ at: 100, seatId: 0 })],
    });

    expect(bill.gameId).toBe('g-1');
    expect(bill.provider).toBe('deepseek');
    expect(bill.model).toBe('deepseek-chat');
    expect(bill.finishedAt).toBe(9_999);
    expect(bill.estimated).toBe(true);
    expect(bill.calls.map((call) => call.at)).toEqual([100, 300]);
  });

  it('totals 汇总 token、缓存与估算费用', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [record({ seatId: 0 }), record({ seatId: 1 })],
    });

    expect(bill.totals).toEqual({
      calls: 2,
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
      cacheHitTokens: 1600,
      cacheMissTokens: 400,
      cacheReportedCalls: 2,
      usageMissingCalls: 0,
      estimatedCostCny: 0.012,
    });
  });

  it('bySeat 按座位号升序，每座位有自己的调用数与费用', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [
        record({ seatId: 2, phase: 'vote' }),
        record({ seatId: 0 }),
        record({ seatId: 2 }),
      ],
    });

    expect(bill.bySeat.map((seat) => seat.seatId)).toEqual([0, 2]);
    expect(bill.bySeat[1]).toEqual({
      seatId: 2,
      calls: 2,
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
      cacheHitTokens: 1600,
      cacheMissTokens: 400,
      estimatedCostCny: 0.012,
    });
  });

  it('notes 第一条恒为估算提示', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [record()],
    });

    expect(bill.notes[0]).toBe(BILL_ESTIMATE_NOTE);
    expect(BILL_ESTIMATE_NOTE).toBe('本账单为本地估算，实际费用以供应商官方账单为准。');
  });

  it('未知模型时 notes 说明走了默认档', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-v9',
      finishedAt: 0,
      records: [record({ model: 'deepseek-v9' })],
    });

    expect(bill.notes).toContain('模型 deepseek-v9 不在内置价目表里，已按 DeepSeek 默认档单价估算。');
  });

  it('有调用没返回 usage 时 notes 注明次数', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'zhipu',
      model: 'glm-4-flash',
      finishedAt: 0,
      records: [
        record({ provider: 'zhipu', model: 'glm-4-flash' }),
        record({
          provider: 'zhipu',
          model: 'glm-4-flash',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          usageReported: false,
          cacheReported: false,
        }),
      ],
    });

    expect(bill.totals.usageMissingCalls).toBe(1);
    expect(bill.notes).toContain('有 1 次调用没有返回 usage，这些调用按 0 token 计入。');
  });

  it('全程没有缓存字段时 notes 说明缓存未提供', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'zhipu',
      model: 'glm-4-flash',
      finishedAt: 0,
      records: [
        record({
          provider: 'zhipu',
          model: 'glm-4-flash',
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          cacheReported: false,
        }),
      ],
    });

    expect(bill.totals.cacheReportedCalls).toBe(0);
    expect(bill.notes).toContain('本局供应商没有返回缓存字段，缓存命中一律显示「未提供」。');
  });

  it('有缓存命中时 notes 说明没有做缓存折扣', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [record()],
    });

    expect(bill.notes).toContain('缓存命中的 token 按 prompt 单价计入，没有做缓存折扣。');
  });

  it('一次调用都没有时也给出合法的空账单', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'zhipu',
      model: 'glm-4-flash',
      finishedAt: 5,
      records: [],
    });

    expect(bill.calls).toEqual([]);
    expect(bill.bySeat).toEqual([]);
    expect(bill.totals.calls).toBe(0);
    expect(bill.totals.estimatedCostCny).toBe(0);
    expect(bill.notes[0]).toBe(BILL_ESTIMATE_NOTE);
  });

  it('序列化后不含任何 Key 字段', () => {
    const bill = buildBill({
      gameId: 'g-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      finishedAt: 0,
      records: [record()],
    });

    expect(JSON.stringify(bill)).not.toContain('apiKey');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/billing/estimate.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/billing/estimate"`。

- [ ] **Step 3: 实现 `lib/billing/estimate.ts`**

```ts
import type { UsageRecord } from '@/lib/billing/ledger';
import { isKnownModel, priceFor } from '@/lib/billing/prices';
import { PROVIDER_LABELS } from '@/lib/llm/providers';
import type { LlmProvider } from '@/lib/llm/types';

export const BILL_ESTIMATE_NOTE = '本账单为本地估算，实际费用以供应商官方账单为准。';

export interface SeatBill {
  seatId: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  estimatedCostCny: number;
}

export interface BillTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  /** 供应商真的返回了缓存字段的调用次数；为 0 时界面一律显示「未提供」。 */
  cacheReportedCalls: number;
  /** 整段 usage 缺失的调用次数，这些调用按 0 token 计入。 */
  usageMissingCalls: number;
  estimatedCostCny: number;
}

export interface Bill {
  gameId: string;
  provider: LlmProvider;
  model: string;
  finishedAt: number;
  /** 永远是 true：本项目只出估算账单。 */
  estimated: true;
  calls: UsageRecord[];
  bySeat: SeatBill[];
  totals: BillTotals;
  notes: string[];
}

export function roundCny(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function estimateCallCostCny(record: UsageRecord): number {
  const price = priceFor(record.provider, record.model);
  return (
    (record.promptTokens / 1000) * price.promptPerKTokens +
    (record.completionTokens / 1000) * price.completionPerKTokens
  );
}

export interface BuildBillInput {
  gameId: string;
  provider: LlmProvider;
  model: string;
  finishedAt: number;
  records: UsageRecord[];
}

function emptySeatBill(seatId: number): SeatBill {
  return {
    seatId,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    estimatedCostCny: 0,
  };
}

function buildNotes(input: BuildBillInput, totals: BillTotals): string[] {
  const notes = [BILL_ESTIMATE_NOTE];
  if (!isKnownModel(input.provider, input.model)) {
    notes.push(
      `模型 ${input.model} 不在内置价目表里，已按 ${PROVIDER_LABELS[input.provider]} 默认档单价估算。`,
    );
  }
  if (totals.usageMissingCalls > 0) {
    notes.push(`有 ${totals.usageMissingCalls} 次调用没有返回 usage，这些调用按 0 token 计入。`);
  }
  if (totals.cacheReportedCalls === 0) {
    notes.push('本局供应商没有返回缓存字段，缓存命中一律显示「未提供」。');
  }
  if (totals.cacheHitTokens > 0) {
    notes.push('缓存命中的 token 按 prompt 单价计入，没有做缓存折扣。');
  }
  return notes;
}

export function buildBill(input: BuildBillInput): Bill {
  const calls = [...input.records].sort((a, b) => a.at - b.at);

  const totals: BillTotals = {
    calls: calls.length,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    cacheReportedCalls: 0,
    usageMissingCalls: 0,
    estimatedCostCny: 0,
  };

  // 费用先按未取整的浮点累加，最后统一取整，避免每条都取整带来的累计误差。
  const seatCosts = new Map<number, number>();
  const seatBills = new Map<number, SeatBill>();
  let rawTotalCost = 0;

  for (const call of calls) {
    const cost = estimateCallCostCny(call);
    rawTotalCost += cost;

    totals.promptTokens += call.promptTokens;
    totals.completionTokens += call.completionTokens;
    totals.totalTokens += call.totalTokens;
    totals.cacheHitTokens += call.cacheHitTokens;
    totals.cacheMissTokens += call.cacheMissTokens;
    if (call.cacheReported) {
      totals.cacheReportedCalls += 1;
    }
    if (!call.usageReported) {
      totals.usageMissingCalls += 1;
    }

    const seat = seatBills.get(call.seatId) ?? emptySeatBill(call.seatId);
    seat.calls += 1;
    seat.promptTokens += call.promptTokens;
    seat.completionTokens += call.completionTokens;
    seat.totalTokens += call.totalTokens;
    seat.cacheHitTokens += call.cacheHitTokens;
    seat.cacheMissTokens += call.cacheMissTokens;
    seatBills.set(call.seatId, seat);
    seatCosts.set(call.seatId, (seatCosts.get(call.seatId) ?? 0) + cost);
  }

  totals.estimatedCostCny = roundCny(rawTotalCost);

  const bySeat = [...seatBills.values()]
    .map((seat) => ({ ...seat, estimatedCostCny: roundCny(seatCosts.get(seat.seatId) ?? 0) }))
    .sort((a, b) => a.seatId - b.seatId);

  return {
    gameId: input.gameId,
    provider: input.provider,
    model: input.model,
    finishedAt: input.finishedAt,
    estimated: true,
    calls,
    bySeat,
    totals,
    notes: buildNotes(input, totals),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/billing/estimate.test.ts`
Expected: PASS，14 个用例全绿。

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add lib/billing/estimate.ts tests/billing/estimate.test.ts
git commit -m "feat(billing): 由流水账生成估算账单"
```

---

### Task 7: PlayerAgent 上报每次调用的用量

四个 agent 共用同一个 `LlmClient`，但账单要按座位分组，所以座位号由 `PlayerAgentDeps` 传入；`provider` / `model` 直接从客户端上读，保证「一局一个供应商」这件事不会被参数写歪。只要拿到了响应就记一笔——哪怕内容不合格要重试，token 也已经花掉了。

**Files:**
- Modify: `lib/agents/player-agent.ts`
- Modify: `tests/agents/player-agent.test.ts`
- Modify: `lib/game/bootstrap.ts:39-41`（临时补 `seatId`，完整接线在 Task 9）

**Interfaces:**
- Consumes: Task 1 的 `LlmClient`（`provider` / `model` / `complete`）；Task 4 的 `UsagePhase` / `UsageSink`。
- Produces:
  - `interface PlayerAgentDeps { llm: LlmClient; seatId: number; onUsage?: UsageSink; temperature?: number }`
  - `PlayerAgent` 的公开行为不变（`speak` / `vote` 的返回类型仍是 `SpeechResult` / `VoteResult`）。

- [ ] **Step 1: 写用量上报的失败测试**

在 `tests/agents/player-agent.test.ts` 末尾追加（顶部再补一个 import）：

```ts
import type { UsageRecordInput } from '@/lib/billing/ledger';
```

```ts
describe('PlayerAgent 用量上报', () => {
  it('发言成功时上报一条 speak 用量，带座位、供应商、模型与缓存字段', async () => {
    const llm = scriptedLlm(['{"speech":"早上常喝的白色饮品"}']);
    const reported: UsageRecordInput[] = [];
    const agent = new PlayerAgent(PERSONAS[2], {
      llm,
      seatId: 2,
      onUsage: (input) => reported.push(input),
    });

    await agent.speak(VIEW);

    expect(reported).toEqual([
      {
        seatId: 2,
        phase: 'speak',
        provider: 'zhipu',
        model: 'glm-4-flash',
        usage: SAMPLE_USAGE,
      },
    ]);
  });

  it('重试导致的多次调用会各记一笔', async () => {
    const llm = scriptedLlm(['{"speech":"我的词就是豆浆"}', '{"speech":"早上常喝的白色饮品"}']);
    const reported: UsageRecordInput[] = [];
    const agent = new PlayerAgent(PERSONAS[2], {
      llm,
      seatId: 2,
      onUsage: (input) => reported.push(input),
    });

    await agent.speak(VIEW);

    expect(reported).toHaveLength(2);
    expect(reported.every((input) => input.phase === 'speak')).toBe(true);
  });

  it('投票阶段上报 phase 为 vote', async () => {
    const llm = scriptedLlm(['{"vote":0,"reason":"他说得太稳了"}']);
    const reported: UsageRecordInput[] = [];
    const agent = new PlayerAgent(PERSONAS[2], {
      llm,
      seatId: 2,
      onUsage: (input) => reported.push(input),
    });

    await agent.vote(VIEW, [0, 1, 3], () => 0);

    expect(reported.map((input) => input.phase)).toEqual(['vote']);
  });

  it('调用抛错时不上报（没拿到响应就没有 usage）', async () => {
    const llm = scriptedLlm([new Error('socket hang up'), new Error('socket hang up')]);
    const reported: UsageRecordInput[] = [];
    const agent = new PlayerAgent(PERSONAS[2], {
      llm,
      seatId: 2,
      onUsage: (input) => reported.push(input),
    });

    await expect(agent.speak(VIEW)).resolves.toEqual({ text: FALLBACK_SPEECH, fallback: true });
    expect(reported).toEqual([]);
  });

  it('没传 onUsage 时照常工作，不抛错', async () => {
    const llm = scriptedLlm(['{"speech":"早上常喝的白色饮品"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm, seatId: 2 });

    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早上常喝的白色饮品',
      fallback: false,
    });
  });
});
```

- [ ] **Step 2: 给已有的 8 处构造补上 seatId**

Run: `sed -i 's/new PlayerAgent(PERSONAS\[2\], { llm })/new PlayerAgent(PERSONAS[2], { llm, seatId: 2 })/g' tests/agents/player-agent.test.ts`
Expected: 静默成功；`grep -c "seatId: 2" tests/agents/player-agent.test.ts` 至少为 8。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/agents/player-agent.test.ts`
Expected: FAIL，新加的 5 个用例报 `Object literal may only specify known properties` / `reported` 为空数组。

- [ ] **Step 4: 改写 `lib/agents/player-agent.ts`**

整文件替换为：

```ts
import {
  buildSpeechMessages,
  buildVoteMessages,
  parseSpeechReply,
  parseVoteReply,
} from '@/lib/agents/prompt';
import type { UsagePhase, UsageSink } from '@/lib/billing/ledger';
import { pickRandom } from '@/lib/game/rules';
import type { AgentView, Persona, SeatAgent, SpeechResult, VoteResult } from '@/lib/game/types';
import type { LlmClient, LlmMessage } from '@/lib/llm/types';

export const FALLBACK_SPEECH = '（本轮没有给出有效发言）';
export const FALLBACK_VOTE_REASON = '（模型没有给出有效投票，已随机选择）';
export const AGENT_MAX_ATTEMPTS = 2;
const DEFAULT_AGENT_TEMPERATURE = 0.4;

export interface PlayerAgentDeps {
  llm: LlmClient;
  /** 座位号会写进每条用量记录，账单据此按座位分组。 */
  seatId: number;
  /** 不传就是不记账（比如纯逻辑测试）。 */
  onUsage?: UsageSink;
  temperature?: number;
}

export class PlayerAgent implements SeatAgent {
  constructor(
    private readonly persona: Persona,
    private readonly deps: PlayerAgentDeps,
  ) {}

  async speak(view: AgentView): Promise<SpeechResult> {
    const messages = buildSpeechMessages(this.persona, view);
    for (let attempt = 0; attempt < AGENT_MAX_ATTEMPTS; attempt += 1) {
      const raw = await this.tryComplete(messages, 'speak');
      if (raw === null) {
        continue;
      }
      const text = parseSpeechReply(raw, view.word);
      if (text !== null) {
        return { text, fallback: false };
      }
    }
    return { text: FALLBACK_SPEECH, fallback: true };
  }

  async vote(view: AgentView, candidateIds: number[], rng: () => number): Promise<VoteResult> {
    const messages = buildVoteMessages(this.persona, view, candidateIds);
    for (let attempt = 0; attempt < AGENT_MAX_ATTEMPTS; attempt += 1) {
      const raw = await this.tryComplete(messages, 'vote');
      if (raw === null) {
        continue;
      }
      const parsed = parseVoteReply(raw, candidateIds);
      if (parsed !== null) {
        return { ...parsed, fallback: false };
      }
    }
    return {
      targetSeatId: pickRandom(candidateIds, rng),
      reason: FALLBACK_VOTE_REASON,
      fallback: true,
    };
  }

  /** 模型调用失败不向外抛：交给下一次尝试，用尽后由调用方走兜底。 */
  private async tryComplete(messages: LlmMessage[], phase: UsagePhase): Promise<string | null> {
    try {
      const completion = await this.deps.llm.complete(messages, {
        temperature: this.deps.temperature ?? DEFAULT_AGENT_TEMPERATURE,
      });
      // 只要拿到了响应就记一笔：内容不合格要重试，但 token 已经花掉了。
      this.deps.onUsage?.({
        seatId: this.deps.seatId,
        phase,
        provider: this.deps.llm.provider,
        model: this.deps.llm.model,
        usage: completion.usage,
      });
      return completion.text;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 5: 给 bootstrap 里的构造补上 seatId**

修改 `lib/game/bootstrap.ts` 第 39-41 行（完整的 ledger 接线在 Task 9）：

```ts
  const agents = new Map<number, SeatAgent>(
    PERSONAS.map((persona, seatId) => [seatId, new PlayerAgent(persona, { llm, seatId })]),
  );
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/agents/player-agent.test.ts`
Expected: PASS，原有用例 + 5 个新用例全绿。

- [ ] **Step 7: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add lib/agents/player-agent.ts lib/game/bootstrap.ts tests/agents/player-agent.test.ts
git commit -m "feat(agents): 每次模型调用上报座位与阶段用量"
```

---

### Task 8: bill 事件、账单发射器与视图归约

SSE 路由见到终局事件（`error`，或带 `winner` 的 `result`）就会关流，所以 `bill` **必须抢在终局事件之前**发出去。做法是用 `createBillEmitter` 包住注入给 Judge 的 `emit`，Judge 本身一行不改。

**Files:**
- Modify: `lib/game/types.ts`
- Modify: `lib/game/state.ts:99-110`
- Create: `lib/billing/bill-emitter.ts`
- Modify: `lib/client/apply-event.ts`
- Create: `tests/billing/bill-emitter.test.ts`
- Modify: `tests/client/apply-event.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `Bill` / `buildBill`；Task 4 的 `UsageLedger`；现有 `isTerminalEvent` / `GameEvent` / `PublicGameView`。
- Produces:
  - `GameEvent` 新增分支 `{ type: 'bill'; bill: Bill }`
  - `PublicGameView` 新增字段 `bill: Bill | null`
  - `interface BillEmitterDeps { gameId: string; provider: LlmProvider; model: string; ledger: UsageLedger; now: () => number; emit: (event: GameEvent) => void }`
  - `createBillEmitter(deps: BillEmitterDeps): (event: GameEvent) => void`

- [ ] **Step 1: 写发射器的失败测试**

创建 `tests/billing/bill-emitter.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { createBillEmitter } from '@/lib/billing/bill-emitter';
import { UsageLedger } from '@/lib/billing/ledger';
import { BILL_ESTIMATE_NOTE } from '@/lib/billing/estimate';
import type { GameEvent } from '@/lib/game/types';

function setup() {
  const ledger = new UsageLedger(() => 100);
  ledger.append({
    seatId: 0,
    phase: 'speak',
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cacheHitTokens: 800,
      cacheMissTokens: 200,
      usageReported: true,
      cacheReported: true,
    },
  });

  const events: GameEvent[] = [];
  const emit = createBillEmitter({
    gameId: 'g-1',
    provider: 'deepseek',
    model: 'deepseek-chat',
    ledger,
    now: () => 777,
    emit: (event) => events.push(event),
  });

  return { emit, events, ledger };
}

const TERMINAL_RESULT: GameEvent = {
  type: 'result',
  round: 2,
  eliminatedSeatId: 3,
  tieBreak: false,
  winner: 'civilians',
  reveal: [],
};

describe('createBillEmitter', () => {
  it('非终局事件原样透传，不发账单', () => {
    const { emit, events } = setup();

    emit({ type: 'phase', phase: 'speak', round: 1, activeSeatId: 0 });
    emit({ type: 'result', round: 1, eliminatedSeatId: 1, tieBreak: false, winner: null, reveal: null });

    expect(events.map((event) => event.type)).toEqual(['phase', 'result']);
  });

  it('终局 result 之前插一条 bill', () => {
    const { emit, events } = setup();

    emit(TERMINAL_RESULT);

    expect(events.map((event) => event.type)).toEqual(['bill', 'result']);
  });

  it('error 终局同样先发 bill', () => {
    const { emit, events } = setup();

    emit({ type: 'error', message: '单局硬超时，已终止本局' });

    expect(events.map((event) => event.type)).toEqual(['bill', 'error']);
  });

  it('账单内容来自 ledger 快照与 now()', () => {
    const { emit, events } = setup();

    emit(TERMINAL_RESULT);

    const billEvent = events[0];
    if (billEvent.type !== 'bill') {
      throw new Error('第一条事件应该是 bill');
    }
    expect(billEvent.bill.gameId).toBe('g-1');
    expect(billEvent.bill.provider).toBe('deepseek');
    expect(billEvent.bill.model).toBe('deepseek-chat');
    expect(billEvent.bill.finishedAt).toBe(777);
    expect(billEvent.bill.estimated).toBe(true);
    expect(billEvent.bill.calls).toHaveLength(1);
    expect(billEvent.bill.totals.cacheHitTokens).toBe(800);
    expect(billEvent.bill.notes[0]).toBe(BILL_ESTIMATE_NOTE);
  });

  it('一局只发一次 bill，终局后再来事件也不会重复', () => {
    const { emit, events } = setup();

    emit(TERMINAL_RESULT);
    emit({ type: 'error', message: '又炸了' });

    expect(events.filter((event) => event.type === 'bill')).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(['bill', 'result', 'error']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/billing/bill-emitter.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/billing/bill-emitter"`。

- [ ] **Step 3: 给 `GameEvent` 与 `PublicGameView` 加上账单**

修改 `lib/game/types.ts`：文件顶部加一行 import，`PublicGameView` 加一个字段，`GameEvent` 加一个分支。

```ts
import type { Bill } from '@/lib/billing/estimate';
```

```ts
export interface PublicGameView {
  gameId: string;
  round: number;
  phase: Phase;
  activeSeatId: number | null;
  seats: PublicSeat[];
  log: LogEntry[];
  winner: Winner | null;
  errorMessage: string | null;
  /** 局末账单；没结束或没收到 bill 事件时为 null。 */
  bill: Bill | null;
}
```

```ts
export type GameEvent =
  | { type: 'phase'; phase: Phase; round: number; activeSeatId: number | null }
  | { type: 'speech'; round: number; seatId: number; text: string; fallback: boolean }
  | {
      type: 'vote';
      round: number;
      seatId: number;
      targetSeatId: number;
      reason: string;
      fallback: boolean;
    }
  | {
      type: 'result';
      round: number;
      eliminatedSeatId: number | null;
      tieBreak: boolean;
      winner: Winner | null;
      reveal: RevealSeat[] | null;
    }
  /** 终局事件之前发出的本局估算账单，绝不含 API Key。 */
  | { type: 'bill'; bill: Bill }
  | { type: 'error'; message: string };
```

- [ ] **Step 4: `toPublicView` 补上 bill 字段**

修改 `lib/game/state.ts` 的 `toPublicView`：

```ts
export function toPublicView(state: GameState): PublicGameView {
  return {
    gameId: state.gameId,
    round: state.round,
    phase: state.phase,
    activeSeatId: state.activeSeatId,
    seats: toPublicSeats(state),
    log: [...state.log],
    winner: state.winner,
    errorMessage: state.errorMessage,
    // 账单不进 GameState，只靠 bill 事件推给浏览器。
    bill: null,
  };
}
```

- [ ] **Step 5: 实现 `lib/billing/bill-emitter.ts`**

```ts
import { buildBill } from '@/lib/billing/estimate';
import type { UsageLedger } from '@/lib/billing/ledger';
import { isTerminalEvent } from '@/lib/game/session';
import type { GameEvent } from '@/lib/game/types';
import type { LlmProvider } from '@/lib/llm/types';

export interface BillEmitterDeps {
  gameId: string;
  provider: LlmProvider;
  model: string;
  ledger: UsageLedger;
  now: () => number;
  emit: (event: GameEvent) => void;
}

/**
 * 包住 Judge 的 emit：SSE 路由一见到终局事件就关流，
 * 所以账单必须抢在终局事件前面发，而且一局只发一次。
 */
export function createBillEmitter(deps: BillEmitterDeps): (event: GameEvent) => void {
  let billed = false;

  return (event) => {
    if (isTerminalEvent(event) && !billed) {
      billed = true;
      deps.emit({
        type: 'bill',
        bill: buildBill({
          gameId: deps.gameId,
          provider: deps.provider,
          model: deps.model,
          finishedAt: deps.now(),
          records: deps.ledger.records(),
        }),
      });
    }
    deps.emit(event);
  };
}
```

- [ ] **Step 6: 跑发射器测试确认通过**

Run: `npx vitest run tests/billing/bill-emitter.test.ts`
Expected: PASS，5 个用例全绿。

- [ ] **Step 7: 写 applyEvent 的 bill 用例**

修改 `tests/client/apply-event.test.ts`：给 `BASE` 补上 `bill: null`，并追加一个 describe。

```ts
const BASE: PublicGameView = {
  gameId: 'g-1',
  round: 0,
  phase: 'setup',
  activeSeatId: null,
  seats: [
    { id: 0, name: '阿岚', personaLabel: '谨慎分析', alive: true },
    { id: 1, name: '小柯', personaLabel: '幽默带节奏', alive: true },
    { id: 2, name: '雷子', personaLabel: '激进带节奏', alive: true },
    { id: 3, name: '沉舟', personaLabel: '少话观察', alive: true },
  ],
  log: [],
  winner: null,
  errorMessage: null,
  bill: null,
};
```

```ts
describe('applyEvent 的 bill 分支', () => {
  const bill = buildBill({
    gameId: 'g-1',
    provider: 'deepseek',
    model: 'deepseek-chat',
    finishedAt: 42,
    records: [],
  });

  it('把账单挂到视图上，其余字段不动', () => {
    const next = applyEvent(BASE, { type: 'bill', bill });

    expect(next.bill).toBe(bill);
    expect(next.log).toEqual(BASE.log);
    expect(next.phase).toBe(BASE.phase);
    expect(next.winner).toBeNull();
  });

  it('不改原对象', () => {
    applyEvent(BASE, { type: 'bill', bill });
    expect(BASE.bill).toBeNull();
  });
});
```

顶部补 import：

```ts
import { buildBill } from '@/lib/billing/estimate';
```

- [ ] **Step 8: 跑测试确认失败**

Run: `npx vitest run tests/client/apply-event.test.ts && npm run typecheck`
Expected: FAIL。vitest 报 `TypeError: Cannot read properties of undefined (reading 'bill')`——`applyEvent` 的 switch 没有 `bill` 分支，函数返回了 `undefined`；`tsc` 同时报 `lib/client/apply-event.ts` 「Not all code paths return a value」。

- [ ] **Step 9: 给 `applyEvent` 加 bill 分支**

修改 `lib/client/apply-event.ts`，在 `case 'result'` 与 `case 'error'` 之间插入：

```ts
    case 'bill':
      return { ...view, bill: event.bill };
```

- [ ] **Step 10: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。`tests/game/state.test.ts` 不受影响（它只断言座位字段与序列化内容）。

- [ ] **Step 11: 提交**

```bash
git add lib/game/types.ts lib/game/state.ts lib/billing/bill-emitter.ts lib/client/apply-event.ts tests/billing/bill-emitter.test.ts tests/client/apply-event.test.ts
git commit -m "feat(billing): 终局前推送 bill 事件并归约进视图"
```

---

### Task 9: 开局链路从环境变量切到请求体

`startGame` 不再读 `process.env`：Key 只能由 `POST /api/games` 的请求体带进来，落在这一局的 session 内存里。同时在这里把 `UsageLedger` 和 `createBillEmitter` 接上，并删掉已经没人用的 `readZhipuConfigFromEnv` / `MissingApiKeyError`。

**Files:**
- Modify: `lib/game/bootstrap.ts`（整文件重写）
- Modify: `app/api/games/route.ts`（整文件重写）
- Modify: `lib/llm/zhipu.ts`（删 `MissingApiKeyError` / `ZhipuConfig` / `readZhipuConfigFromEnv`）
- Modify: `tests/game/bootstrap.test.ts`（整文件重写）
- Modify: `tests/api/routes.test.ts`（整文件重写）

**Interfaces:**
- Consumes: Task 3 的 `LlmConfig` / `InvalidLlmConfigError` / `parseLlmConfig` / `createLlmClient`；Task 4 的 `UsageLedger`；Task 8 的 `createBillEmitter`；Task 7 的 `PlayerAgentDeps`。
- Produces:
  - `interface StartGameOptions { llmConfig?: LlmConfig; rng?: () => number; now?: () => number; llm?: LlmClient; hardTimeoutMs?: number }`（**删掉了 `env`**）
  - `startGame(options?: StartGameOptions): GameSession`（缺配置时同步抛 `InvalidLlmConfigError`）
  - `POST(request: Request): Promise<Response>`：201 `{ gameId }` / 400 `{ error }` / 500 `{ error }`

- [ ] **Step 1: 重写 bootstrap 测试**

把 `tests/game/bootstrap.test.ts` 整文件替换为：

```ts
import { describe, expect, it } from 'vitest';

import { BILL_ESTIMATE_NOTE } from '@/lib/billing/estimate';
import { startGame } from '@/lib/game/bootstrap';
import { getSession } from '@/lib/game/registry';
import { InvalidLlmConfigError } from '@/lib/llm/create-client';
import type { LlmClient } from '@/lib/llm/types';

/** 永远给出合法发言与合法投票（总投候选里的第一个）的假模型，并固定上报一份 usage。 */
function fakeLlm(): LlmClient {
  return {
    provider: 'zhipu',
    model: 'glm-4-flash',
    async complete(messages) {
      const prompt = messages[messages.length - 1].content;
      const text = prompt.includes('"speech"')
        ? '{"speech":"一种常见的日常事物"}'
        : `{"vote":${Number(prompt.match(/可投的座位号：(\d+)/)?.[1] ?? 0)},"reason":"先投票再说"}`;
      return {
        text,
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          cacheHitTokens: 64,
          cacheMissTokens: 36,
          usageReported: true,
          cacheReported: true,
        },
      };
    },
  };
}

describe('startGame', () => {
  it('既没有 llmConfig 也没有注入 llm 时抛 InvalidLlmConfigError，且不建局', () => {
    expect(() => startGame()).toThrow(InvalidLlmConfigError);
    expect(() => startGame()).toThrow('缺少模型配置');
  });

  it('注入 mock 模型时能跑完整局并把 session 注册进 registry', async () => {
    const session = startGame({ llm: fakeLlm(), rng: () => 0 });

    expect(getSession(session.gameId)).toBe(session);
    await session.completion;

    expect(session.finished).toBe(true);
    expect(session.state.winner).not.toBeNull();
    expect(session.events.at(-1)?.type).toBe('phase');
    expect(session.events.some((event) => event.type === 'speech')).toBe(true);
    expect(session.events.some((event) => event.type === 'vote')).toBe(true);
  });

  it('座位配置为 4 人 3 平民 1 卧底，并使用内置人设', async () => {
    const session = startGame({ llm: fakeLlm(), rng: () => 0 });
    await session.completion;

    expect(session.state.seats).toHaveLength(4);
    expect(session.state.seats.filter((seat) => seat.role === 'undercover')).toHaveLength(1);
    expect(session.state.seats.map((seat) => seat.personaId)).toEqual([
      'analyst',
      'joker',
      'striker',
      'watcher',
    ]);
  });

  it('gameId 是 uuid，且每局互不相同', async () => {
    const first = startGame({ llm: fakeLlm(), rng: () => 0 });
    const second = startGame({ llm: fakeLlm(), rng: () => 0 });
    await Promise.all([first.completion, second.completion]);

    expect(first.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.gameId).not.toBe(second.gameId);
  });

  it('终局事件之前推一条 bill，含每次调用明细与缓存字段', async () => {
    const session = startGame({ llm: fakeLlm(), rng: () => 0 });
    await session.completion;

    const billIndex = session.events.findIndex((event) => event.type === 'bill');
    const terminalIndex = session.events.findIndex(
      (event) => event.type === 'result' && event.winner !== null,
    );

    expect(billIndex).toBeGreaterThan(-1);
    expect(billIndex).toBeLessThan(terminalIndex);

    const billEvent = session.events[billIndex];
    if (billEvent.type !== 'bill') {
      throw new Error('billIndex 指向的不是 bill 事件');
    }
    expect(billEvent.bill.provider).toBe('zhipu');
    expect(billEvent.bill.model).toBe('glm-4-flash');
    expect(billEvent.bill.estimated).toBe(true);
    expect(billEvent.bill.notes[0]).toBe(BILL_ESTIMATE_NOTE);
    expect(billEvent.bill.totals.calls).toBeGreaterThan(0);
    expect(billEvent.bill.calls).toHaveLength(billEvent.bill.totals.calls);
    expect(billEvent.bill.calls.every((call) => call.cacheReported)).toBe(true);
    expect(billEvent.bill.calls.every((call) => call.totalTokens === 120)).toBe(true);
    expect(billEvent.bill.bySeat.map((seat) => seat.seatId)).toEqual([0, 1, 2, 3]);
    expect(billEvent.bill.totals.estimatedCostCny).toBeGreaterThanOrEqual(0);
  });

  it('bill 事件与整局事件流里都不含 API Key', async () => {
    const session = startGame({
      llmConfig: { provider: 'zhipu', model: 'glm-4-flash', apiKey: 'sk-should-not-leak' },
      llm: fakeLlm(),
      rng: () => 0,
    });
    await session.completion;

    expect(JSON.stringify(session.events)).not.toContain('sk-should-not-leak');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/game/bootstrap.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/llm/create-client"` 之外的 `startGame()` 不抛错、也没有 `bill` 事件。

- [ ] **Step 3: 重写 `lib/game/bootstrap.ts`**

```ts
import { randomUUID } from 'node:crypto';

import { PERSONAS } from '@/lib/agents/personas';
import { PlayerAgent } from '@/lib/agents/player-agent';
import { createBillEmitter } from '@/lib/billing/bill-emitter';
import { UsageLedger } from '@/lib/billing/ledger';
import { runGame } from '@/lib/game/judge';
import { putSession } from '@/lib/game/registry';
import { createSession, publish, type GameSession } from '@/lib/game/session';
import { createGame } from '@/lib/game/state';
import { SEAT_COUNT, type SeatAgent } from '@/lib/game/types';
import { drawWordPair, loadWordPairs } from '@/lib/game/word-bank';
import { InvalidLlmConfigError, createLlmClient, type LlmConfig } from '@/lib/llm/create-client';
import type { LlmClient } from '@/lib/llm/types';

export interface StartGameOptions {
  /** 来自 POST /api/games 的请求体；Key 只活在这一局的闭包里，不写盘不打日志。 */
  llmConfig?: LlmConfig;
  rng?: () => number;
  now?: () => number;
  /** 测试用的注入点：给了就不会去建真实客户端。 */
  llm?: LlmClient;
  hardTimeoutMs?: number;
}

function resolveClient(options: StartGameOptions): LlmClient {
  if (options.llm) {
    return options.llm;
  }
  if (!options.llmConfig) {
    throw new InvalidLlmConfigError('缺少模型配置：请在页面「模型设置」里选择供应商并填写 API Key');
  }
  return createLlmClient(options.llmConfig);
}

/**
 * 同步完成建局与注册，然后把 Judge 的整局循环放到后台跑。
 * 配置不合法会在这里同步抛出 InvalidLlmConfigError，调用方据此返回可读错误，绝不空跑。
 */
export function startGame(options: StartGameOptions = {}): GameSession {
  const rng = options.rng ?? Math.random;
  const now = options.now ?? Date.now;
  const llm = resolveClient(options);

  const pair = drawWordPair(loadWordPairs(), rng);
  const undercoverSeatId = Math.min(Math.floor(rng() * SEAT_COUNT), SEAT_COUNT - 1);
  const state = createGame({ gameId: randomUUID(), personas: PERSONAS, pair, undercoverSeatId });

  const session = createSession(state);
  putSession(session);

  const ledger = new UsageLedger(now);
  const onUsage = ledger.sink();

  const agents = new Map<number, SeatAgent>(
    PERSONAS.map((persona, seatId) => [seatId, new PlayerAgent(persona, { llm, seatId, onUsage })]),
  );

  // 账单必须抢在终局事件前面发，否则 SSE 已经关流了。
  const emit = createBillEmitter({
    gameId: state.gameId,
    provider: llm.provider,
    model: llm.model,
    ledger,
    now,
    emit: (event) => publish(session, event),
  });

  session.completion = runGame(state, {
    agents,
    rng,
    now,
    hardTimeoutMs: options.hardTimeoutMs,
    emit,
  }).then(() => undefined);

  return session;
}
```

- [ ] **Step 4: 跑 bootstrap 测试确认通过**

Run: `npx vitest run tests/game/bootstrap.test.ts`
Expected: PASS，6 个用例全绿。

- [ ] **Step 5: 重写 API 路由测试**

把 `tests/api/routes.test.ts` 整文件替换为：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LlmClient } from '@/lib/llm/types';
import type { StartGameOptions } from '@/lib/game/bootstrap';

// 路由的 201 分支会真的建一局；这里把 startGame 包一层，强制塞进假模型，
// 保证测试永远不发真实外网请求，同时还能断言解析后的配置确实传到了 bootstrap。
const { fakeLlm } = vi.hoisted(() => {
  function fakeLlm(): LlmClient {
    return {
      provider: 'zhipu',
      model: 'glm-4-flash',
      async complete(messages) {
        const prompt = messages[messages.length - 1].content;
        const text = prompt.includes('"speech"')
          ? '{"speech":"一种常见的日常事物"}'
          : `{"vote":${Number(prompt.match(/可投的座位号：(\d+)/)?.[1] ?? 0)},"reason":"先投票再说"}`;
        return {
          text,
          usage: {
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
            cacheHitTokens: 64,
            cacheMissTokens: 36,
            usageReported: true,
            cacheReported: true,
          },
        };
      },
    };
  }
  return { fakeLlm };
});

vi.mock('@/lib/game/bootstrap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/game/bootstrap')>();
  return {
    ...actual,
    startGame: vi.fn((options: StartGameOptions = {}) =>
      actual.startGame({ ...options, llm: options.llm ?? fakeLlm() }),
    ),
  };
});

const { POST } = await import('@/app/api/games/route');
const { GET: getEvents } = await import('@/app/api/games/[gameId]/events/route');
const { GET: getReveal } = await import('@/app/api/games/[gameId]/reveal/route');
const { startGame } = await import('@/lib/game/bootstrap');

function postRequest(body: unknown, raw?: string): Request {
  return new Request('http://localhost/api/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

function params(gameId: string) {
  return { params: Promise.resolve({ gameId }) };
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('响应没有 body');
  }
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(startGame).mockClear();
});

describe('POST /api/games 请求体校验', () => {
  it('缺 apiKey 时返回 400 和可读错误', async () => {
    const response = await POST(postRequest({ provider: 'zhipu', model: 'glm-4-flash' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '缺少 apiKey：请在页面「模型设置」里填入该供应商的 API Key',
    });
    expect(startGame).not.toHaveBeenCalled();
  });

  it('未知 provider 返回 400', async () => {
    const response = await POST(postRequest({ provider: 'openai', apiKey: 'k' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'provider 只能是 zhipu 或 deepseek' });
  });

  it('请求体不是合法 JSON 时返回 400', async () => {
    const response = await POST(postRequest(null, '这不是 JSON'));

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('请求体必须是 JSON 对象');
  });

  it('错误响应里不会回显 API Key', async () => {
    const response = await POST(postRequest({ provider: 'openai', apiKey: 'sk-secret-value' }));

    expect(await response.text()).not.toContain('sk-secret-value');
  });

  it('三项齐全时返回 201 与 gameId，并把配置透传给 startGame', async () => {
    const response = await POST(
      postRequest({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-1' }),
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { gameId: string };
    expect(payload.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(vi.mocked(startGame).mock.calls[0][0]?.llmConfig).toEqual({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'sk-1',
    });
  });

  it('model 留空时按供应商默认模型开局', async () => {
    await POST(postRequest({ provider: 'deepseek', apiKey: 'sk-1' }));

    expect(vi.mocked(startGame).mock.calls[0][0]?.llmConfig?.model).toBe('deepseek-chat');
  });
});

describe('GET /api/games/[gameId]/events', () => {
  it('对局不存在时返回 404', async () => {
    const response = await getEvents(new Request('http://localhost/e'), params('不存在'));
    expect(response.status).toBe(404);
  });

  it('先推 snapshot，再回放事件，终局后关流', async () => {
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');

    const body = await readStream(response);
    expect(body.startsWith('event: snapshot\ndata: ')).toBe(true);
    expect(body).toContain('event: speech\ndata: ');
    expect(body).toContain('event: vote\ndata: ');
    expect(body).toContain('event: result\ndata: ');

    const snapshotLine = body.split('\n\n')[0].split('data: ')[1];
    const snapshot = JSON.parse(snapshotLine) as { seats: unknown[]; bill: unknown };
    expect(snapshot.seats).toHaveLength(4);
    expect(snapshot.bill).toBeNull();
  });

  it('bill 帧排在终局 result 帧之前，关流前一定送达', async () => {
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    const body = await readStream(response);

    const billIndex = body.indexOf('event: bill\ndata: ');
    const finalResultIndex = body.lastIndexOf('event: result\ndata: ');

    expect(billIndex).toBeGreaterThan(-1);
    expect(billIndex).toBeLessThan(finalResultIndex);

    const billFrame = body.slice(billIndex).split('\n\n')[0];
    const bill = JSON.parse(billFrame.split('data: ')[1]) as {
      bill: { estimated: boolean; calls: unknown[] };
    };
    expect(bill.bill.estimated).toBe(true);
    expect(bill.bill.calls.length).toBeGreaterThan(0);
  });
});

describe('GET /api/games/[gameId]/reveal', () => {
  it('未启用上帝视角时返回 403', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'false');
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getReveal(new Request('http://localhost/r'), params(session.gameId));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: '上帝视角未启用：请在 .env.local 设置 ENABLE_GOD_VIEW=true 后重启服务',
    });
  });

  it('启用后返回身份与私有词', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'true');
    const session = startGame({ rng: () => 0 });
    await session.completion;

    const response = await getReveal(new Request('http://localhost/r'), params(session.gameId));
    const body = (await response.json()) as { reveal: Array<{ seatId: number; role: string }> };

    expect(response.status).toBe(200);
    expect(body.reveal).toHaveLength(4);
    expect(body.reveal.filter((seat) => seat.role === 'undercover')).toHaveLength(1);
  });

  it('启用后查不到的对局返回 404', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'true');
    const response = await getReveal(new Request('http://localhost/r'), params('不存在'));
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npx vitest run tests/api/routes.test.ts`
Expected: FAIL，`POST` 还是零参数签名，四个 400 用例全挂。

- [ ] **Step 7: 重写 `app/api/games/route.ts`**

```ts
import { NextResponse } from 'next/server';

import { startGame } from '@/lib/game/bootstrap';
import { InvalidLlmConfigError, parseLlmConfig } from '@/lib/llm/create-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  // 请求体解析失败按「不是 JSON 对象」处理，交给 parseLlmConfig 统一出文案。
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  try {
    const llmConfig = parseLlmConfig(body);
    const session = startGame({ llmConfig });
    return NextResponse.json({ gameId: session.gameId }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidLlmConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // 兜底文案只带错误信息，apiKey 从来不会出现在这些异常里。
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `创建对局失败：${message}` }, { status: 500 });
  }
}
```

- [ ] **Step 8: 删掉 zhipu.ts 里的环境变量入口**

修改 `lib/llm/zhipu.ts`：删除 `MissingApiKeyError`、`ZhipuConfig`、`readZhipuConfigFromEnv` 三个导出，并把 `ZhipuClientOptions` 改成不再 extends。文件最终内容为：

```ts
import { createOpenAiCompatibleClient } from '@/lib/llm/openai-compatible';
import type { LlmClient } from '@/lib/llm/types';

export const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const ZHIPU_DEFAULT_MODEL = 'glm-4-flash';
export const ZHIPU_LABEL = '智谱';

export interface ZhipuClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createZhipuClient(options: ZhipuClientOptions): LlmClient {
  return createOpenAiCompatibleClient({
    provider: 'zhipu',
    label: ZHIPU_LABEL,
    baseUrl: options.baseUrl ?? ZHIPU_DEFAULT_BASE_URL,
    apiKey: options.apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  });
}
```

Run: `grep -rn "ZHIPU_API_KEY\|MissingApiKeyError\|readZhipuConfigFromEnv" lib app tests`
Expected: 无输出（README 里的说明留到 Task 15 一起改）。

- [ ] **Step 9: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS，`tests/api/routes.test.ts` 12 个用例全绿。

- [ ] **Step 10: 提交**

```bash
git add lib/game/bootstrap.ts app/api/games/route.ts lib/llm/zhipu.ts tests/game/bootstrap.test.ts tests/api/routes.test.ts
git commit -m "feat(api): 开局配置改由请求体传入并接上账单流水"
```

---

### Task 10: 模型设置的浏览器存储

设置读写全部做成不依赖 DOM 的纯函数 + 一个窄接口 `SettingsStorage`，这样在 node 环境下也能完整单测；组件只负责把它们串起来。

**Files:**
- Create: `lib/client/settings-storage.ts`
- Create: `tests/client/settings-storage.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `DEFAULT_MODELS` / `PROVIDER_LABELS` / `isLlmProvider`；Task 1 的 `LlmProvider`。
- Produces:
  - `SETTINGS_STORAGE_KEY = 'agent-undercover:llm-settings'`
  - `interface LlmSettings { provider: LlmProvider; model: string; apiKey: string }`
  - `interface SettingsStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }`
  - `STORAGE_WRITE_ERROR: string`
  - `defaultSettings(): LlmSettings`
  - `parseSettings(raw: string | null): LlmSettings`
  - `serializeSettings(settings: LlmSettings): string`
  - `validateSettings(settings: LlmSettings): string | null`
  - `buildStartRequestBody(settings: LlmSettings): { provider: LlmProvider; model: string; apiKey: string }`
  - `loadSettings(storage: SettingsStorage | null): LlmSettings`
  - `saveSettings(settings: LlmSettings, storage: SettingsStorage | null): string | null`
  - `clearStoredSettings(storage: SettingsStorage | null): void`
  - `browserStorage(): SettingsStorage | null`

- [ ] **Step 1: 写设置存储的失败测试**

创建 `tests/client/settings-storage.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/client/settings-storage.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/client/settings-storage"`。

- [ ] **Step 3: 实现 `lib/client/settings-storage.ts`**

```ts
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
  const provider = isLlmProvider(source.provider) ? source.provider : defaultSettings().provider;
  const model = typeof source.model === 'string' && source.model.trim() !== ''
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
  if (settings.apiKey.trim() === '') {
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
    apiKey: settings.apiKey.trim(),
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/client/settings-storage.test.ts`
Expected: PASS，17 个用例全绿。

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add lib/client/settings-storage.ts tests/client/settings-storage.test.ts
git commit -m "feat(client): 模型设置的 localStorage 读写与校验"
```

---

### Task 11: 事件流 hook 接上设置与账单

`start()` 改成带设置发 POST，并订阅新的 `bill` 事件。这一 Task 全是 React 接线，node 环境的 vitest 没有 DOM，所以靠 `npm run typecheck` + `npm run build` + Task 15 的手工验收兜底；纯函数部分（`validateSettings` / `buildStartRequestBody`）已经在 Task 10 测过了。

**Files:**
- Modify: `lib/client/use-game-stream.ts`（整文件重写）

**Interfaces:**
- Consumes: Task 10 的 `LlmSettings` / `validateSettings` / `buildStartRequestBody`；Task 6 的 `Bill`；Task 8 的 `applyEvent` 新分支。
- Produces:
  - `interface GameStream { view: PublicGameView | null; status: StreamStatus; errorMessage: string | null; bill: Bill | null; start: (settings: LlmSettings) => Promise<void> }`
  - `useGameStream(): GameStream`
  - `EVENT_NAMES` 增加 `'bill'`

- [ ] **Step 1: 重写 `lib/client/use-game-stream.ts`**

```ts
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
```

- [ ] **Step 2: 确认类型检查失败点已暴露**

Run: `npm run typecheck`
Expected: FAIL，`app/page.tsx` 报 `Expected 1 arguments, but got 0`——`start()` 现在需要一份设置。这正是 Task 13 要接的线。

- [ ] **Step 3: 临时让 page 通过类型检查**

修改 `app/page.tsx` 第 11 行与第 15 行（Task 13 会把它换成真正的设置表单）：

```tsx
  const { view, status, errorMessage, start } = useGameStream();
  const settings = defaultSettings();
```

```tsx
      <TopBar view={view} status={status} onStart={() => void start(settings)} />
```

顶部补 import：

```tsx
import { defaultSettings } from '@/lib/client/settings-storage';
```

- [ ] **Step 4: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/client/use-game-stream.ts app/page.tsx
git commit -m "feat(client): 开局带上模型设置并订阅 bill 事件"
```

---

### Task 12: 账单历史的浏览器存储

历史同样做成纯函数 + `SettingsStorage`（沿用 Task 10 的窄接口，不再另起一个）。历史里只存 `Bill`，而 `Bill` 类型里根本没有 Key 字段——测试会把这件事钉死。

**Files:**
- Create: `lib/client/bill-history.ts`
- Create: `tests/client/bill-history.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `Bill` / `buildBill`；Task 10 的 `SettingsStorage`。
- Produces:
  - `HISTORY_STORAGE_KEY = 'agent-undercover:bill-history'`
  - `HISTORY_LIMIT = 20`
  - `HISTORY_WRITE_ERROR: string`
  - `interface BillHistoryEntry { gameId: string; savedAt: number; bill: Bill }`
  - `parseHistory(raw: string | null): BillHistoryEntry[]`
  - `serializeHistory(entries: BillHistoryEntry[]): string`
  - `appendBill(entries: BillHistoryEntry[], bill: Bill, savedAt: number): BillHistoryEntry[]`
  - `removeBill(entries: BillHistoryEntry[], gameId: string): BillHistoryEntry[]`
  - `loadHistory(storage: SettingsStorage | null): BillHistoryEntry[]`
  - `saveHistory(entries: BillHistoryEntry[], storage: SettingsStorage | null): string | null`
  - `clearHistory(storage: SettingsStorage | null): void`

- [ ] **Step 1: 写账单历史的失败测试**

创建 `tests/client/bill-history.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/client/bill-history.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/client/bill-history"`。

- [ ] **Step 3: 实现 `lib/client/bill-history.ts`**

```ts
import type { Bill } from '@/lib/billing/estimate';
import type { SettingsStorage } from '@/lib/client/settings-storage';

export const HISTORY_STORAGE_KEY = 'agent-undercover:bill-history';
export const HISTORY_LIMIT = 20;
export const HISTORY_WRITE_ERROR = '浏览器拒绝保存账单历史（可能是隐私模式），本局账单仍可查看';

export interface BillHistoryEntry {
  gameId: string;
  savedAt: number;
  /** Bill 类型里没有任何 Key 字段，历史因此天然不含 API Key。 */
  bill: Bill;
}

function isHistoryEntry(value: unknown): value is BillHistoryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.gameId !== 'string' || typeof entry.savedAt !== 'number') {
    return false;
  }
  const bill = entry.bill;
  return (
    typeof bill === 'object' &&
    bill !== null &&
    'totals' in bill &&
    'calls' in bill &&
    Array.isArray((bill as Bill).calls)
  );
}

export function parseHistory(raw: string | null): BillHistoryEntry[] {
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isHistoryEntry).slice(0, HISTORY_LIMIT);
}

export function serializeHistory(entries: BillHistoryEntry[]): string {
  return JSON.stringify(entries);
}

/** 新→旧；同一局重复写入只保留最新一条；最多 HISTORY_LIMIT 条。 */
export function appendBill(
  entries: BillHistoryEntry[],
  bill: Bill,
  savedAt: number,
): BillHistoryEntry[] {
  return [
    { gameId: bill.gameId, savedAt, bill },
    ...entries.filter((entry) => entry.gameId !== bill.gameId),
  ].slice(0, HISTORY_LIMIT);
}

export function removeBill(entries: BillHistoryEntry[], gameId: string): BillHistoryEntry[] {
  return entries.filter((entry) => entry.gameId !== gameId);
}

export function loadHistory(storage: SettingsStorage | null): BillHistoryEntry[] {
  if (!storage) {
    return [];
  }
  try {
    return parseHistory(storage.getItem(HISTORY_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveHistory(
  entries: BillHistoryEntry[],
  storage: SettingsStorage | null,
): string | null {
  if (!storage) {
    return null;
  }
  try {
    storage.setItem(HISTORY_STORAGE_KEY, serializeHistory(entries));
    return null;
  } catch {
    return HISTORY_WRITE_ERROR;
  }
}

export function clearHistory(storage: SettingsStorage | null): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // 删不掉就算了，不能因为清理失败卡住界面。
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/client/bill-history.test.ts`
Expected: PASS，14 个用例全绿。

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add lib/client/bill-history.ts tests/client/bill-history.test.ts
git commit -m "feat(client): 账单历史的 localStorage 读写"
```

---

### Task 13: 开局设置表单

供应商下拉 + 模型文本框 + password 形态的 API Key，改动即写 localStorage，写失败给提示但不拦对局；另给一个「清除已保存的 Key」按钮。

**Files:**
- Create: `components/SettingsForm.tsx`
- Modify: `app/page.tsx`（整文件重写）
- Modify: `app/globals.css`（追加表单样式）

**Interfaces:**
- Consumes: Task 10 的 `LlmSettings` / `loadSettings` / `saveSettings` / `clearStoredSettings` / `browserStorage` / `defaultSettings`；Task 3 的 `PROVIDERS` / `PROVIDER_LABELS` / `DEFAULT_MODELS`；Task 11 的 `useGameStream`。
- Produces:
  - `interface SettingsFormProps { settings: LlmSettings; disabled: boolean; storageError: string | null; onChange: (next: LlmSettings) => void; onClearKey: () => void }`
  - `function SettingsForm(props: SettingsFormProps): JSX.Element`

- [ ] **Step 1: 写 `components/SettingsForm.tsx`**

```tsx
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
```

- [ ] **Step 2: 重写 `app/page.tsx` 把设置接上开局**

```tsx
'use client';

import { useEffect, useState } from 'react';

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
  const [storageError, setStorageError] = useState<string | null>(null);
  const { view, status, errorMessage, start } = useGameStream();

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
      <TopBar view={view} status={status} onStart={() => void start(settings)} />

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
          <GodPanel gameId={view.gameId} />
        </>
      ) : (
        <p className="panel muted">填好上面的模型设置，点「开始」让四个 AI 玩家自动打一局。</p>
      )}
    </main>
  );
}
```

- [ ] **Step 3: 追加表单样式**

在 `app/globals.css` 末尾追加：

```css
.settings-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  margin-bottom: 8px;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}

.settings-field-wide {
  flex: 1 1 260px;
}

.settings-label {
  font-size: 12px;
  opacity: 0.7;
}

.settings-field input,
.settings-field select {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font: inherit;
}

.settings-field input:disabled,
.settings-field select:disabled {
  opacity: 0.5;
}
```

- [ ] **Step 4: 跑类型检查与构建**

Run: `npm run typecheck && npm run build`
Expected: PASS，`npm run build` 输出 `Compiled successfully`，不再有 `start()` 缺参数的报错。

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: PASS（组件不在 vitest 覆盖范围内，这里确认没有连带打破既有单测）。

- [ ] **Step 6: 提交**

```bash
git add components/SettingsForm.tsx app/page.tsx app/globals.css
git commit -m "feat(ui): 网页配置供应商、模型与 API Key"
```

---

### Task 14: 账单格式化与局末账单面板

展示用的格式化全部抽成纯函数放进 `lib/client/bill-format.ts`（可单测），组件只负责排版。面板分三层：总览（标「估算」）、按座位汇总、可展开的每次调用明细（含缓存命中/未命中或「未提供」）。

**Files:**
- Create: `lib/client/bill-format.ts`
- Create: `tests/client/bill-format.test.ts`
- Create: `components/BillPanel.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Task 4 的 `UsageRecord` / `UsagePhase`；Task 6 的 `Bill` / `estimateCallCostCny`；现有 `seatName`（`lib/client/format.ts`）。
- Produces:
  - `USAGE_PHASE_LABELS: Record<UsagePhase, string>`（`{ speak: '发言', vote: '投票' }`）
  - `CACHE_UNKNOWN_TEXT = '未提供'`
  - `formatCny(value: number): string`
  - `formatTokens(value: number): string`
  - `formatClock(at: number): string`
  - `formatDateTime(at: number): string`
  - `formatCacheCell(record: Pick<UsageRecord, 'cacheReported' | 'cacheHitTokens' | 'cacheMissTokens'>): string`
  - `formatCallCost(record: UsageRecord): string`
  - `interface BillPanelProps { bill: Bill; seats: PublicSeat[]; title?: string }`
  - `function BillPanel(props: BillPanelProps): JSX.Element`

- [ ] **Step 1: 写格式化函数的失败测试**

创建 `tests/client/bill-format.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import type { UsageRecord } from '@/lib/billing/ledger';
import {
  CACHE_UNKNOWN_TEXT,
  USAGE_PHASE_LABELS,
  formatCacheCell,
  formatCallCost,
  formatClock,
  formatCny,
  formatDateTime,
  formatTokens,
} from '@/lib/client/bill-format';

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    at: 1_700_000_000_000,
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
    ...overrides,
  };
}

describe('formatCny', () => {
  it('固定 4 位小数并带人民币符号', () => {
    expect(formatCny(0.012)).toBe('¥0.0120');
    expect(formatCny(0)).toBe('¥0.0000');
    expect(formatCny(12.3)).toBe('¥12.3000');
  });
});

describe('formatTokens', () => {
  it('三位一逗号', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1500)).toBe('1,500');
    expect(formatTokens(1234567)).toBe('1,234,567');
  });
});

describe('formatClock / formatDateTime', () => {
  it('时钟是 HH:MM:SS', () => {
    expect(formatClock(1_700_000_000_000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('日期时间是 YYYY-MM-DD HH:MM', () => {
    expect(formatDateTime(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('formatCacheCell', () => {
  it('供应商报了缓存时显示命中与未命中', () => {
    expect(formatCacheCell(record())).toBe('命中 800 / 未命中 200');
  });

  it('供应商没报缓存时显示「未提供」而不是 0', () => {
    expect(
      formatCacheCell(record({ cacheReported: false, cacheHitTokens: 0, cacheMissTokens: 0 })),
    ).toBe(CACHE_UNKNOWN_TEXT);
    expect(CACHE_UNKNOWN_TEXT).toBe('未提供');
  });
});

describe('formatCallCost', () => {
  it('按这次调用的模型单价算出金额', () => {
    // deepseek-chat：1K prompt * 0.002 + 0.5K completion * 0.008 = 0.006
    expect(formatCallCost(record())).toBe('¥0.0060');
  });
});

describe('USAGE_PHASE_LABELS', () => {
  it('两个阶段都有中文名', () => {
    expect(USAGE_PHASE_LABELS).toEqual({ speak: '发言', vote: '投票' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/client/bill-format.test.ts`
Expected: FAIL，报 `Failed to resolve import "@/lib/client/bill-format"`。

- [ ] **Step 3: 实现 `lib/client/bill-format.ts`**

```ts
import { estimateCallCostCny, roundCny } from '@/lib/billing/estimate';
import type { UsagePhase, UsageRecord } from '@/lib/billing/ledger';

export const USAGE_PHASE_LABELS: Record<UsagePhase, string> = {
  speak: '发言',
  vote: '投票',
};

export const CACHE_UNKNOWN_TEXT = '未提供';

export function formatCny(value: number): string {
  return `¥${value.toFixed(4)}`;
}

/** 自己插逗号，不依赖 Intl，保证不同 Node 构建下输出一致。 */
export function formatTokens(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatClock(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDateTime(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatCacheCell(
  record: Pick<UsageRecord, 'cacheReported' | 'cacheHitTokens' | 'cacheMissTokens'>,
): string {
  if (!record.cacheReported) {
    return CACHE_UNKNOWN_TEXT;
  }
  return `命中 ${formatTokens(record.cacheHitTokens)} / 未命中 ${formatTokens(
    record.cacheMissTokens,
  )}`;
}

export function formatCallCost(record: UsageRecord): string {
  return formatCny(roundCny(estimateCallCostCny(record)));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/client/bill-format.test.ts`
Expected: PASS，9 个用例全绿。

- [ ] **Step 5: 写 `components/BillPanel.tsx`**

```tsx
'use client';

import type { Bill } from '@/lib/billing/estimate';
import {
  USAGE_PHASE_LABELS,
  formatCacheCell,
  formatCallCost,
  formatClock,
  formatCny,
  formatTokens,
} from '@/lib/client/bill-format';
import { seatName } from '@/lib/client/format';
import { PROVIDER_LABELS } from '@/lib/llm/providers';
import type { PublicSeat } from '@/lib/game/types';

export interface BillPanelProps {
  bill: Bill;
  /** 有牌桌时传座位表好显示名字；历史回看传 [] 会退化成「座位 N」。 */
  seats: PublicSeat[];
  title?: string;
}

export function BillPanel({ bill, seats, title = '本局账单' }: BillPanelProps) {
  return (
    <section className="panel bill">
      <div className="bill-header">
        <h2 className="section-title">
          {title}
          <span className="bill-badge">估算</span>
        </h2>
        <p className="muted">
          {PROVIDER_LABELS[bill.provider]} ｜ {bill.model} ｜ 共 {bill.totals.calls} 次调用
        </p>
      </div>

      <dl className="bill-totals">
        <div>
          <dt>提示 tokens</dt>
          <dd>{formatTokens(bill.totals.promptTokens)}</dd>
        </div>
        <div>
          <dt>生成 tokens</dt>
          <dd>{formatTokens(bill.totals.completionTokens)}</dd>
        </div>
        <div>
          <dt>合计 tokens</dt>
          <dd>{formatTokens(bill.totals.totalTokens)}</dd>
        </div>
        <div>
          <dt>缓存命中</dt>
          <dd>
            {bill.totals.cacheReportedCalls > 0
              ? formatTokens(bill.totals.cacheHitTokens)
              : '未提供'}
          </dd>
        </div>
        <div>
          <dt>估算费用</dt>
          <dd className="bill-cost">{formatCny(bill.totals.estimatedCostCny)}</dd>
        </div>
      </dl>

      <ul className="bill-notes muted">
        {bill.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      <h3 className="bill-subtitle">按座位</h3>
      <table className="bill-table">
        <thead>
          <tr>
            <th>座位</th>
            <th>调用</th>
            <th>提示</th>
            <th>生成</th>
            <th>缓存命中</th>
            <th>估算费用</th>
          </tr>
        </thead>
        <tbody>
          {bill.bySeat.map((seat) => (
            <tr key={seat.seatId}>
              <td>{seatName(seats, seat.seatId)}</td>
              <td>{seat.calls}</td>
              <td>{formatTokens(seat.promptTokens)}</td>
              <td>{formatTokens(seat.completionTokens)}</td>
              <td>
                {bill.totals.cacheReportedCalls > 0 ? formatTokens(seat.cacheHitTokens) : '未提供'}
              </td>
              <td>{formatCny(seat.estimatedCostCny)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <details className="bill-calls">
        <summary>展开每次调用明细（{bill.totals.calls} 条）</summary>
        <table className="bill-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>座位</th>
              <th>阶段</th>
              <th>提示</th>
              <th>生成</th>
              <th>合计</th>
              <th>缓存</th>
              <th>估算费用</th>
            </tr>
          </thead>
          <tbody>
            {bill.calls.map((call, index) => (
              <tr key={`${call.at}-${call.seatId}-${index}`}>
                <td>{formatClock(call.at)}</td>
                <td>{seatName(seats, call.seatId)}</td>
                <td>{USAGE_PHASE_LABELS[call.phase]}</td>
                <td>{call.usageReported ? formatTokens(call.promptTokens) : '未提供'}</td>
                <td>{call.usageReported ? formatTokens(call.completionTokens) : '未提供'}</td>
                <td>{call.usageReported ? formatTokens(call.totalTokens) : '未提供'}</td>
                <td>{formatCacheCell(call)}</td>
                <td>{formatCallCost(call)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
```

- [ ] **Step 6: 在 page 里渲染局末账单**

修改 `app/page.tsx`：从 hook 里多解构一个 `bill`，并在牌桌区块之后渲染面板。

```tsx
  const { view, status, errorMessage, bill, start } = useGameStream();
```

```tsx
      {bill ? <BillPanel bill={bill} seats={view?.seats ?? []} /> : null}
```

（插在 `{view ? (...) : (...)}` 这段三元表达式之后、`</main>` 之前。）顶部补 import：

```tsx
import { BillPanel } from '@/components/BillPanel';
```

- [ ] **Step 7: 追加账单样式**

在 `app/globals.css` 末尾追加：

```css
.bill-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.bill-badge {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(255, 196, 0, 0.18);
  color: #ffc400;
}

.bill-totals {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 12px 0;
}

.bill-totals dt {
  font-size: 12px;
  opacity: 0.7;
}

.bill-totals dd {
  margin: 2px 0 0;
  font-size: 18px;
}

.bill-cost {
  color: #ffc400;
}

.bill-notes {
  margin: 8px 0;
  padding-left: 18px;
  font-size: 12px;
}

.bill-subtitle {
  margin: 12px 0 6px;
  font-size: 14px;
}

.bill-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.bill-table th,
.bill-table td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  white-space: nowrap;
}

.bill-calls {
  margin-top: 12px;
  overflow-x: auto;
}

.bill-calls summary {
  cursor: pointer;
  font-size: 13px;
}
```

- [ ] **Step 8: 跑全量测试、类型检查与构建**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS，`Compiled successfully`。

- [ ] **Step 9: 提交**

```bash
git add lib/client/bill-format.ts components/BillPanel.tsx app/page.tsx app/globals.css tests/client/bill-format.test.ts
git commit -m "feat(ui): 局末估算账单面板与调用明细"
```

---

### Task 15: 历史账单列表、文档与整体验收

最后一块：把每局账单写进 localStorage 历史，列表按时间新→旧，可展开完整账单、删单条、清空；再把 README 里还在说「Key 放 .env.local」的地方改掉，跑一遍手工验收。

**Files:**
- Create: `components/BillHistory.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 12 的 `loadHistory` / `saveHistory` / `appendBill` / `removeBill` / `clearHistory` / `BillHistoryEntry`；Task 10 的 `browserStorage`；Task 14 的 `BillPanel` / `formatDateTime` / `formatCny` / `formatTokens`；Task 3 的 `PROVIDER_LABELS`。
- Produces:
  - `interface BillHistoryProps { latestBill: Bill | null }`
  - `function BillHistory(props: BillHistoryProps): JSX.Element`

- [ ] **Step 1: 写 `components/BillHistory.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';

import type { Bill } from '@/lib/billing/estimate';
import {
  appendBill,
  clearHistory,
  loadHistory,
  removeBill,
  saveHistory,
  type BillHistoryEntry,
} from '@/lib/client/bill-history';
import { formatCny, formatDateTime, formatTokens } from '@/lib/client/bill-format';
import { browserStorage } from '@/lib/client/settings-storage';
import { PROVIDER_LABELS } from '@/lib/llm/providers';
import { BillPanel } from '@/components/BillPanel';

export interface BillHistoryProps {
  /** 本局刚收到的账单；收到就写进历史（同一局重复写只留最新一条）。 */
  latestBill: Bill | null;
}

export function BillHistory({ latestBill }: BillHistoryProps) {
  const [entries, setEntries] = useState<BillHistoryEntry[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(loadHistory(browserStorage()));
  }, []);

  useEffect(() => {
    if (!latestBill) {
      return;
    }
    setEntries((previous) => {
      const next = appendBill(previous, latestBill, Date.now());
      setStorageError(saveHistory(next, browserStorage()));
      return next;
    });
  }, [latestBill]);

  function remove(gameId: string) {
    setEntries((previous) => {
      const next = removeBill(previous, gameId);
      setStorageError(saveHistory(next, browserStorage()));
      return next;
    });
  }

  function clearAll() {
    clearHistory(browserStorage());
    setEntries([]);
    setStorageError(null);
  }

  return (
    <section className="panel">
      <div className="god-header">
        <h2 className="section-title">历史账单（本机浏览器，不含 API Key）</h2>
        <button type="button" onClick={clearAll} disabled={entries.length === 0}>
          清空
        </button>
      </div>

      {storageError ? <p className="danger">{storageError}</p> : null}

      {entries.length === 0 ? (
        <p className="muted">还没有记录：打完一局后这里会出现该局的估算账单。</p>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => (
            <li key={entry.gameId} className="history-item">
              <div className="history-row">
                <span>{formatDateTime(entry.savedAt)}</span>
                <span>{PROVIDER_LABELS[entry.bill.provider]}</span>
                <span>{entry.bill.model}</span>
                <span>{formatTokens(entry.bill.totals.totalTokens)} tokens</span>
                <span className="bill-cost">{formatCny(entry.bill.totals.estimatedCostCny)}</span>
                <button type="button" onClick={() => remove(entry.gameId)}>
                  删除
                </button>
              </div>
              <details>
                <summary>查看完整账单</summary>
                <BillPanel bill={entry.bill} seats={[]} title={`对局 ${entry.gameId}`} />
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 在 page 里挂上历史**

修改 `app/page.tsx`：在 `{bill ? <BillPanel ... /> : null}` 之后、`</main>` 之前加一行，并补 import。

```tsx
import { BillHistory } from '@/components/BillHistory';
```

```tsx
      <BillHistory latestBill={bill} />
```

- [ ] **Step 3: 追加历史列表样式**

在 `app/globals.css` 末尾追加：

```css
.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-item {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 10px 12px;
}

.history-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.history-row button {
  margin-left: auto;
}
```

- [ ] **Step 4: 跑全量测试、类型检查与构建**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS，`Compiled successfully`。

- [ ] **Step 5: 更新 README**

修改 `README.md` 的四处。

第一段简介里「全部由同一个智谱 BigModel 模型 + 四套不同人设驱动」改为：

```markdown
四个 AI 玩家自动进行的「谁是卧底」网页旁观牌桌。3 名平民 + 1 名卧底，经典双词规则，全部由同一个模型（智谱 BigModel 或 DeepSeek，开局时在页面上选）+ 四套不同人设驱动；你在浏览器里看它们发言、投票、决出胜负，局末还能看到这一局的 token 用量与估算账单。
```

「环境要求」与「快速开始」两节改为（注意内层的 `bash` 代码块要原样保留）：

````markdown
## 环境要求

- Node.js >= 20.9
- 一个智谱 BigModel 或 DeepSeek 的 API Key（在页面上填，不用写进 .env）

## 快速开始

```bash
npm install
npm run dev
```

打开 http://localhost:3000 ，在「模型设置」里选供应商、填模型名与 API Key，然后点「开始」。Key 保存在这台浏览器的 localStorage，并随每次开局请求发给本地服务端；服务端只把它放在该局内存里，不写盘、不写日志。
````

删掉原来的 `cp .env.example .env.local` 与 `# 编辑 .env.local，填入 ZHIPU_API_KEY` 两行。

「环境变量」表改为只剩上帝视角开关：

```markdown
## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `ENABLE_GOD_VIEW` | 否 | 未设置（等价于关闭） | 设为 `true` 才开放 `GET /api/games/<gameId>/reveal`，页面上的「上帝视角」才能拿到身份与私有词 |

API Key **不**通过环境变量配置：它只随 `POST /api/games` 的请求体进入该局 session 内存。
```

「架构」代码块里的两行改为：

```
lib/llm/                          供应商客户端（OpenAI 兼容核心 + 智谱 / DeepSeek）与用量解析
lib/billing/                      用量流水账、价目表、账单估算与 bill 事件发射
lib/client/                       事件归约、格式化、SSE hook、设置与账单历史存储
```

SSE 事件那一句改为：

```markdown
SSE 事件：`snapshot`（连接时的公开快照）、`phase`、`speech`、`vote`、`result`、`bill`、`error`。`bill` 排在终局事件之前推送，带这一局每次模型调用的 token 与缓存明细；默认视图**不包含**任何人的身份与私有词，也**不包含** API Key。
```

「容错」小节的最后一条改为：

```markdown
- 配置不合法（缺 Key、未知 provider、model 超长）：`POST /api/games` 返回 400 与可读错误，错误里不会回显 Key。
- localStorage 写入失败（隐私模式等）：页面给出提示，不影响本局进行。
```

并在「v1 不包含」一节前追加一节：

```markdown
## 计费说明

账单是**本地估算**：单价表内置在 `lib/billing/prices.ts`（单位 CNY / 1K tokens），未知模型按该供应商默认档估算，缓存命中的 token 按 prompt 单价计入、没有做缓存折扣。实际费用以供应商官方账单为准。供应商没有返回 usage 或缓存字段时，对应数值记 0 并在账单里注明。
```

- [ ] **Step 6: 手工验收 — 400 分支**

Run: `npm run dev`，浏览器打开 http://localhost:3000 ，清空 API Key 后点「开始」。
Expected: 页面出现红色提示「请先填写 API Key 再开局」，没有发出请求，按钮没有卡在「进行中…」。

- [ ] **Step 7: 手工验收 — DeepSeek 真跑一局**

在页面上选 DeepSeek、模型填 `deepseek-chat`、填入真实 Key，点「开始」。
Expected:
1. 牌桌正常推进到终局。
2. 终局后出现「本局账单」，标题旁有「估算」角标，总览里有提示 / 生成 / 合计 tokens、缓存命中与估算费用。
3. 展开「展开每次调用明细」，每行有时间、座位、阶段、tokens、缓存「命中 X / 未命中 Y」。
4. 「历史账单」里出现这一局，时间、供应商、模型、总 token、估算费用齐全。
5. 刷新页面，API Key 仍在输入框里（localStorage 生效），历史账单还在。
6. 打开 DevTools → Application → Local Storage，`agent-undercover:bill-history` 的内容里搜不到 Key。

- [ ] **Step 8: 手工验收 — 智谱一局（缓存字段可能缺失）**

切换到智谱、模型填 `glm-4-flash`、填入真实 Key，再打一局。
Expected: 账单照常出现；若智谱没有返回缓存字段，缓存列显示「未提供」，账单说明里出现「本局供应商没有返回缓存字段，缓存命中一律显示「未提供」。」。

- [ ] **Step 9: 收尾检查**

Run: `npm test && npm run typecheck && npm run build && grep -rn "ZHIPU_API_KEY" lib app components tests`
Expected: 前三条全 PASS，`grep` 无输出。

- [ ] **Step 10: 提交**

```bash
git add components/BillHistory.tsx app/page.tsx app/globals.css README.md
git commit -m "feat(ui): 历史账单列表并更新文档"
```

---

## Self-Review

### 1. Spec coverage

| 设计文档条目 | 落在哪个 Task |
|------|------|
| §1.1 网页配置供应商 / 模型 / Key，localStorage 记住 | Task 3（`PROVIDERS` / `DEFAULT_MODELS`）、Task 10（`settings-storage`）、Task 13（`SettingsForm` + page 接线） |
| §1.2 每个 agent、每次调用的 token 明细，含缓存命中 | Task 1（`parseUsage`）、Task 4（`UsageLedger`）、Task 7（`PlayerAgent` 上报 seatId/phase） |
| §1.3 每局估算账单，局末展示，历史存浏览器 | Task 6（`buildBill`）、Task 8（`bill` 事件）、Task 14（`BillPanel`）、Task 12 + 15（历史） |
| §2 非目标（不持久化、不登录、不改价、不混用供应商、不做 E2E） | Global Constraints 明文禁止；`Bill` 无价格入参、`startGame` 一局一个客户端 |
| §3 `createLlmClient(provider, apiKey, model)` | Task 3 `createLlmClient(config, options?)` |
| §3 `UsageLedger` 挂在 game session | Task 9：`startGame` 为每局建一个 `UsageLedger`，通过 `onUsage` 与 `createBillEmitter` 闭包持有 |
| §3 `lib/billing/prices.ts` | Task 5 |
| §3 `lib/billing/estimate.ts` 生成 `Bill` | Task 6 |
| §3 前端设置 + 账单/历史 UI | Task 13 / 14 / 15 |
| §3 Key 仅随 POST 进 session 内存、不写盘、日志不打明文 | Task 9（`startGame` 删掉 env 入口，Key 只进闭包）、Task 3（错误文案不回显 Key）、Task 9 测试断言事件流里搜不到 Key |
| §4.1 请求体带三项；缺 Key / 未知 provider → 400 | Task 3（`parseLlmConfig`）、Task 9（路由 400 分支 + 6 条用例） |
| §4.2 `UsageRecord` 字段（seatId/phase/provider/model/at + 三个 token + 缓存三件套） | Task 4 的 `UsageRecord` 类型；Task 7 负责填 seatId/phase |
| §4.2 DeepSeek 映射官方 cache hit/miss；智谱有则映射无则 `cacheReported: false` | Task 1 `parseUsage` 两种字段形态 + 4 条用例；Task 2 DeepSeek 用例 |
| §4.2 整段 usage 缺失 → 0 + 账单注明 | Task 1（`usageReported: false`）、Task 6（`usageMissingCalls` 与 notes 文案） |
| §4.3 `bill` 事件在终局事件之前推送 | Task 8 `createBillEmitter`（含「只发一次」用例）、Task 9 SSE 顺序用例 |
| §4.3 `calls[]` / `bySeat` / `totals` + 估算费用 + 固定「估算」文案 | Task 6 的 `Bill` 结构与 `BILL_ESTIMATE_NOTE` |
| §4.3 前端写历史且不含 API Key | Task 12（`bill-history` + 「不含 API Key」用例）、Task 15（`BillHistory`） |
| §5.1 开局面板：下拉 / 文本框 / password / 可清除 / 开始前校验非空 | Task 13 + Task 10 的 `validateSettings`（Task 11 在发请求前调用） |
| §5.2 牌桌不变 | Task 13 的 page 保留原有牌桌区块原样 |
| §5.3 局末账单三层（总览 / 按座位 / 展开每次调用） | Task 14 |
| §5.4 历史列表：新→旧、点开完整账单、删单条 / 清空 | Task 15 |
| §6 内置价目表、未知 model 走默认档、一律标估算 | Task 5 + Task 6 的 notes |
| §7 429/5xx 沿用退避；错误不含 Key；localStorage 写失败提示 | Task 2（退避逻辑原样搬进核心并有用例）、Task 3/9（文案不回显 Key）、Task 10/12（`STORAGE_WRITE_ERROR` / `HISTORY_WRITE_ERROR`）、Task 13/15（界面提示） |
| §8 测试范围（估价、ledger 汇总、cache 映射、createGame 校验；不测外网、不做 E2E） | Task 1/4/5/6/9 的单测；全部 LLM 走 mock，Task 9 用 `vi.mock` 保证 201 分支也不发真实请求 |
| §9 成功标准 1~4 | Task 15 Step 6~9 的手工验收 + `npm test` / `typecheck` / `build` |
| §10 文件草图 | 见 File Structure |

**有意的偏差（都不影响验收标准）：**

1. 草图里 `lib/llm/types.ts` 承担 usage 解析，本计划把解析拆到 `lib/llm/usage.ts`，types.ts 只留类型——解析是有分支的逻辑，需要独立单测。
2. 新增 `lib/llm/openai-compatible.ts`：智谱与 DeepSeek 的请求 / 重试 / 超时完全相同，草图里两个客户端并列会导致整段复制（违反 DRY）。
3. 新增 `lib/llm/providers.ts`：供应商常量要被服务端（`create-client`）与浏览器（`settings-storage` / `SettingsForm`）同时引用，单独放一个无逻辑模块最省事。
4. 新增 `lib/billing/bill-emitter.ts`：草图没写「bill 怎么插进事件流」；SSE 一见终局事件就关流，必须有个地方保证 bill 抢在前面，这个地方不适合塞进 Judge。
5. 新增 `lib/client/bill-format.ts`：把展示逻辑从组件里抠出来，才能在没有 DOM 的 vitest 里测。
6. §5.2 的「可选：本局累计 tokens 小条」**不做**——它在设计文档里就标了「可选」，且 `bill` 事件只在局末到达，设计文档给的退路正是「否则局末刷新」。
7. `UsageLedger` 没有挂成 `GameSession` 的字段，而是由 `startGame` 的闭包持有（agent 侧拿 `sink()`，发射器侧拿 `records()`）。这样 `lib/game/session.ts` 不必反向依赖 `lib/billing`，语义上仍是「一局一个」。

### 2. Placeholder scan

逐条对照「No Placeholders」清单复查：

- 没有 `TBD` / `TODO` / 「后续补充」/「填入细节」。
- 没有「加上错误处理」这类空话：每处容错都写了具体文案常量（`BILL_ESTIMATE_NOTE`、`STORAGE_WRITE_ERROR`、`HISTORY_WRITE_ERROR`、`InvalidLlmConfigError` 的四条消息、`CACHE_UNKNOWN_TEXT`）与具体分支代码。
- 没有「写测试」而不给测试代码：15 个 Task 里凡有测试步骤的，都贴了完整可运行的 `describe/it`。
- 没有「类似 Task N」：`fakeLlm` 在 Task 1 与 Task 9 各出现一次，两处都贴了完整代码；`memoryStorage` 在 Task 10 与 Task 12 各贴了一份完整实现。
- 每个改代码的步骤都给了代码块；每个验证步骤都给了确切命令与期望输出。
- 没有引用任何未定义的类型 / 函数：跨 Task 的符号都在某个 Task 的 **Produces** 里定义过（`UsageRecordInput`、`UsageSink`、`Bill`、`LlmSettings`、`SettingsStorage`、`BillHistoryEntry` 等）。

### 3. Type consistency

跨 Task 核对过的符号（写法完全一致）：

- `LlmUsage` 的 7 个字段名（`promptTokens` / `completionTokens` / `totalTokens` / `cacheHitTokens` / `cacheMissTokens` / `usageReported` / `cacheReported`）在 Task 1 定义，Task 4 靠 `...input.usage` 原样摊进 `UsageRecord`，Task 6 汇总、Task 14 展示时用的都是这套名字。
- `UsageRecordInput` 的形状（`{ seatId, phase, provider, model, usage }`）：Task 4 定义 → Task 7 `onUsage` 调用 → Task 8 测试里 `ledger.append` → Task 9 `ledger.sink()`。
- `UsagePhase` 只有 `'speak' | 'vote'`：Task 4 定义，Task 7 传入，Task 14 的 `USAGE_PHASE_LABELS` 恰好覆盖这两个键（`Record<UsagePhase, string>` 会强制这一点）。
- `createBillEmitter` 的 `BillEmitterDeps`（`gameId` / `provider` / `model` / `ledger` / `now` / `emit`）：Task 8 定义，Task 9 `startGame` 按同名同序传入。
- `buildBill` 的入参 `BuildBillInput`（`gameId` / `provider` / `model` / `finishedAt` / `records`）：Task 6 定义，Task 8 发射器、Task 8 apply-event 测试、Task 12 历史测试三处调用写法一致。
- `Bill` 的字段在 Task 6 定义后，被 Task 8（`GameEvent`）、Task 12（`BillHistoryEntry.bill`）、Task 14（`BillPanel`）、Task 15（`BillHistory` 列表列）引用，没有出现 `estimatedCost` / `costCny` 之类的变体——全程是 `estimatedCostCny`。
- `LlmConfig`（`provider` / `model` / `apiKey`）：Task 3 定义 → Task 9 `StartGameOptions.llmConfig` 与路由 → Task 9 测试断言的键名一致；前端的 `LlmSettings` 字段名与之刻意相同，`buildStartRequestBody` 返回的就是这三个键。
- `SettingsStorage`（`getItem` / `setItem` / `removeItem`）在 Task 10 定义，Task 12 直接 `import type` 复用，没有第二份定义。
- `LlmClient` 新增的 `provider` / `model` 是只读属性：Task 1 定义 → Task 2 两个客户端返回对象里都带 → Task 7 读 `this.deps.llm.provider` → Task 9 读 `llm.provider` 建发射器；所有假模型（Task 1 的三处、Task 9 的两处）都补了这两个字段。
- `lib/game/types.ts` 对 `Bill` 用的是 `import type`，编译后被擦除，不会在 `lib/game` 与 `lib/billing` 之间引入运行时循环依赖（`lib/billing/estimate.ts` 也从不反向引用 `lib/game`）。

---

## Execution Handoff

Plan complete and saved to `/workspace/billing-plan/2026-09-19-deepseek-token-billing.md`（仓库内的落点是 `docs/superpowers/plans/2026-09-19-deepseek-token-billing.md`）。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个 Task 派一个全新 subagent，Task 之间做两段式 review，迭代快。REQUIRED SUB-SKILL：`superpowers:subagent-driven-development`。
2. **Inline Execution** — 在当前会话里按批次执行并设检查点。REQUIRED SUB-SKILL：`superpowers:executing-plans`。

选哪种？
