# 实时 Token 审计 + cloudflared 远程测试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对局进行中经 SSE 推送每次成功 LLM 调用的真实 token（`usage` 事件 + `UsagePanel`），局末 `bill` 对 DeepSeek / OpenRouter 恒不显示金额（智谱仍估算），并提供 `dev:tunnel` quick tunnel 与 README 命名隧道可选说明。

**Architecture:** 沿用现有 `UsageLedger` + session 事件缓冲 + 水位线 SSE。`UsageLedger.append` 生成 `callId`；`createUsageSink` 在 append 成功后立刻 `publish` 一条 `usage` 事件（失败调用不记不发）。浏览器 `PublicGameView.usageLog` 由 `applyEvent` 追加并用 `callId` 去重；SSE 快照像账单一样从水位线之前的事件里捞出 `usageLog`，避免刷新丢审计条。`PRICE_TABLE` 只保留智谱；DeepSeek 与 OpenRouter 的 `estimatedCostCny` 恒为 `null`，BillPanel / BillHistory 隐藏「¥」列。`scripts/dev-tunnel.sh` 起本地 Next + cloudflared quick tunnel。

**Tech Stack:** Next.js 15（App Router）、React 19、TypeScript 5.9（strict）、Vitest 3（node）、原生 SSE、bash + 宿主机 `cloudflared`（不进 npm 依赖）。无新增运行时 npm 依赖。

## Global Constraints

本节是全局约束，每个 Task 的要求都隐含包含它们。

- **usage 只跟成功 append**：失败 / 超时 / 校验重试中的失败不记 ledger、不发 `usage`，与现有 `PlayerAgent` 上报语义一致。
- **无金额供应商**：`deepseek` 与 `openrouter` 的 `estimatedCostCny`（总计与按座位）恒为 `null`；本迭代起 DeepSeek 退出价目表与估价路径。智谱仍按 `prices.ts` 估算，`Bill.estimated` 恒为 `true`。
- **Key 永不进事件**：`usage` / `bill` / 快照 / 历史均不得含 API Key；错误文案不得回显 Key。
- **重连**：`usage` 进同一 `session.events`；快照补齐水位线前的 `usageLog`；客户端用 `callId` 去重。
- **隧道凭证不入库**：不把 tunnel URL、Cloudflare 账号、证书写入仓库；不强依赖 CI 安装 / 真跑 cloudflared。
- **本迭代非目标**（不要顺手做）：DeepSeek 余额 / 账单 API、改智谱单价公式、为 OpenRouter 编造费用、WebSocket、浏览器 E2E、CI 装 cloudflared。
- **测试纪律**：LLM 一律 mock；`npm test` 不发真实外网请求；React 组件不写单测，靠 `typecheck` + `build` + 手工验收。
- **Node.js >= 20.9**；包管理 npm；不新增运行时依赖。
- **语言**：注释与用户可见文案中文，标识符与代码英文。
- **每个 Task 的收尾**：`npm test` 与 `npm run typecheck` 必须全绿后才提交。

---

## File Structure

### 新建

| 文件 | 职责 |
|------|------|
| `lib/billing/usage-emitter.ts` | `createUsageSink({ ledger, emit })`：append 后发 `usage` 事件 |
| `components/UsagePanel.tsx` | 中局实时 token 列表（座位 · 阶段 · prompt/completion · cache） |
| `scripts/dev-tunnel.sh` | 检查 cloudflared、起/复用 Next:3000、跑 quick tunnel |
| `tests/billing/usage-emitter.test.ts` | usage 事件形状与只在 append 后发出 |
| `tests/scripts/dev-tunnel.test.ts` | 脚本存在；PATH 无 cloudflared 时非零退出 + 可读错误 |

### 修改

| 文件 | 改动 |
|------|------|
| `lib/billing/ledger.ts` | `UsageRecord` / append 增加 `callId`；可注入 `idFactory` |
| `lib/billing/prices.ts` | `PricedProvider` 仅 `zhipu`；删除 deepseek 价目 |
| `lib/billing/estimate.ts` | 随 `isPricedProvider` 自动让 deepseek 费用为 null；notes 走 `COST_UNAVAILABLE_NOTE` |
| `lib/game/types.ts` | `GameEvent` 增加 `usage`；`PublicGameView` 增加 `usageLog` |
| `lib/game/state.ts` | `toPublicView` 补 `usageLog: []` |
| `lib/game/bootstrap.ts` | 用 `createUsageSink` 替代裸 `ledger.sink()` |
| `app/api/games/[gameId]/events/route.ts` | 快照注入水位线前的 `usageLog`（对称于 `billBefore`） |
| `lib/client/apply-event.ts` | `usage` 分支：按 `callId` 去重追加 |
| `lib/client/use-game-stream.ts` | `EVENT_NAMES` 加入 `usage` |
| `components/BillPanel.tsx` | `estimatedCostCny === null` 时隐藏金额列与合计「¥」 |
| `components/BillHistory.tsx` | 历史行在无金额时不渲染「¥」 |
| `app/page.tsx` | 挂载 `UsagePanel`（消耗区，靠近 BillPanel） |
| `app/globals.css` | UsagePanel 样式 |
| `package.json` | `"dev:tunnel": "bash scripts/dev-tunnel.sh"` |
| `README.md` | SSE `usage`、脚本表、`dev:tunnel`、命名隧道可选节 |
| `tests/billing/ledger.test.ts` | callId 生成与注入 |
| `tests/billing/prices.test.ts` | 仅 zhipu 有价；deepseek 非 priced |
| `tests/billing/estimate.test.ts` | deepseek/openrouter → null；智谱仍估价（fixture 改 zhipu） |
| `tests/billing/bill-emitter.test.ts` | deepseek 账单费用 null；仍先于终局 |
| `tests/client/apply-event.test.ts` | usage 追加 + callId 去重；BASE 补 `usageLog: []` |
| `tests/game/state.test.ts` | 公开视图含 `usageLog: []` |
| `tests/game/bootstrap.test.ts` / `tests/api/routes.test.ts` | 如有视图基线则补 `usageLog`；可选断言 session 中出现 usage |

