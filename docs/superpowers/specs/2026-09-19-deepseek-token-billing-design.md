# DeepSeek 配置 + Token 用量 + 每局账单 — 设计文档

日期：2026-09-19  
仓库：https://github.com/Heliostest/agent-undercover  
状态：已与产品方对齐，待实现计划

## 1. 目标

在现有 v1 旁观局上增加：

1. **网页配置智谱 / DeepSeek**：供应商、模型、API Key（浏览器 localStorage 记住）
2. **Token 用量追踪**：每个 agent、每一次 LLM 调用的明细，含缓存命中（供应商有返回时）
3. **每局估算账单**：局末展示；历史列表保存在浏览器

## 2. 非目标（本迭代）

- 服务端持久化账单或 Key
- 登录 / 多用户账本
- 网页自定义改单价
- 同一局混用多个供应商
- 浏览器 E2E

## 3. 架构（方案 A）

扩展现有单体：

| 模块 | 职责 |
|------|------|
| `createLlmClient(provider, apiKey, model)` | 智谱或 DeepSeek（OpenAI 兼容 chat completions） |
| `UsageLedger` | 挂在 game session：追加每次调用记录 |
| `lib/billing/prices.ts` | 内置 CNY/1K tokens 单价表 |
| `lib/billing/estimate.ts` | 由 ledger 生成 `Bill`（估算费用） |
| 前端设置 + 账单/历史 UI | localStorage；局末消费 SSE `bill` |

Key **仅**随 `POST /api/games` 进入该局 session 内存；不写盘；日志禁止打印明文 Key。

## 4. 数据流

### 4.1 开局

前端 localStorage：`provider`（`zhipu` \| `deepseek`）、`model`、`apiKey`。  
`POST /api/games` body 携带三项；缺 Key / 未知 provider → **400**。

### 4.2 每次 LLM 调用 → `UsageRecord`

- `seatId`、`phase`（speak / vote / …）、`provider`、`model`、`at`
- `promptTokens`、`completionTokens`、`totalTokens`
- 缓存：
  - `cacheHitTokens`、`cacheMissTokens`
  - `cacheReported: boolean`（响应无缓存字段则为 false，UI 显示「未提供」）
- DeepSeek：映射官方 cache hit/miss 字段；智谱：有则映射，无则 `cacheReported: false`
- 整段 usage 缺失：tokens 记 0，`cacheReported: false`，账单注明「部分调用未返回 usage」

### 4.3 局末 `bill` 事件（SSE）

在 `result` / 终局 `error` 之前（或紧随其后一次）推送：

- `calls[]`：全部 `UsageRecord`（按时间）
- `bySeat`：每座位合计（含 cacheHit 合计）
- `totals`：全局合计 + **估算费用 CNY**
- 文案固定暗示：费用为估算，以官方账单为准

前端写入历史 localStorage（**不含 API Key**）。

## 5. UI

### 5.1 开局面板

- 供应商：智谱 / DeepSeek
- 模型：文本框（默认如 `glm-4-flash` / `deepseek-chat`）
- API Key：password；读写 localStorage；可清除
- 开始前校验非空

### 5.2 对局中

- 现有牌桌不变
- 可选：本局累计 tokens 小条（有增量则更新，否则局末刷新）

### 5.3 局末账单

- 总览：prompt / completion / cacheHit（若有）/ 估算费用（标「估算」）
- 按座位汇总
- 展开每次调用：时间、座位、阶段、tokens、缓存命中/未命中或「未提供」

### 5.4 历史

- 列表（新→旧）：时间、provider、model、总 token、估算费用
- 点开完整 `bill`；删除单条 / 清空

## 6. 计价

- 内置表：`provider` + `model` → 每 1K prompt / completion 单价（CNY）
- 未知 model → 该供应商默认档
- DeepSeek 常见：`deepseek-chat`、`deepseek-reasoner` 等覆盖
- 一律标注「估算，以官方为准」

## 7. 容错

- HTTP 429/5xx：沿用现有退避；错误信息不含 Key
- localStorage 写入失败：提示用户，不影响本局

## 8. 测试

- 单价估算、ledger 汇总、cache 字段映射（mock）
- createGame 校验 provider/model/key
- 不测真实外网；不做 E2E

## 9. 成功标准

1. 网页可填智谱或 DeepSeek Key/模型并开局（Key 刷新后仍在 localStorage）
2. 局末账单可展开到每次调用的 token 与缓存信息（有则显示，无则「未提供」）
3. 历史列表可回看过往局账单；其中无 API Key
4. 相关单测通过；`typecheck` / `build` 通过

## 10. 实现落点（文件草图）

```
lib/llm/types.ts          # 扩展 usage / cache 字段
lib/llm/deepseek.ts       # 新客户端
lib/llm/zhipu.ts          # 解析 usage/cache
lib/llm/create-client.ts  # factory
lib/billing/prices.ts
lib/billing/ledger.ts
lib/billing/estimate.ts
app/api/games/route.ts    # 接受 provider/model/apiKey
components/SettingsForm.tsx
components/BillPanel.tsx
components/BillHistory.tsx
lib/client/settings-storage.ts
lib/client/bill-history.ts
```
