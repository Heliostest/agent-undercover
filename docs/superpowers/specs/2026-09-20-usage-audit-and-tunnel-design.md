# 实时 Token 审计 + cloudflared 远程测试 — 设计文档

日期：2026-09-20  
仓库：https://github.com/Heliostest/agent-undercover  
状态：已与产品方对齐，待实现计划

## 1. 目标

1. **统一实时 token 审计**：对局进行中，每一次成功的 LLM 调用经 SSE 追加一条用量记录；局末再汇总。
2. **金额策略按供应商区分**：
   - DeepSeek / OpenRouter：只展示真实 token（prompt / completion / cache），**不显示金额**。
   - 智谱：局末仍可用内置单价表显示**估算**费用（`estimated: true`）。
3. **cloudflared 远程测试**：默认 quick tunnel 一键开测；README 另写命名隧道可选步骤。

## 2. 非目标

- 调用 DeepSeek（或其他）余额 / 账单 API 做金额对账
- 改智谱估价公式或单价表
- 为 OpenRouter 编造费用
- 引入 WebSocket 或第二条实时通道
- 把 tunnel URL、Cloudflare 凭证写入仓库
- 强制 CI 安装 cloudflared
- 浏览器 E2E

## 3. 架构（方案 A）

沿用现有 `lib/billing` 的 `UsageLedger` + SSE + 局末 `bill`，增量：

| 模块 | 职责 |
|------|------|
| `UsageLedger.append` | 成功调用后记一条（已有） |
| SSE `usage` 事件 | append 后立即推送该条真实 token |
| 局末 `bill` | 仍由 `buildBill` 生成；DeepSeek/OpenRouter 的费用字段为 `null` |
| `UsagePanel`（新） | 消费 `usage`，对局中滚动列表 |
| `BillPanel` / 历史 | 无金额供应商不渲染「¥」 |
| `scripts/dev-tunnel.sh` + npm script | 起本地 Next + cloudflared quick tunnel |

## 4. 数据流与接口

### 4.1 SSE `usage`（中局）

每次 LLM **成功**返回且 ledger 记入后立刻发出（失败 / 超时 / 校验重试中的失败不记、不发，与现有 ledger 一致）：

```ts
{
  type: 'usage',
  callId: string,          // append 时生成；写入 ledger 并用于回放去重
  seatId: number,
  phase: 'speak' | 'vote',
  provider: 'zhipu' | 'deepseek' | 'openrouter',
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheHitTokens: number,
  cacheMissTokens: number,
  cacheReported: boolean,
}
```

### 4.2 局末 `bill`（不变骨架，金额语义收紧）

- `calls[]` + totals（含 cache 合计）保留。
- `estimatedCostCny`：
  - `zhipu`：按现有单价表估算（可非 null）
  - `deepseek` / `openrouter`：**恒为 `null`**（现状 DeepSeek 仍在 `prices.ts` 有单价；本迭代起从定价表/估价路径拿掉，与 OpenRouter 一样只记 token）
- 文案：有金额时标注「估算」；无金额时只展示 token / cache。

### 4.3 重连

`usage` 进入与其它游戏事件同一 session 缓冲；SSE 订阅仍按 watermark 回放，避免刷新丢审计条。客户端可用 `callId` 去重。

## 5. UI

### 5.1 UsagePanel

- 对局旁侧或消耗区：每条 `usage` 追加一行（座位 · speak/vote（字段名 `phase`） · prompt/completion · cache hit/miss；未报告 cache 时显示「未提供」）。
- 局末与 BillPanel 同属「消耗」区，避免两套数字；实时列表可保留作明细，Bill 作汇总。

### 5.2 BillPanel / BillHistory

- DeepSeek / OpenRouter：隐藏金额列与合计「¥」。
- 智谱：保持估算金额展示。
- 历史仍存局末 `bill`（不含 API Key）。

## 6. cloudflared

### 6.1 默认：quick tunnel

- `scripts/dev-tunnel.sh`（及 `package.json` 如 `dev:tunnel`）：
  1. 检查 `cloudflared` 是否在 PATH；缺失则打印安装提示并退出非零。
  2. 启动（或复用）本地 Next（约定端口，如 `3000`）。
  3. 运行 `cloudflared tunnel --url http://localhost:$PORT`。
  4. 将临时 `https://*.trycloudflare.com` 打到终端 stdout。
- 不要求 Cloudflare 账号；URL 每次可变。

### 6.2 可选：命名隧道

- 仅 README：自备域名、`cloudflared tunnel create`、config.yml、DNS 路由；不作为默认脚本路径。

## 7. 测试

- Emitter：append 后产生对应 `usage` 事件形状。
- `buildBill`：DeepSeek / OpenRouter → `estimatedCostCny === null`；智谱仍可非 null。
- 客户端 `apply-event`：`usage` 追加列表；重复 `callId` 不双计。
- 隧道：脚本存在、缺 cloudflared 时有可读错误；不强依赖 CI 真跑 tunnel。

## 8. 实现路径

1. 本 spec 定稿后，用 writing-plans 拆 Task。
2. Claude 按 Task 实现并开 PR。
3. 合并后本地可用 `dev:tunnel` 远程测 UsagePanel。
