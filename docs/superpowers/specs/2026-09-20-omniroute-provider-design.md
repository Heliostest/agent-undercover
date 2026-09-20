# 本地 OmniRoute 供应商 — 设计文档

日期：2026-09-20  
仓库：https://github.com/Heliostest/agent-undercover  
状态：已与产品方对齐，待实现计划

## 1. 目标

1. 新增供应商 **本地 OmniRoute**（`provider: 'omniroute'`），默认连跑 Next 的那台机器上的 OmniRoute（`http://127.0.0.1:20128/v1`）。
2. **开局面板不填任何 Key**：上游 Key 留在 OmniRoute；服务端可选读 `OMNIROUTE_API_KEY`（可空）。
3. 模型从 OmniRoute `GET /v1/models` **下拉选择**（经 Next 代理，便于 cloudflared 远程测）。
4. 账单：只记真实 token，**不显示金额**（与 OpenRouter 一致）。

## 2. 非目标

- 浏览器直连 `127.0.0.1:20128`（远程 tunnel 下会连错机器）
- 把智谱 / DeepSeek / OpenRouter 上游 Key 写入仓库或下发给浏览器
- 通用「任意自定义 OpenAI 兼容端点」配置面板（本迭代只要 OmniRoute）
- 改智谱估价公式；为 OmniRoute 编造费用
- 自动启动 / 安装 OmniRoute 进程

## 3. 架构（方案 A）

| 模块 | 职责 |
|------|------|
| `LlmProvider` + `providers.ts` | 增加 `omniroute` 与中文标签、默认模型占位 |
| `lib/llm/omniroute.ts` | OpenAI-compatible client；baseUrl / apiKey 来自 env |
| `parseLlmConfig` / `createClient` | `omniroute` 允许空 apiKey；注入 `OMNIROUTE_BASE_URL` + `OMNIROUTE_API_KEY` |
| `GET /api/omniroute/models` | 服务端转发 `{BASE}/models` → `{ models: string[] }` |
| Settings UI | 选 omniroute 时隐藏 Key；模型下拉 + 刷新 |
| `estimate` / Bill UI | omniroute 的 `estimatedCostCny` 恒 `null` |

## 4. 数据流与接口

### 4.1 环境变量

- `OMNIROUTE_BASE_URL`：默认 `http://127.0.0.1:20128/v1`（无尾斜杠或有均可，实现时归一）
- `OMNIROUTE_API_KEY`：可空；非空则 `Authorization: Bearer …`

### 4.2 `GET /api/omniroute/models`

- 服务端 `GET ${BASE}/models`（带可选 Bearer）
- 成功：`200 { models: string[] }`（从 OpenAI 风格 `data[].id` 抽出，排序去重）
- 失败：`502` + 可读中文错误（超时 / 连接拒绝 / 非 JSON），**不得**回显 env 里的 Key

### 4.3 开局 `POST /api/games`

- Body：`{ provider: 'omniroute', model: string }`；`apiKey` 可缺省或 `''`
- 其它 provider 仍要求非空 apiKey
- 服务端创建 client 时用 env baseUrl + env apiKey，**忽略**浏览器传来的 apiKey（防误用）

### 4.4 用量与账单

- usage SSE / ledger 照常记 prompt/completion/cache
- `buildBill`：`omniroute` 与 `openrouter` 一样 `estimatedCostCny === null`；UI 隐藏 ¥

## 5. UI

- 供应商选项增加「本地 OmniRoute」
- 选中后：
  - 隐藏 API Key 字段；校验不要求 Key
  - 模型控件改为 `<select>`（或等价下拉）；挂载与切换时拉 `/api/omniroute/models`
  - 拉失败：展示错误，禁用「开局」；提供「刷新」
  - 若上次 localStorage 的 model 仍在列表中则预选，否则选第一项
- localStorage：`provider` + `model`；omniroute 的 `apiKey` 存 `''`

## 6. 测试

- `parseLlmConfig`：omniroute + 空 key 合法；其它 provider 空 key 仍 400
- models 路由：mock fetch 成功/失败
- create-client：omniroute 使用默认 baseUrl
- estimate / bill：omniroute → null cost
- settings validate：omniroute 不要求 apiKey

## 7. 文档

- `.env.example`：`OMNIROUTE_BASE_URL`、`OMNIROUTE_API_KEY`
- README：一句说明本地 OmniRoute 免填 Key + 需本机 `omniroute serve`

## 8. 实现路径

1. 本 spec 定稿后写 implementation plan
2. Claude（`claude-opus-5`）按 Task 实现并开 PR
3. 合并后用 `dev:tunnel` 远程验证：选 OmniRoute → 下拉有模型 → 免 Key 开局
