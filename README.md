# agent-undercover

四个 AI 玩家自动进行的「谁是卧底」网页旁观牌桌。3 名平民 + 1 名卧底，经典双词规则，全部由同一个模型（智谱 BigModel 或 DeepSeek，开局时在页面上选）+ 四套不同人设驱动；你在浏览器里看它们发言、投票、决出胜负，局末还能看到这一局的 token 用量与估算账单。

四个座位统一使用基线 `PlayerAgent`：发言与投票各是一次模型调用，直接返回 JSON 结果，没有额外的规划或思考步骤，也没有可切换的思考方式。早期思考方式对照实验的记录留在 [`docs/experiments/`](docs/experiments/) 里作为存档，对应的实验入口已从代码中移除。

## 环境要求

- Node.js >= 20.9
- 一个智谱 BigModel / DeepSeek / OpenRouter 的 API Key（在页面上填，不用写进 .env）；或本机已运行的 OmniRoute（`omniroute serve`，默认 `127.0.0.1:20128`，页面免填 Key）

## 快速开始

```bash
npm install
npm run dev
```

打开 http://localhost:3000 ，在「模型设置」里选供应商、填模型名与 API Key，然后点「开始」。Key 保存在这台浏览器的 localStorage，并随每次开局请求发给本地服务端；服务端只把它放在该局内存里，不写盘、不写日志。选「本地 OmniRoute」时页面免填 Key、模型从下拉选择，需本机已运行 `omniroute serve`（默认 `http://127.0.0.1:20128/v1`）。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `ENABLE_GOD_VIEW` | 否 | 未设置（等价于关闭） | 设为 `true` 才开放 `GET /api/games/<gameId>/reveal`，页面上的「上帝视角」才能拿到身份与私有词 |
| `OMNIROUTE_BASE_URL` | 否 | `http://127.0.0.1:20128/v1` | 本地 OmniRoute 的 OpenAI 兼容根路径（无尾斜杠或有均可） |
| `OMNIROUTE_API_KEY` | 否 | 空 | 可选；非空则服务端请求 OmniRoute 时带 `Authorization: Bearer …` |

除 OmniRoute 外，API Key **不**通过环境变量配置：它只随 `POST /api/games` 的请求体进入该局 session 内存。OmniRoute 的上游 Key 留在 OmniRoute 进程里，页面免填。

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 本地开发服务器 |
| `npm run dev:tunnel` | 本地 Next + cloudflared quick tunnel（需本机已装 cloudflared） |
| `npm run build` | 生产构建 |
| `npm start` | 跑生产构建 |
| `npm test` | Vitest 全量单测（不发任何真实模型请求） |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run typecheck` | `tsc --noEmit` |

## 远程测试（cloudflared）

想在手机或别人的浏览器上看这台机器跑的对局时，用 cloudflared 把本地 3000 端口临时暴露出去。

### 默认：quick tunnel

```bash
npm run dev:tunnel
```

脚本会在本地 3000 端口没监听时先起 `npm run dev`（已经在跑就直接复用），再启动 cloudflared quick tunnel。打开终端里打印的 `https://*.trycloudflare.com` 就是远程入口。这条 URL 每次启动都不一样，关掉脚本即失效；不需要 Cloudflare 账号，也不需要任何凭证。本机没装 cloudflared 时脚本会直接报错并给出安装提示。

### 可选：命名隧道（自备域名）

想要一个固定域名时，可以自己建命名隧道——它**不是**本仓库的默认路径，没有对应脚本：

1. `cloudflared tunnel login` 后 `cloudflared tunnel create <name>`，会在本机生成隧道凭证 JSON。
2. 写一份 `config.yml`，`ingress` 指到 `http://localhost:3000`，末尾留一条兜底 `service: http_status:404`。
3. `cloudflared tunnel route dns <name> <hostname>` 把域名解析到这条隧道，再用 `cloudflared tunnel run <name>` 启动。

**凭证 JSON 与 `config.yml` 留在本机，不要提交进仓库。**

## 游戏规则（v1）

1. 开局随机指定 1 名卧底，其余 3 人为平民；从 `data/word-pairs.json` 抽一对有关联但不同的词，再随机决定哪边给平民、哪边给卧底。
2. 发言轮：存活玩家按座位号顺序用 1~2 句生活口语描述自己的词，不得念出词面（服务端会程序化校验，失败后带纠正反馈重试，最多 3 次尝试）。
3. 投票轮：每人必须投一名其他存活玩家并附一句理由。得票最高者出局；平票则在并列者之间再投一轮，仍平则在并列者中随机出局。
4. 卧底出局 → 平民胜；场上仅剩 2 人且其中含卧底 → 卧底胜。

## 玩家说话与藏词