### 不动

`lib/game/judge.ts`、`lib/game/rules.ts`、`lib/game/word-bank.ts`、`lib/agents/prompt.ts`、`lib/agents/personas.ts`、`lib/llm/*`（本迭代不改模型客户端）、`app/api/games/route.ts`、`app/api/games/[gameId]/reveal/route.ts`、`components/SeatCard.tsx` / `Timeline.tsx` / `VoteBar.tsx` / `TopBar.tsx` / `GodPanel.tsx`、`components/SettingsForm.tsx`。Judge 仍只认注入的 `emit`；usage 在 agent → sink → publish 路径上，不改判定逻辑。

---

## Task 依赖顺序

```
Task 1  (UsageLedger.callId)
  ├─ Task 2 (GameEvent usage + PublicGameView.usageLog + toPublicView)
  │    ├─ Task 3 (createUsageSink + bootstrap 接线)
  │    │    └─ Task 6 (SSE 快照 usageLog + use-game-stream)
  │    └─ Task 5 (apply-event 去重)
  ├─ Task 4 (DeepSeek 退出价目表 + estimate/bill-emitter 测试)
  │    └─ Task 8 (BillPanel / BillHistory 隐藏 ¥)
  └─ Task 7 (UsagePanel + page) ── needs Task 5, 6
Task 9  (dev-tunnel.sh + npm script + 脚本测试)  ── 独立
Task 10 (README) ── needs Task 6–9 语义稳定
```

---

### Task 1: UsageLedger 生成 callId

给每条流水账加上稳定的 `callId`，供 SSE 回放去重与局末明细对齐。

**Files:**
- Modify: `lib/billing/ledger.ts`
- Modify: `tests/billing/ledger.test.ts`
- Modify: `tests/billing/estimate.test.ts`（`record()` helper 补 `callId`）
- Modify: 其它构造 `UsageRecord` 字面量的测试（按 `tsc` 报错清单补字段）

**Interfaces:**
- Consumes: 现有 `UsageRecordInput` / `LlmUsage`。
- Produces:
  - `UsageRecord` 增加 `callId: string`
  - `constructor(now?: () => number, idFactory?: () => string)`（默认 `Date.now` + `randomUUID`）
  - `append(input): UsageRecord` 返回值含 `callId`

- [ ] **Step 1: 写失败测试**

在 `tests/billing/ledger.test.ts` 增加：

```ts
it('append 为每条记录生成唯一 callId', () => {
  let n = 0;
  const ledger = new UsageLedger(
    () => 0,
    () => `call-${++n}`,
  );
  const a = ledger.append(input(0));
  const b = ledger.append(input(1));
  expect(a.callId).toBe('call-1');
  expect(b.callId).toBe('call-2');
  expect(ledger.records().map((r) => r.callId)).toEqual(['call-1', 'call-2']);
});

it('默认 idFactory 每次都不同（非空字符串）', () => {
  const ledger = new UsageLedger(() => 0);
  const a = ledger.append(input(0));
  const b = ledger.append(input(1));
  expect(a.callId.length).toBeGreaterThan(0);
  expect(b.callId.length).toBeGreaterThan(0);
  expect(a.callId).not.toBe(b.callId);
});
```

同步把 `estimate.test.ts` 的 `record()` 加上 `callId: 'c-1'`（或 `overrides` 可覆盖），否则后续类型检查会红。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/billing/ledger.test.ts`
Expected: FAIL（`callId` 不存在 / 期望不匹配）

- [ ] **Step 3: 最小实现**

`lib/billing/ledger.ts`：

```ts
import { randomUUID } from 'node:crypto';

import type { LlmProvider, LlmUsage } from '@/lib/llm/types';

export type UsagePhase = 'speak' | 'vote';

export interface UsageRecordInput {
  seatId: number;
  phase: UsagePhase;
  provider: LlmProvider;
  model: string;
  usage: LlmUsage;
}

