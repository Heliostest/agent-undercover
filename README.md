# agent-undercover

四个 AI 玩家自动进行的「谁是卧底」网页旁观牌桌。3 名平民 + 1 名卧底，经典双词规则，全部由同一个模型（智谱 BigModel 或 DeepSeek，开局时在页面上选）+ 四套不同人设驱动；你在浏览器里看它们发言、投票、决出胜负，局末还能看到这一局的 token 用量与估算账单。

## 环境要求

- Node.js >= 20.9
- 一个智谱 BigModel 或 DeepSeek 的 API Key（在页面上填，不用写进 .env）

## 快速开始

```bash
npm install
npm run dev
```

打开 http://localhost:3000 ，在「模型设置」里选供应商、填模型名与 API Key，然后点「开始」。Key 保存在这台浏览器的 localStorage，并随每次开局请求发给本地服务端；服务端只把它放在该局内存里，不写盘、不写日志。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `ENABLE_GOD_VIEW` | 否 | 未设置（等价于关闭） | 设为 `true` 才开放 `GET /api/games/<gameId>/reveal`，页面上的「上帝视角」才能拿到身份与私有词 |

API Key **不**通过环境变量配置：它只随 `POST /api/games` 的请求体进入该局 session 内存。

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 本地开发服务器 |
| `npm run build` | 生产构建 |
| `npm start` | 跑生产构建 |
| `npm test` | Vitest 全量单测（不发任何真实模型请求） |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run typecheck` | `tsc --noEmit` |

## 游戏规则（v1）

1. 开局随机指定 1 名卧底，其余 3 人为平民；从 `data/word-pairs.json` 抽一对近义词，平民拿 A，卧底拿 B。
2. 发言轮：存活玩家按座位号顺序用 1~3 句话描述自己的词，不得念出词面（服务端会程序化校验，命中则让模型重说一次）。
3. 投票轮：每人必须投一名其他存活玩家并附一句理由。得票最高者出局；平票则在并列者之间再投一轮，仍平则在并列者中随机出局。
4. 卧底出局 → 平民胜；场上仅剩 2 人且其中含卧底 → 卧底胜。

## 架构

```
app/                              页面与 API routes
  api/games/route.ts              POST 创建并启动一局
  api/games/[gameId]/events/      SSE 事件流
  api/games/[gameId]/reveal/      上帝视角（需 ENABLE_GOD_VIEW=true）
components/                       纯展示组件
lib/game/                         GameState / rules / Judge / session / registry / bootstrap
lib/agents/                       personas / prompt / PlayerAgent
lib/llm/                          供应商客户端（OpenAI 兼容核心 + 智谱 / DeepSeek）与用量解析
lib/billing/                      用量流水账、价目表、账单估算与 bill 事件发射
lib/client/                       事件归约、格式化、SSE hook、设置与账单历史存储
data/word-pairs.json              内置词库
docs/superpowers/specs/           设计文档
tests/                            Vitest 单测
```

SSE 事件：`snapshot`（连接时的公开快照）、`phase`、`speech`、`vote`、`result`、`bill`、`error`。`bill` 排在终局事件之前推送，带这一局每次模型调用的 token 与缓存明细；默认视图**不包含**任何人的身份与私有词，也**不包含** API Key。

## 容错

- 智谱超时 / 429 / 5xx：指数退避（500ms、1000ms）最多重试 2 次。
- Agent 输出不合格（不是 JSON、投了非法座位、发言念出词面）：重试 1 次，仍失败则兜底（空发言或随机合法票），该条记录在界面上标红。
- 单局硬超时（默认 180 秒）：结束对局并推 `error` 事件。
- 配置不合法（缺 Key、未知 provider、model 超长）：`POST /api/games` 返回 400 与可读错误，错误里不会回显 Key。
- localStorage 写入失败（隐私模式等）：页面给出提示，不影响本局进行。

## 计费说明

账单是**本地估算**：单价表内置在 `lib/billing/prices.ts`（单位 CNY / 1K tokens），未知模型按该供应商默认档估算，缓存命中的 token 按 prompt 单价计入、没有做缓存折扣。实际费用以供应商官方账单为准。供应商没有返回 usage 或缓存字段时，对应数值记 0 并在账单里注明。

## v1 不包含

空白卧底规则、真人入座、多模型混搭 UI、登录、多局持久化与战绩、浏览器 E2E 测试、真·多进程 agent 隔离。