四名玩家分别偏慢热稳当、爱接梗、直来直去、话少眼尖。提示词要求它们像朋友聊天一样说一两句短话，从生活场景、习惯和感受切入，避免百科式定义、术语和长篇推理。

首轮只透露一个不太独特的小线索，后续轮次再逐步补充；被投过票时可用少量细节自辩。玩家不知道自己的身份，察觉自己可能拿了不同的词时，会优先找与自己的词也相符的共通点，不主动把差异全说出来，也不凭空改口。口语感与透露信息的分寸由模型遵循提示词，程序无法保证每句都合适。

发言与投票理由都会公开，均校验是否直接包含自己的词面；投票泄词时要求改写，仍失败则使用不含原话的随机合法票。对另一张词的猜测、谐音和过于明显的描述由提示词约束，目前不做语义级判定。

## 出题方式

目前是人工维护的 60 组词对，不额外调用模型生成题目。词库分成五类，让共同经历、不同立场和场景误会带出戏剧性：

| 题材 | 例子 | 聊天空间 |
|------|------|----------|
| 经典热身 `classic` | 牛奶／豆浆、火锅／麻辣烫 | 熟悉的日常事物，容易进入状态 |
| 打工日常 `workplace` | 摸鱼／装忙、背锅／救场 | 同一件事，有人觉得体面，有人觉得憋屈 |
| 社交拉扯 `social` | 关心／查岗、解释／狡辩 | 话听起来相似，心态和立场却不同 |
| 生活糗事 `daily` | 省钱／抠门、熬夜／失眠 | 嘴上说得好听，聊经历时容易露馅 |
| 场景错位 `mixup` | 相亲／面试、婚礼／年会、前任／甲方 | 一句话放进两种场景都能讲通 |

抽题使用服务端共享的牌袋：每组抽过后暂时移出，整袋抽完才重新装入；还有其他题材可选时，优先不重复上一局题材；新一袋的第一题也避开上一袋最后一题。每次先随机选题材，再在该题材剩余词对里随机抽题，因此不再是每组词对始终等概率。两个词以各 50% 的概率交换平民／卧底方向。

牌袋进度只保存在当前服务进程内，服务重启或词库内容变化后会重置；多个浏览器共用该进程的牌袋，多进程之间不共享去重记录。`category` 只用于服务端抽题，不会进入玩家视角、公开快照或题目提示。游戏没有预设台词、指定谁赢或强制反转。

## 架构

```
app/                              页面与 API routes
  api/games/route.ts              POST 创建并启动一局
  api/games/[gameId]/events/      SSE 事件流
  api/games/[gameId]/reveal/      上帝视角（需 ENABLE_GOD_VIEW=true）
components/                       纯展示组件
lib/game/                         GameState / rules / Judge / session / registry / bootstrap
lib/agents/                       personas / prompt / PlayerAgent
lib/llm/                          供应商客户端（OpenAI 兼容核心 + 智谱 / DeepSeek / OpenRouter / 本地 OmniRoute）与用量解析
lib/billing/                      用量流水账、价目表、账单估算与 bill 事件发射
lib/client/                       事件归约、格式化、SSE hook、设置与账单历史存储
data/word-pairs.json              内置词库
docs/superpowers/specs/           设计文档
tests/                            Vitest 单测
```

SSE 事件：`snapshot`（连接时的公开快照）、`phase`、`speech`、`vote`、`result`、`usage`、`bill`、`error`。`snapshot` 定格当前公开视图，之后只推快照之后发生的事件（按水位线订阅），重连或刷新都不会把日志追加成两份；对局已经结束时只发一条含账单的 `snapshot` 就关流。`vote` 事件带 `ballot`（本游戏轮里的第几次投票），平票重投是第 2 次，票数统计只看最后一次。投票阶段每轮到一个人就推一条带 `activeSeatId` 的 `phase` 事件，前端据此高亮当前投票人；一轮收完票后再推一条 `activeSeatId` 为 null 的 `phase`。`usage` 在每次成功的模型调用记账之后立刻推一条，带供应商真实返回的 prompt / completion / 缓存 token，页面「实时用量」面板据此中局追加行；每条带一个 `callId`，重连时 `snapshot` 会把已发生的 `usageLog` 一起带回来，客户端按 `callId` 去重，刷新或断线重连都不会把同一次调用记两遍。`phase: 'result'` 与 `bill` 都排在终局事件之前推送（SSE 一见终局事件就关流，排在它后面的帧到不了浏览器），`bill` 带这一局每次模型调用的 token 与缓存明细；默认视图**不包含**任何人的身份与私有词，也**不包含** API Key。

## 内心独白与公开发言

每个玩家的一次模型调用同时产出两样东西：`thought`（内心独白）与 `speech` / `reason`（公开说出口的话）。发言返回 `{"thought":"…","speech":"…"}`，投票返回 `{"thought":"…","vote":N,"reason":"…"}`。

两者的去向严格分开：