export interface UsageRecord {
  callId: string;
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

export class UsageLedger {
  private readonly entries: UsageRecord[] = [];

  constructor(
    private readonly now: () => number = Date.now,
    private readonly idFactory: () => string = randomUUID,
  ) {}

  append(input: UsageRecordInput): UsageRecord {
    const record: UsageRecord = {
      callId: this.idFactory(),
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

  sink(): UsageSink {
    return (input) => {
      this.append(input);
    };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test && npm run typecheck`
Expected: PASS（若有其它测试缺 `callId` 字段，一并补上再绿）

- [ ] **Step 5: Commit**

```bash
git add lib/billing/ledger.ts tests/billing/ledger.test.ts tests/billing/estimate.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): give each usage record a callId

EOF
)"
```

---

### Task 2: GameEvent `usage` 与 PublicGameView.usageLog

把中局用量事件与公开视图列表类型立住，快照基线为空数组。

**Files:**
- Modify: `lib/game/types.ts`
- Modify: `lib/game/state.ts`（`toPublicView`）
- Modify: `tests/game/state.test.ts`
- Modify: `tests/client/apply-event.test.ts`（`BASE.usageLog = []`）
- Modify: 其它构造 `PublicGameView` 的测试基线

**Interfaces:**
- Consumes: `LlmProvider`、`UsagePhase`（从 ledger 导入 phase 类型，或在 types 里复用）。
- Produces:
  - `export type UsageEvent = { type: 'usage'; callId: string; seatId: number; phase: 'speak' | 'vote'; provider: LlmProvider; model: string; promptTokens: number; completionTokens: number; cacheHitTokens: number; cacheMissTokens: number; cacheReported: boolean }`
  - `GameEvent` 联合增加 `UsageEvent`
  - `PublicGameView.usageLog: UsageEvent[]`（存完整 usage 事件对象，便于 UsagePanel 直接渲染）

- [ ] **Step 1: 写失败测试**

`tests/game/state.test.ts`：

```ts
it('公开视图带空的 usageLog，且不含身份与 Key', () => {
  const view = toPublicView(newGame());
  expect(view.usageLog).toEqual([]);
  expect(JSON.stringify(view)).not.toContain('apiKey');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/game/state.test.ts`
Expected: FAIL（`usageLog` undefined）

- [ ] **Step 3: 最小实现**

在 `lib/game/types.ts` 增加（注意从 `@/lib/llm/types` 引入 `LlmProvider`，从 ledger 引入 `UsagePhase` 或内联 `'speak' | 'vote'`）：

```ts
export type UsageEvent = {
  type: 'usage';
  callId: string;
  seatId: number;
  phase: 'speak' | 'vote';
  provider: import('@/lib/llm/types').LlmProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheReported: boolean;
};
```

更清晰的写法：文件顶部 `import type { LlmProvider } from '@/lib/llm/types'`，然后：

```ts
export type UsageEvent = {
  type: 'usage';
  callId: string;
  seatId: number;
  phase: 'speak' | 'vote';
  provider: LlmProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheReported: boolean;
};

export type GameEvent =
  | { type: 'phase'; ... }
  // ...现有分支...
  | UsageEvent
  | { type: 'bill'; bill: Bill }
  | { type: 'error'; message: string };

export interface PublicGameView {
  // ...现有字段...
  bill: Bill | null;
  /** 中局累计的 usage 事件；快照基线为空，SSE 路由会按水位线补齐。 */
  usageLog: UsageEvent[];
}
```

`toPublicView`：

```ts
return {
  // ...
  bill: null,
  usageLog: [],
};
```

所有测试里的 `PublicGameView` 字面量补 `usageLog: []`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/types.ts lib/game/state.ts tests/game/state.test.ts tests/client/apply-event.test.ts
git commit -m "$(cat <<'EOF'
feat(game): add usage SSE event type and usageLog on public view

EOF
)"
```

---

### Task 3: createUsageSink — append 后发 usage

**Files:**
- Create: `lib/billing/usage-emitter.ts`
- Create: `tests/billing/usage-emitter.test.ts`
- Modify: `lib/game/bootstrap.ts`
- Modify: `tests/game/bootstrap.test.ts`（若断言事件序列，补 usage）

**Interfaces:**
- Consumes: `UsageLedger.append`、`UsageRecordInput`、`GameEvent` / `UsageEvent`、`publish` 风格的 `emit`。
- Produces:
  - `createUsageSink(deps: { ledger: UsageLedger; emit: (event: GameEvent) => void }): UsageSink`
  - 行为：`const record = ledger.append(input); emit({ type: 'usage', callId: record.callId, seatId, phase, provider, model, promptTokens, completionTokens, cacheHitTokens, cacheMissTokens, cacheReported });`

- [ ] **Step 1: 写失败测试**

`tests/billing/usage-emitter.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { UsageLedger } from '@/lib/billing/ledger';
import { createUsageSink } from '@/lib/billing/usage-emitter';
import type { GameEvent } from '@/lib/game/types';

describe('createUsageSink', () => {
  it('append 成功后立刻发出形状正确的 usage 事件', () => {
    const events: GameEvent[] = [];
    const ledger = new UsageLedger(
      () => 100,
      () => 'cid-1',
    );
    const onUsage = createUsageSink({
      ledger,
      emit: (event) => events.push(event),
    });

    onUsage({
      seatId: 2,
      phase: 'vote',
      provider: 'deepseek',
      model: 'deepseek-chat',
      usage: {
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cacheHitTokens: 64,
        cacheMissTokens: 56,
        usageReported: true,
        cacheReported: true,
      },
    });

    expect(ledger.size).toBe(1);
    expect(events).toEqual([
      {
        type: 'usage',
        callId: 'cid-1',
        seatId: 2,
        phase: 'vote',
        provider: 'deepseek',
        model: 'deepseek-chat',
        promptTokens: 120,
        completionTokens: 30,
        cacheHitTokens: 64,
        cacheMissTokens: 56,
        cacheReported: true,
      },
    ]);
  });

  it('usage 事件不含 totalTokens / 费用 / apiKey', () => {
    const events: GameEvent[] = [];
    const ledger = new UsageLedger(() => 0, () => 'cid-2');
    createUsageSink({ ledger, emit: (e) => events.push(e) })({
      seatId: 0,
      phase: 'speak',
      provider: 'zhipu',
      model: 'glm-4-flash',
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        usageReported: true,
        cacheReported: false,
      },
    });
    const raw = JSON.stringify(events[0]);
    expect(raw).not.toContain('totalTokens');
    expect(raw).not.toContain('estimatedCost');
    expect(raw).not.toContain('apiKey');
    expect(events[0]).toMatchObject({ cacheReported: false, cacheHitTokens: 0 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/billing/usage-emitter.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 usage-emitter 并接线 bootstrap**

`lib/billing/usage-emitter.ts`：

```ts
import type { UsageLedger, UsageSink } from '@/lib/billing/ledger';
import type { GameEvent } from '@/lib/game/types';

export interface UsageEmitterDeps {
  ledger: UsageLedger;
  emit: (event: GameEvent) => void;
}

export function createUsageSink(deps: UsageEmitterDeps): UsageSink {
  return (input) => {
    const record = deps.ledger.append(input);
    deps.emit({
      type: 'usage',
      callId: record.callId,
      seatId: record.seatId,
      phase: record.phase,
      provider: record.provider,
      model: record.model,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      cacheHitTokens: record.cacheHitTokens,
      cacheMissTokens: record.cacheMissTokens,
      cacheReported: record.cacheReported,
    });
  };
}
```

`lib/game/bootstrap.ts` 关键：

```ts
import { createUsageSink } from '@/lib/billing/usage-emitter';

// ...
const ledger = new UsageLedger(now);
const onUsage = createUsageSink({
  ledger,
  emit: (event) => publish(session, event),
});
// agents 仍用 onUsage；createBillEmitter 仍包住 Judge 的 emit
```

注意：`createBillEmitter` 的 `emit` 仍是 `(event) => publish(session, event)`；usage 与 bill 都进同一缓冲，互不干扰。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/billing/usage-emitter.ts tests/billing/usage-emitter.test.ts lib/game/bootstrap.ts tests/game/bootstrap.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): emit SSE usage event after each successful ledger append

EOF
)"
```

---

### Task 4: DeepSeek 退出价目表；账单费用语义

**Files:**
- Modify: `lib/billing/prices.ts`
- Modify: `tests/billing/prices.test.ts`
- Modify: `tests/billing/estimate.test.ts`
- Modify: `tests/billing/bill-emitter.test.ts`
- Modify: `tests/client/bill-format.test.ts`（若有 deepseek 估价用例）
- Modify: `lib/billing/estimate.ts` 仅当 notes 文案需随供应商调整时（通常 `isPricedProvider` 已足够）

**Interfaces:**
- Consumes: 现有 `buildBill` / `estimateCallCostCny` / `isPricedProvider`。
- Produces:
  - `export type PricedProvider = 'zhipu'`（或 `Exclude<LlmProvider, 'deepseek' | 'openrouter'>`）
  - `PRICE_TABLE` 仅含 `zhipu`
  - `priceFor('deepseek', *) === null`；`buildBill` 对 deepseek/openrouter → `estimatedCostCny === null`；智谱仍可非 null

- [ ] **Step 1: 改写失败测试（先改期望）**

`tests/billing/prices.test.ts` 关键为：

```ts
describe('PRICE_TABLE', () => {
  it('只有智谱有内置价目，且单价非负', () => {
    expect(Object.keys(PRICE_TABLE)).toEqual(['zhipu']);
    const prices = PRICE_TABLE.zhipu;
    expect(prices.fallback.promptPerKTokens).toBeGreaterThanOrEqual(0);
    expect(prices.fallback.completionPerKTokens).toBeGreaterThanOrEqual(0);
    for (const price of Object.values(prices.models)) {
      expect(price.promptPerKTokens).toBeGreaterThanOrEqual(0);
      expect(price.completionPerKTokens).toBeGreaterThanOrEqual(0);
    }
  });

  it('覆盖智谱默认模型 glm-4-flash', () => {
    expect(PRICE_TABLE.zhipu.models['glm-4-flash']).toBeDefined();
  });

  it('不为 DeepSeek / OpenRouter 编造单价', () => {
    expect(JSON.stringify(PRICE_TABLE)).not.toContain('deepseek');
    expect(JSON.stringify(PRICE_TABLE)).not.toContain('openrouter');
  });
});

describe('isPricedProvider', () => {
  it('只有智谱能估价', () => {
    expect(isPricedProvider('zhipu')).toBe(true);
    expect(isPricedProvider('deepseek')).toBe(false);
    expect(isPricedProvider('openrouter')).toBe(false);
  });
});

describe('priceFor', () => {
  it('命中智谱内置模型时返回该模型单价', () => {
    expect(priceFor('zhipu', 'glm-4-air')).toEqual(PRICE_TABLE.zhipu.models['glm-4-air']);
  });

  it('未知智谱模型回落默认档', () => {
    expect(priceFor('zhipu', 'glm-未来版')).toEqual(PRICE_TABLE.zhipu.fallback);
  });

  it('DeepSeek 与 OpenRouter 返回 null', () => {
    expect(priceFor('deepseek', 'deepseek-chat')).toBeNull();
    expect(priceFor('openrouter', 'openai/gpt-4o-mini')).toBeNull();
  });
});
```

`tests/billing/estimate.test.ts`：
- 把原先用 deepseek 验证「有费用」的用例改成 `provider: 'zhipu', model: 'glm-4-air'`（或 airx）并按智谱单价重算期望。
- 新增 / 改写：

```ts
it('DeepSeek 只统计 token：费用恒为 null', () => {
  const bill = buildBill({
    gameId: 'g-1',
    provider: 'deepseek',
    model: 'deepseek-chat',
    finishedAt: 0,
    records: [record({ provider: 'deepseek', model: 'deepseek-chat', seatId: 0 })],
  });
  expect(bill.totals.totalTokens).toBeGreaterThan(0);
  expect(bill.totals.estimatedCostCny).toBeNull();
  expect(bill.bySeat.map((s) => s.estimatedCostCny)).toEqual([null]);
  expect(bill.notes).toContain(COST_UNAVAILABLE_NOTE);
  expect(bill.notes.some((n) => n.includes('默认档单价估算'))).toBe(false);
  expect(bill.notes.some((n) => n.includes('缓存命中的 token 按 prompt 单价'))).toBe(false);
});

it('estimateCallCostCny 对 DeepSeek 返回 null', () => {
  expect(estimateCallCostCny(record({ provider: 'deepseek', model: 'deepseek-chat' }))).toBeNull();
});
```

智谱估价示例（glm-4-air：prompt/completion 均为 0.0005 / 1K）：

```ts
// 1000 prompt + 500 completion → 1*0.0005 + 0.5*0.0005 = 0.00075
expect(
  estimateCallCostCny(
    record({ provider: 'zhipu', model: 'glm-4-air', promptTokens: 1000, completionTokens: 500 }),
  ),
).toBeCloseTo(0.00075, 10);
```

`bill-emitter.test.ts`：保留 deepseek ledger fixture，但断言 `bill.totals.estimatedCostCny === null`，且仍先于终局。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/billing/prices.test.ts tests/billing/estimate.test.ts`
Expected: FAIL（deepseek 仍在表里 / 费用非 null）

- [ ] **Step 3: 改 prices.ts**

```ts
export type PricedProvider = Exclude<LlmProvider, 'deepseek' | 'openrouter'>;

export const PRICE_TABLE: Record<PricedProvider, ProviderPrices> = {
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
};
```

文件头注释改为说明：仅智谱有内置 CNY 单价；DeepSeek / OpenRouter 只记 token。

`estimate.ts` 无需改算法：`isPricedProvider('deepseek')` 变 false 后自动 null，并推 `COST_UNAVAILABLE_NOTE`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/billing/prices.ts tests/billing/prices.test.ts tests/billing/estimate.test.ts tests/billing/bill-emitter.test.ts tests/client/bill-format.test.ts
git commit -m "$(cat <<'EOF'
fix(billing): drop DeepSeek from priced path; cost stays null like OpenRouter

EOF
)"
```

---

### Task 5: apply-event — usage 追加与 callId 去重

**Files:**
- Modify: `lib/client/apply-event.ts`
- Modify: `tests/client/apply-event.test.ts`

**Interfaces:**
- Consumes: `UsageEvent`、`PublicGameView.usageLog`。
- Produces: `applyEvent` 对 `usage`：若 `usageLog` 已有相同 `callId` 则返回原视图（或同内容新对象但列表不变）；否则追加。

- [ ] **Step 1: 写失败测试**

```ts
describe('applyEvent 的 usage 分支', () => {
  const usage = {
    type: 'usage' as const,
    callId: 'cid-9',
    seatId: 1,
    phase: 'speak' as const,
    provider: 'deepseek' as const,
    model: 'deepseek-chat',
    promptTokens: 10,
    completionTokens: 4,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    cacheReported: false,
  };

  it('追加一条 usage 到 usageLog', () => {
    const next = applyEvent(BASE, usage);
    expect(next.usageLog).toEqual([usage]);
    expect(BASE.usageLog).toEqual([]);
  });

  it('相同 callId 不双计', () => {
    const once = applyEvent(BASE, usage);
    const twice = applyEvent(once, usage);
    expect(twice.usageLog).toHaveLength(1);
    expect(twice.usageLog[0].callId).toBe('cid-9');
  });

  it('不同 callId 依次追加', () => {
    const a = applyEvent(BASE, usage);
    const b = applyEvent(a, { ...usage, callId: 'cid-10', seatId: 2 });
    expect(b.usageLog.map((row) => row.callId)).toEqual(['cid-9', 'cid-10']);
  });
});
```

确保 `BASE` 含 `usageLog: []`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/client/apply-event.test.ts`
Expected: FAIL（switch 未穷尽 / 无 usage 分支）

- [ ] **Step 3: 实现**

```ts
case 'usage': {
  if (view.usageLog.some((row) => row.callId === event.callId)) {
    return view;
  }
  return { ...view, usageLog: [...view.usageLog, event] };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/client/apply-event.ts tests/client/apply-event.test.ts
git commit -m "$(cat <<'EOF'
feat(client): reduce usage SSE events into usageLog with callId dedupe

EOF
)"
```

---

### Task 6: SSE 快照补齐 usageLog + hook 订阅

重连时水位线之后的事件才会推送；水位线之前的 `usage` 必须像 `bill` 一样打进 snapshot。

**Files:**
- Modify: `app/api/games/[gameId]/events/route.ts`
- Modify: `lib/client/use-game-stream.ts`
- Modify: `tests/api/routes.test.ts`（增加：缓冲里有 usage 时快照带上；或独立抽纯函数测）

**Interfaces:**
- Consumes: `session.events`、`UsageEvent`。
- Produces:
  - `usageBefore(session, watermark): UsageEvent[]` — `session.events.slice(0, watermark).filter(e => e.type === 'usage')`
  - `snapshot.usageLog = usageBefore(...)`
  - `EVENT_NAMES` 含 `'usage'`

- [ ] **Step 1: 写失败测试**

优先把 `usageBefore` 做成 route 同文件导出的纯函数，或放到 `lib/game/session.ts` / 小模块以便测。推荐在 `lib/game/session.ts` 增加：

```ts
export function usageEventsBefore(session: GameSession, watermark: number): UsageEvent[] {
  return session.events
    .slice(0, Math.max(0, watermark))
    .filter((event): event is UsageEvent => event.type === 'usage');
}
```

测试 `tests/game/session.test.ts`：

```ts
it('usageEventsBefore 只取水位线之前的 usage，保持顺序', () => {
  const session = createSession(/* minimal state */);
  // 往 session.events 推进 phase / usage / speech / usage
  const rows = usageEventsBefore(session, session.events.length);
  expect(rows.map((r) => r.callId)).toEqual(['a', 'b']);
  expect(usageEventsBefore(session, 2).map((r) => r.callId)).toEqual(['a']);
});
```

（按现有 `session.test.ts` 风格构造 session。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/game/session.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现并接线**

`route.ts`：

```ts
import { usageEventsBefore, ... } from '@/lib/game/session';

const snapshot: PublicGameView = toPublicView(session.state);
const watermark = session.events.length;
snapshot.bill = session.finished ? session.lastBill ?? null : billBefore(session, watermark);
snapshot.usageLog = usageEventsBefore(session, watermark);
```

`use-game-stream.ts`：

```ts
const EVENT_NAMES = ['phase', 'speech', 'vote', 'result', 'error', 'bill', 'usage'] as const;
```

snapshot 处理器已 `setView(snapshot)`，会带上 `usageLog`；后续 `usage` 经 `applyEvent` 追加并去重。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/session.ts app/api/games/[gameId]/events/route.ts lib/client/use-game-stream.ts tests/game/session.test.ts tests/api/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(sse): include usageLog in snapshot for watermark reconnect

EOF
)"
```

---

### Task 7: UsagePanel UI

**Files:**
- Create: `components/UsagePanel.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `UsageEvent[]`、`PublicSeat[]`、`USAGE_PHASE_LABELS`、`formatTokens`、`formatCacheCell` / `CACHE_UNKNOWN_TEXT`、`seatName`。
- Produces: `UsagePanel({ rows, seats })` 客户端组件。

- [ ] **Step 1: 实现组件（无单测；靠 typecheck）**

`components/UsagePanel.tsx`：

```tsx
'use client';

import { USAGE_PHASE_LABELS, formatTokens, CACHE_UNKNOWN_TEXT } from '@/lib/client/bill-format';
import { seatName } from '@/lib/client/format';
import type { UsageEvent } from '@/lib/game/types';
import type { PublicSeat } from '@/lib/game/types';

export interface UsagePanelProps {
  rows: UsageEvent[];
  seats: PublicSeat[];
}

export function UsagePanel({ rows, seats }: UsagePanelProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="panel usage">
      <h2 className="section-title">实时用量</h2>
      <p className="muted">对局进行中每次成功调用追加一行；局末账单是汇总。</p>
      <table className="bill-table usage-table">
        <thead>
          <tr>
            <th>座位</th>
            <th>阶段</th>
            <th>提示</th>
            <th>生成</th>
            <th>缓存</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.callId}>
              <td>{seatName(seats, row.seatId)}</td>
              <td>{USAGE_PHASE_LABELS[row.phase]}</td>
              <td>{formatTokens(row.promptTokens)}</td>
              <td>{formatTokens(row.completionTokens)}</td>
              <td>
                {row.cacheReported
                  ? `命中 ${formatTokens(row.cacheHitTokens)} / 未命中 ${formatTokens(row.cacheMissTokens)}`
                  : CACHE_UNKNOWN_TEXT}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

`app/page.tsx`：在 `BillPanel` 之前渲染：

```tsx
{view && view.usageLog.length > 0 ? (
  <UsagePanel rows={view.usageLog} seats={view.seats} />
) : null}
{bill ? <BillPanel bill={bill} seats={view?.seats ?? []} /> : null}
```

`globals.css` 增加 `.usage` / `.usage-table` 间距（可复用 `.bill-table`）。

- [ ] **Step 2: typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/UsagePanel.tsx app/page.tsx app/globals.css
git commit -m "$(cat <<'EOF'
feat(ui): add mid-game UsagePanel for live token audit rows

EOF
)"
```

---

### Task 8: BillPanel / BillHistory 隐藏无金额供应商的「¥」

**Files:**
- Modify: `components/BillPanel.tsx`
- Modify: `components/BillHistory.tsx`
- Optional: `lib/client/bill-format.ts` 增加 `export function billShowsCost(bill: Pick<Bill, 'totals'>): boolean { return bill.totals.estimatedCostCny !== null; }`（无强制单测；组件不测）

**Interfaces:**
- Consumes: `Bill.totals.estimatedCostCny`。
- Produces: 当为 `null` 时：不渲染总计「估算费用」格、不渲染按座位/明细的「估算费用」列、历史行不渲染 `formatCost` 的「¥」/「费用暂不可用」span（只留 tokens 等）。智谱保持现状（含「估算」徽章与金额）。

- [ ] **Step 1: 改 BillPanel**

```tsx
const showCost = bill.totals.estimatedCostCny !== null;

// 总计区：showCost 才渲染估算费用 <div>
// 表头/单元格：showCost 才带「估算费用」列
// 徽章：showCost 时显示「估算」；无金额时可改文案为不显示徽章，或显示「仅 token」——按 spec：无金额时只展示 token/cache，故隐藏徽章与 ¥。
```

伪代码结构：

```tsx
<h2>
  {title}
  {showCost ? <span className="bill-badge">估算</span> : null}
</h2>
{/* totals: 四个 token/cache 格 + (showCost && 费用格) */}
{/* bySeat / calls 表：条件列 */}
```

明细行里现有的 `formatCallCost(call)` 在无价供应商下会变成「费用暂不可用」——列已隐藏则不会显示。

- [ ] **Step 2: 改 BillHistory**

```tsx
{entry.bill.totals.estimatedCostCny !== null ? (
  <span className="bill-cost">{formatCost(entry.bill.totals.estimatedCostCny)}</span>
) : null}
```

空状态文案可改为「打完一局后这里会出现该局的用量账单。」（可选，不强制）。

- [ ] **Step 3: typecheck + test**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add components/BillPanel.tsx components/BillHistory.tsx lib/client/bill-format.ts
git commit -m "$(cat <<'EOF'
feat(ui): hide yen columns when bill has no estimated cost

EOF
)"
```

---

### Task 9: cloudflared quick tunnel 脚本

**Files:**
- Create: `scripts/dev-tunnel.sh`
- Modify: `package.json`
- Create: `tests/scripts/dev-tunnel.test.ts`

**Interfaces:**
- Consumes: 宿主机 `cloudflared`、本地 `npm run dev`、端口 `PORT`（默认 3000）。
- Produces: npm script `dev:tunnel`；缺 cloudflared 时非零退出并打印安装提示。

- [ ] **Step 1: 写脚本**

`scripts/dev-tunnel.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "未找到 cloudflared：请先安装后再运行 npm run dev:tunnel" >&2
  echo "macOS: brew install cloudflared" >&2
  echo "其它系统见 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 1
fi

is_up() {
  curl -sf "http://127.0.0.1:${PORT}" >/dev/null 2>&1
}

DEV_PID=""
cleanup() {
  if [[ -n "${DEV_PID}" ]] && kill -0 "${DEV_PID}" 2>/dev/null; then
    kill "${DEV_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! is_up; then
  echo "本地 :${PORT} 未在监听，正在启动 npm run dev …"
  npm run dev -- --port "${PORT}" &
  DEV_PID=$!
  for _ in $(seq 1 60); do
    if is_up; then
      break
    fi
    sleep 0.5
  done
  if ! is_up; then
    echo "等待 Next 开发服务器超时（:${PORT}）" >&2
    exit 1
  fi
else
  echo "复用已在监听的 http://localhost:${PORT}"
fi

echo "启动 cloudflared quick tunnel → http://localhost:${PORT}"
echo "浏览器打开终端里打印的 https://*.trycloudflare.com 即可远程测 UsagePanel。"
exec cloudflared tunnel --url "http://localhost:${PORT}"
```

```bash
chmod +x scripts/dev-tunnel.sh
```

`package.json` scripts 增加：`"dev:tunnel": "bash scripts/dev-tunnel.sh"`

- [ ] **Step 2: 写脚本测试**

`tests/scripts/dev-tunnel.test.ts`：

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const script = path.resolve(__dirname, '../../scripts/dev-tunnel.sh');

describe('scripts/dev-tunnel.sh', () => {
  it('仓库里存在可执行脚本，并检查 cloudflared', () => {
    expect(existsSync(script)).toBe(true);
    const body = readFileSync(script, 'utf8');
    expect(body).toContain('cloudflared');
    expect(body).toContain('command -v cloudflared');
    expect(body).toContain('trycloudflare');
  });

  it('PATH 里没有 cloudflared 时以非零状态退出并给出安装提示', () => {
    const result = spawnSync('bash', [script], {
      env: { ...process.env, PATH: '/usr/bin:/bin', PORT: '3999' },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    const err = `${result.stdout}\n${result.stderr}`;
    expect(err).toMatch(/cloudflared/);
    expect(err).toMatch(/安装|install|brew/i);
  });
});
```

（`/usr/bin:/bin` 通常无 cloudflared；若沙箱碰巧有，测试会失败——此时改为 `PATH: '/nonexistent'`。）

- [ ] **Step 3: 跑测试**

Run: `npx vitest run tests/scripts/dev-tunnel.test.ts && npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/dev-tunnel.sh package.json tests/scripts/dev-tunnel.test.ts
git commit -m "$(cat <<'EOF'
feat(dev): add cloudflared quick tunnel via npm run dev:tunnel

EOF
)"
```

---

### Task 10: README — usage 事件与隧道文档

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 已实现的 SSE `usage`、`dev:tunnel`、金额策略。
- Produces: 文档与行为一致；命名隧道仅可选节，无密钥。

- [ ] **Step 1: 更新 README**

1. 脚本表增加一行：`npm run dev:tunnel` — 本地 Next + cloudflared quick tunnel（需本机已装 cloudflared）。
2. SSE 事件列表补上 `usage`：每次成功 LLM 调用后推送真实 token；重连时快照带 `usageLog`，客户端按 `callId` 去重。
3. 账单小节：智谱显示估算金额；DeepSeek / OpenRouter **只显示 token / cache，不显示金额**。
4. 新增「远程测试（cloudflared）」：
   - **默认 quick tunnel**：`npm run dev:tunnel`，打开终端打印的 `*.trycloudflare.com`；URL 每次可变；无需 Cloudflare 账号。
   - **可选命名隧道**（自备域名）：概述 `cloudflared tunnel create`、写 `config.yml`（ingress 指到 `localhost:3000`）、DNS 路由；明确「凭证与 config 留在本机，不要提交仓库」；不作为默认脚本路径。

- [ ] **Step 2: 快速自检**

Run: `npm test && npm run typecheck`
Expected: PASS（文档改动不破测）

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: document live usage SSE, null-cost providers, and cloudflared tunnels

EOF
)"
```

---

## Spec coverage checklist（作者自审）

| Spec 要求 | Task |
|-----------|------|
| SSE `usage` 字段与成功 append 后发出 | Task 1–3 |
| 进 session 缓冲 + watermark 回放 + callId 去重 | Task 5–6 |
| UsagePanel 中局追加行 | Task 7 |
| deepseek/openrouter `estimatedCostCny === null`；移出定价路径 | Task 4 |
| 智谱仍估算 | Task 4 |
| BillPanel/历史隐藏 ¥ | Task 8 |
| `dev-tunnel.sh` + `dev:tunnel` | Task 9 |
| README 命名隧道可选 | Task 10 |
| Emitter / buildBill / apply-event / 隧道测试 | Task 3–5、9 |
| 非目标未纳入 | Global Constraints |

无 TBD / 占位符。实现时按 Task 顺序 TDD；每个 Task 提交前 `npm test` + `npm run typecheck` 全绿。