- **公开部分**（`speech` / `reason` 与投票对象）进公开时间线、SSE 帧和其他玩家的提示词，因此仍然禁止出现自己的词面，违反就要求模型重写。
- **内心独白**只落在服务端的对局日志里，可以直接写出自己的词（那正是它存在的意义）。它**绝不**进入任何 agent 的提示词与公开记录（`renderTranscript` / `buildAgentView` 看不到它）、也**绝不**出现在 `snapshot` 或任何 SSE 帧里。唯一能读到它的是 `GET /api/games/<gameId>/reveal`（需 `ENABLE_GOD_VIEW=true`），页面上的「上帝视角」面板会在每条发言/投票下方显示「内心独白」。

剥离的关卡在 `lib/game/state.ts` 的 `toPublicLog`：`toPublicView` 与 `buildAgentView` 都逐字段重建公开日志，`toGodView` 才用未经剥离的原始日志。类型上也分了两套，`PublicGameView.log` / `AgentView.log` 是 `PublicLogEntry[]`，压根没有 `thought` 字段。模型没给或走兜底票时，`thought` 是空字符串。

## 容错

- 发言会持续尝试直到校验通过，最多请求 3 次（含首次），每次发言总等待上限 90 秒。次数按时限倒推：单次请求上限 20 秒，3 次连同 500ms、1000ms 退避最坏 61.5 秒，最后一次一定还发得出去。网络错误、超时、429 / 5xx 才退避；发言层统一管理尝试次数，不再与客户端重试叠加。
- 发言不是合法 JSON、内容为空或包含自己的词面时，会明确告诉模型问题并要求重写。初始输出预算为 1024 tokens；响应被截断或为空时逐次加倍，最高 4096 tokens。DeepSeek 显式关闭思考模式，避免思考过程耗尽短发言的输出预算。
- 发言连续失败或等待超时后，页面显示失败玩家和原因并停止本局，不再将「没有有效发言」传给其他玩家用于推理。API Key、权限、余额或模型配置等不可重试的 4xx 错误会立即停止；排除问题后点「再来一局」。
- 投票与发言一样由 Agent 层独占重试预算（客户端内重试关闭，不再相乘）：输出不合格时再尝试 1 次，仍失败则随机选择合法候选并标红；单次投票总等待上限 60 秒，到期取消请求并停止本局。
- 已返回的空响应或截断响应也会记录供应商提供的 token 用量；网络中断或取消请求而未收到用量的部分无法统计。更多重试可能增加实际用量。
- 单局硬超时（默认 180 秒）：每次发言、每张选票之前都核一次墙上时钟，超时即结束对局并推 `error` 事件。发言 90 秒 / 投票 60 秒的等待上限包住该次的全部重试，不会与重试次数相乘。
- 关掉页面（事件流订阅者归零）超过 10 秒会自动中止该局，停止继续消耗模型额度；中止前照常推 `bill` 再推 `error`，宽限期内刷新回来则不受影响。对局结束后 session 在内存里保留 30 分钟供刷新回看，到点自动清理；注册表还有容量上限，超出时优先淘汰最旧的已结束对局，进行中的对局不受影响。
- 配置不合法（缺 Key、未知 provider、model 超长）：`POST /api/games` 返回 400 与可读错误，错误里不会回显 Key。
- localStorage 写入失败（隐私模式等）：页面给出提示，不影响本局进行。

## 计费说明

token 与缓存明细对所有供应商都照常统计；**金额只有智谱会给**，而且是本地估算。

- **智谱**：单价表内置在 `lib/billing/prices.ts`（单位 CNY / 1K tokens），未知模型按该供应商默认档估算，缓存命中的 token 按 prompt 单价计入、没有做缓存折扣。实际费用以供应商官方账单为准。
- **DeepSeek / OpenRouter / 本地 OmniRoute**：**只显示 token 与缓存，不显示任何金额**。DeepSeek 有阶梯价、缓存折扣与优惠时段，OpenRouter 的模型来自上游多家厂商、按美元实时计价，OmniRoute 聚合本地上游、费用以各上游账单为准，本地静态单价算出来的钱对不上，与其编一个看着像真的假价，不如不给。这几家的账单估算值是 `null`，局末账单与历史记录里连「¥」都不出现：「估算」徽章、总计的费用格、按座位与每次调用的费用列一起隐藏，账单备注里写明「该供应商没有内置单价表，本局只统计 token，费用暂不可用。」

供应商没有返回 usage 或缓存字段时，对应数值记 0 并在账单里注明。OpenRouter 的模型名用它的 `厂商/模型` 写法（默认 `openai/gpt-4o-mini`）。

## v1 不包含

空白卧底规则、真人入座、多模型混搭 UI、登录、多局持久化与战绩、浏览器 E2E 测试、真·多进程 agent 隔离。
