# Agent Undercover (谁是卧底 · 多 Agent 旁观版) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Next.js 单体全栈应用：服务端用同一个智谱模型驱动 4 个不同人设的 AI 玩家（3 平民 vs 1 卧底）自动完成「谁是卧底」经典双词对局，人类在浏览器里通过 SSE 实时旁观发言、投票与胜负。

**Architecture:** 游戏逻辑是不依赖 React 的纯 TypeScript 模块（`lib/game/`、`lib/agents/`、`lib/llm/`），Judge 在服务端跑「发言轮 → 投票轮 → 出局 → 判胜负」的循环，每一步通过注入的 `emit` 回调写入内存 GameSession 的事件缓冲区；SSE 路由订阅该 session，把缓冲事件回放给新连接再持续推送；浏览器只持有 `PublicGameView`，用纯函数 `applyEvent` 把事件归约成界面状态。LLM 通过 `LlmClient` 接口注入，测试中一律使用脚本化 mock，绝不发真实请求。

**Tech Stack:** Next.js 15（App Router）、React 19、TypeScript 5（strict）、Vitest 3（node 环境）、原生 `fetch` + SSE、智谱 BigModel chat completions（`ZHIPU_API_KEY` / `ZHIPU_MODEL`）、内置 `data/word-pairs.json`。

## Global Constraints

- 仓库：`Heliostest/agent-undercover`，起点是近乎空仓（仅 README 与设计文档），所有代码从零建立。
- 框架锁定 Next.js App Router + TypeScript；**不使用** Pages Router。
- 游戏逻辑必须是纯 TS 模块（`lib/`），**不耦合 React 组件**；React 只负责渲染。
- 人数固定 4 人：3 平民 + 1 卧底；规则为**经典双词**（平民同词，卧底近义异词）。
- 词库内置于 `data/word-pairs.json`，不走网络、不走数据库。
- LLM 仅智谱 BigModel，chat completions 形态；环境变量名固定为 `ZHIPU_API_KEY`、`ZHIPU_MODEL`。
- 实时推送固定为 SSE，每局一个 `gameId`。
- SSE 事件类型固定 5 种：`phase` / `speech` / `vote` / `result` / `error`。
- 阶段枚举固定 5 种：`setup` / `speak` / `vote` / `result` / `error`。
- 默认视图**不得**泄露卧底身份与私有词；上帝视角默认关闭，由服务端环境变量 `ENABLE_GOD_VIEW=true` 单独开启。
- 容错硬性要求：智谱超时/429 指数退避最多重试 2 次；Agent 输出不合格重试 1 次后兜底（空发言 / 随机合法票）并标记 `fallback: true`；单局硬超时结束并推 `error`；缺 API Key 在创建局时返回可读错误，不空跑。
- 平票规则写死：再投一轮（候选人收窄到并列者）；仍平则在并列者中随机出局，绝不卡死。
- TDD：每个纯逻辑模块先写失败测试再实现；LLM 一律 mock，测试中禁止真实网络请求。
- 所有 TS 代码在 `strict: true` 下通过 `npm run typecheck`。
- 不引入 ESLint / Prettier / Tailwind / 状态管理库 / 数据库（YAGNI），v1 用 `tsc` + `vitest` 把关质量，样式用一个 `app/globals.css`。
- Node 版本要求 >= 20.9（Next 15 的下限）。
- **v1 明确不做**：空白卧底规则、真人入座、多模型混搭 UI、登录、持久化战绩与回放、浏览器 E2E 测试、真·多进程 agent 隔离。
- 叙述与用户可见文案用中文；代码、文件名、标识符用英文。
- 每个 Task 结束时必须 commit，commit message 用 Conventional Commits（`feat:` / `test:` / `chore:` / `docs:`）。

---

## File Structure

先锁定文件边界，再拆任务。每个文件只承担一个职责。

### 配置与数据

| 文件 | 职责 |
|------|------|
| `package.json` | 依赖与脚本（`dev` / `build` / `start` / `test` / `typecheck`） |
| `tsconfig.json` | strict TS 配置，`@/*` 路径别名，`resolveJsonModule` |
| `next.config.ts` | Next 配置（v1 为空配置对象） |
| `vitest.config.ts` | Vitest 配置：node 环境、只收 `tests/**/*.test.ts`、`@` 别名 |
| `.env.example` | 列出 `ZHIPU_API_KEY` / `ZHIPU_MODEL` / `ENABLE_GOD_VIEW` |
| `.gitignore` | 忽略 `node_modules` / `.next` / `.env.local` / `next-env.d.ts` |
| `data/word-pairs.json` | 内置近义词对词库（平民词 + 卧底词） |

### 领域逻辑（`lib/game/`）

| 文件 | 职责 |
|------|------|
| `lib/game/types.ts` | 全部共享类型：`Phase`、`Role`、`Seat`、`GameState`、`LogEntry`、`GameEvent`、`AgentView`、`SeatAgent` 等。**不 import 任何模块** |
| `lib/game/word-bank.ts` | 词库加载、校验与抽词（`loadWordPairs` / `validateWordPairs` / `drawWordPair`） |
| `lib/game/rules.ts` | 纯规则函数：唱票、并列最高票、随机选取、胜负判定 |
| `lib/game/state.ts` | GameState 的创建、突变辅助（记录发言/投票/出局）、视图投影（公开视图 / 上帝视角 / Agent 私有视图） |
| `lib/game/judge.ts` | 裁判循环：阶段推进、收发言、收投票、平票重投、出局、判胜负、硬超时 |
| `lib/game/session.ts` | 单局事件总线：事件缓冲 + 订阅/回放/退订 |
| `lib/game/registry.ts` | 进程内 `gameId -> GameSession` 注册表（挂在 `globalThis` 上以熬过 dev HMR） |
| `lib/game/bootstrap.ts` | 组装一局：读环境变量 → 建 LlmClient → 抽词 → 建 state/session/agents → 启动 Judge |

### Agent 与 LLM

| 文件 | 职责 |
|------|------|
| `lib/agents/personas.ts` | 4 套人设常量 `PERSONAS` |
| `lib/agents/prompt.ts` | 公开记录渲染、发言/投票 prompt 构造、模型回复解析（纯函数） |
| `lib/agents/player-agent.ts` | `PlayerAgent`：调 LLM、解析失败重试 1 次、仍失败走兜底 |
| `lib/llm/types.ts` | `LlmClient` 接口、`LlmMessage`、`LlmError` |
| `lib/llm/zhipu.ts` | 智谱 chat completions 封装：超时、指数退避重试、环境变量读取 |

### HTTP 层（`app/api/`）

| 文件 | 职责 |
|------|------|
| `app/api/games/route.ts` | `POST /api/games`：创建并启动一局，缺 Key 返回 400 |
| `app/api/games/[gameId]/events/route.ts` | `GET`：SSE 流，先发 `snapshot` 再回放并续推事件 |
| `app/api/games/[gameId]/reveal/route.ts` | `GET`：上帝视角，未启用返回 403 |

### 前端（`app/` + `components/` + `lib/client/`）

| 文件 | 职责 |
|------|------|
| `lib/client/apply-event.ts` | 纯函数 `applyEvent(view, event) -> view`，把 SSE 事件归约进公开视图 |
| `lib/client/format.ts` | 阶段/胜负中文标签、座位名查找 |
| `lib/client/use-game-stream.ts` | React hook：POST 建局 + 订阅 EventSource + 维护状态 |
| `app/layout.tsx` | 根布局与 metadata |
| `app/globals.css` | 全局样式（牌桌、座位卡、时间线、投票条） |
| `app/page.tsx` | 首页：组合 TopBar / SeatCard / Timeline / VoteBar / GodPanel |
| `components/TopBar.tsx` | 局号、阶段、开始 / 再来一局按钮 |
| `components/SeatCard.tsx` | 单个座位卡：名字、人设标签、存活状态、是否正在行动 |
| `components/Timeline.tsx` | 发言时间线 |
| `components/VoteBar.tsx` | 本轮投票明细与票数汇总 |
| `components/GodPanel.tsx` | 上帝视角面板（按钮触发拉取 `/reveal`） |

### 测试（`tests/`，镜像 `lib/` 结构）

| 文件 | 覆盖 |
|------|------|
| `tests/setup.test.ts` | 测试基线自检 |
| `tests/game/word-bank.test.ts` | 词库校验与抽词 |
| `tests/game/rules.test.ts` | 唱票、并列、胜负判定 |
| `tests/game/state.test.ts` | 建局发词、公开视图不泄露、Agent 私有视图 |
| `tests/llm/zhipu.test.ts` | 退避重试、4xx 不重试、缺 Key 报错 |
| `tests/agents/prompt.test.ts` | prompt 构造与回复解析 |
| `tests/agents/player-agent.test.ts` | 重试一次 + 兜底 |
| `tests/game/judge.test.ts` | 整局跑通、平票重投、随机兜底、硬超时、agent 抛错 |
| `tests/game/session.test.ts` | 事件缓冲、回放、退订 |
| `tests/game/bootstrap.test.ts` | 组装一局并跑完（mock LLM） |
| `tests/api/routes.test.ts` | 缺 Key 400、reveal 403/200 |
| `tests/client/apply-event.test.ts` | 事件归约 |

### 文档

| 文件 | 职责 |
|------|------|
| `docs/superpowers/specs/2026-09-19-agent-undercover-design.md` | 设计文档归位（从仓库根移动过来） |
| `README.md` | 安装、环境变量、启动、测试、上帝视角说明 |

---

## Task 1: 项目脚手架与测试基线

建立一个能 `npm run dev`、`npm run typecheck`、`npm test` 的空壳 Next 应用，并把设计文档归位。本任务交付物是「一条能跑通的红绿链路」。

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx`
- Create: `docs/superpowers/specs/2026-09-19-agent-undercover-design.md`（从仓库根移动）
- Test: `tests/setup.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: npm 脚本 `dev` / `build` / `start` / `test` / `typecheck`；TS 路径别名 `@/*` 指向仓库根；Vitest 只收集 `tests/**/*.test.ts`。

- [ ] **Step 1: 建分支**

```bash
git checkout -b feat/v1-agent-undercover
```

- [ ] **Step 2: 写 `package.json`**

```json
{
  "name": "agent-undercover",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=20.9.0"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.5.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: 安装依赖**

Run: `npm install`
Expected: 成功生成 `node_modules/` 与 `package-lock.json`，无 ERR。

- [ ] **Step 4: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "noEmit": true,
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: 写 `next.config.ts` 与 `.gitignore`**

`next.config.ts`：

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
```

`.gitignore`：

```gitignore
node_modules/
.next/
out/
.env.local
.env*.local
next-env.d.ts
*.tsbuildinfo
```

- [ ] **Step 6: 写 `vitest.config.ts`**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
});
```

- [ ] **Step 7: 写失败测试 `tests/setup.test.ts`**

这个测试断言路径别名可用 —— 它引用还不存在的 `@/lib/game/version`，所以必然失败。

```ts
import { describe, expect, it } from 'vitest';

import { APP_NAME } from '@/lib/game/version';

describe('测试基线', () => {
  it('可以通过 @ 别名 import lib 模块', () => {
    expect(APP_NAME).toBe('agent-undercover');
  });
});
```

- [ ] **Step 8: 跑测试确认失败**

Run: `npx vitest run tests/setup.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/game/version"`。

- [ ] **Step 9: 写最小实现 `lib/game/version.ts`**

```ts
export const APP_NAME = 'agent-undercover';
```

- [ ] **Step 10: 跑测试确认通过**

Run: `npx vitest run tests/setup.test.ts`
Expected: PASS，`1 passed`。

- [ ] **Step 11: 写 `app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Undercover',
  description: '四个 AI 玩家自动进行的「谁是卧底」旁观牌桌',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 12: 写 `app/globals.css`**

```css
:root {
  color-scheme: dark;
  --bg: #11141a;
  --panel: #1b202a;
  --line: #2b3240;
  --text: #e6e9ef;
  --muted: #98a2b3;
  --accent: #6ea8fe;
  --danger: #f06a6a;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 64px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
}

.muted {
  color: var(--muted);
}

.danger {
  color: var(--danger);
}
```

- [ ] **Step 13: 写占位 `app/page.tsx`**

```tsx
export default function HomePage() {
  return (
    <main className="page">
      <h1>Agent Undercover</h1>
      <p className="muted">牌桌界面将在后续任务接入。</p>
    </main>
  );
}
```

- [ ] **Step 14: 归位设计文档**

```bash
mkdir -p docs/superpowers/specs
git mv 2026-09-19-agent-undercover-design.md docs/superpowers/specs/2026-09-19-agent-undercover-design.md
```

- [ ] **Step 15: 写 `.env.example`**

```bash
# 智谱 BigModel API Key，必填；缺失时 POST /api/games 会直接返回可读错误
ZHIPU_API_KEY=
# 使用的模型名，留空则回退到 glm-4-flash
ZHIPU_MODEL=glm-4-flash
# 设为 true 才开放上帝视角接口 GET /api/games/<gameId>/reveal
ENABLE_GOD_VIEW=false
```

- [ ] **Step 16: 类型检查与构建**

Run: `npm run typecheck && npm run build`
Expected: typecheck 无输出（成功）；build 打印 `✓ Compiled successfully` 并列出 `/` 路由。

- [ ] **Step 17: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts vitest.config.ts .gitignore .env.example app lib tests docs
git commit -m "chore: scaffold next app router project with vitest baseline"
```

---

## Task 2: 领域类型与内置词库

把整个项目要用的类型一次性定死（后续任务全部引用它），并实现词库加载与抽词。

**Files:**
- Create: `lib/game/types.ts`
- Create: `data/word-pairs.json`
- Create: `lib/game/word-bank.ts`
- Delete: `lib/game/version.ts`
- Modify: `tests/setup.test.ts`（改为断言词库文件可解析）
- Test: `tests/game/word-bank.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `@/*` 别名与 Vitest 配置。
- Produces:
  - `type Phase = 'setup' | 'speak' | 'vote' | 'result' | 'error'`
  - `type Role = 'civilian' | 'undercover'`；`type Winner = 'civilians' | 'undercover'`
  - `interface WordPair { civilian: string; undercover: string }`
  - `interface Persona { id: string; name: string; label: string; systemPrompt: string }`
  - `interface Seat { id: number; name: string; personaId: string; personaLabel: string; role: Role; word: string; alive: boolean }`
  - `type LogEntry = SpeechEntry | VoteEntry | EliminationEntry`
  - `interface GameState { gameId; seats; round; phase; activeSeatId; log; winner; errorMessage }`
  - `interface PublicSeat`、`interface PublicGameView`、`interface RevealSeat`、`interface GodGameView`
  - `interface AgentView`、`interface SpeechResult`、`interface VoteResult`、`interface SeatAgent`
  - `type GameEvent`（5 种 `type`）
  - `validateWordPairs(input: unknown): WordPair[]`
  - `loadWordPairs(): WordPair[]`
  - `drawWordPair(pairs: WordPair[], rng: () => number): WordPair`

- [ ] **Step 1: 写 `lib/game/types.ts`**

这是纯类型文件，没有运行时行为，不单独写测试；它的正确性由后续每个任务的 `npm run typecheck` 持续验证。

```ts
export type Phase = 'setup' | 'speak' | 'vote' | 'result' | 'error';

export type Role = 'civilian' | 'undercover';

export type Winner = 'civilians' | 'undercover';

export const SEAT_COUNT = 4;

export interface WordPair {
  civilian: string;
  undercover: string;
}

export interface Persona {
  id: string;
  name: string;
  label: string;
  systemPrompt: string;
}

export interface Seat {
  id: number;
  name: string;
  personaId: string;
  personaLabel: string;
  role: Role;
  word: string;
  alive: boolean;
}

export interface SpeechEntry {
  kind: 'speech';
  round: number;
  seatId: number;
  text: string;
  fallback: boolean;
}

export interface VoteEntry {
  kind: 'vote';
  round: number;
  seatId: number;
  targetSeatId: number;
  reason: string;
  fallback: boolean;
}

export interface EliminationEntry {
  kind: 'elimination';
  round: number;
  seatId: number;
  tieBreak: boolean;
}

export type LogEntry = SpeechEntry | VoteEntry | EliminationEntry;

export interface GameState {
  gameId: string;
  seats: Seat[];
  round: number;
  phase: Phase;
  activeSeatId: number | null;
  log: LogEntry[];
  winner: Winner | null;
  errorMessage: string | null;
}

export interface PublicSeat {
  id: number;
  name: string;
  personaLabel: string;
  alive: boolean;
}

export interface PublicGameView {
  gameId: string;
  round: number;
  phase: Phase;
  activeSeatId: number | null;
  seats: PublicSeat[];
  log: LogEntry[];
  winner: Winner | null;
  errorMessage: string | null;
}

export interface RevealSeat {
  seatId: number;
  role: Role;
  word: string;
}

export interface GodGameView extends PublicGameView {
  reveal: RevealSeat[];
}

/** 单个 agent 能看到的全部信息：自己的词 + 公开信息，绝不含别人的词或身份。 */
export interface AgentView {
  seatId: number;
  seatName: string;
  word: string;
  round: number;
  seats: PublicSeat[];
  log: LogEntry[];
  aliveOtherIds: number[];
}

export interface SpeechResult {
  text: string;
  fallback: boolean;
}

export interface VoteResult {
  targetSeatId: number;
  reason: string;
  fallback: boolean;
}

/** Judge 只依赖这个接口，测试可以塞脚本化的假 agent。 */
export interface SeatAgent {
  speak(view: AgentView): Promise<SpeechResult>;
  vote(view: AgentView, candidateIds: number[], rng: () => number): Promise<VoteResult>;
}

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
  | { type: 'error'; message: string };
```

- [ ] **Step 2: 写失败测试 `tests/game/word-bank.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { drawWordPair, loadWordPairs, validateWordPairs } from '@/lib/game/word-bank';

describe('validateWordPairs', () => {
  it('接受合法词对并原样返回', () => {
    expect(validateWordPairs([{ civilian: '牛奶', undercover: '豆浆' }])).toEqual([
      { civilian: '牛奶', undercover: '豆浆' },
    ]);
  });

  it('拒绝空数组', () => {
    expect(() => validateWordPairs([])).toThrow('词库必须是非空数组');
  });

  it('拒绝缺少 undercover 的条目', () => {
    expect(() => validateWordPairs([{ civilian: '牛奶' }])).toThrow('第 0 项缺少 undercover');
  });

  it('拒绝两个词相同的条目', () => {
    expect(() => validateWordPairs([{ civilian: '牛奶', undercover: '牛奶' }])).toThrow(
      '第 0 项的两个词不能相同',
    );
  });
});

describe('loadWordPairs', () => {
  it('内置词库至少有 10 组，且每组两词不同', () => {
    const pairs = loadWordPairs();
    expect(pairs.length).toBeGreaterThanOrEqual(10);
    for (const pair of pairs) {
      expect(pair.civilian).not.toBe(pair.undercover);
    }
  });
});

describe('drawWordPair', () => {
  it('按 rng 落点取词', () => {
    const pairs = [
      { civilian: 'a', undercover: 'b' },
      { civilian: 'c', undercover: 'd' },
    ];
    expect(drawWordPair(pairs, () => 0)).toEqual({ civilian: 'a', undercover: 'b' });
    expect(drawWordPair(pairs, () => 0.99)).toEqual({ civilian: 'c', undercover: 'd' });
  });

  it('rng 返回 1 时不越界', () => {
    const pairs = [{ civilian: 'a', undercover: 'b' }];
    expect(drawWordPair(pairs, () => 1)).toEqual({ civilian: 'a', undercover: 'b' });
  });

  it('空词库抛错', () => {
    expect(() => drawWordPair([], () => 0)).toThrow('词库为空，无法发词');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/game/word-bank.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/game/word-bank"`。

- [ ] **Step 4: 写 `data/word-pairs.json`**

```json
[
  { "civilian": "牛奶", "undercover": "豆浆" },
  { "civilian": "咖啡", "undercover": "奶茶" },
  { "civilian": "老虎", "undercover": "狮子" },
  { "civilian": "医生", "undercover": "护士" },
  { "civilian": "飞机", "undercover": "高铁" },
  { "civilian": "西瓜", "undercover": "哈密瓜" },
  { "civilian": "电影院", "undercover": "剧场" },
  { "civilian": "吉他", "undercover": "尤克里里" },
  { "civilian": "羽毛球", "undercover": "网球" },
  { "civilian": "火锅", "undercover": "麻辣烫" },
  { "civilian": "台风", "undercover": "龙卷风" },
  { "civilian": "钢笔", "undercover": "铅笔" }
]
```

- [ ] **Step 5: 写 `lib/game/word-bank.ts`**

```ts
import rawWordPairs from '@/data/word-pairs.json';
import type { WordPair } from '@/lib/game/types';

export function validateWordPairs(input: unknown): WordPair[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('词库必须是非空数组');
  }

  return input.map((item, index) => {
    const pair = item as Partial<WordPair>;
    if (typeof pair.civilian !== 'string' || pair.civilian.trim() === '') {
      throw new Error(`词库第 ${index} 项缺少 civilian`);
    }
    if (typeof pair.undercover !== 'string' || pair.undercover.trim() === '') {
      throw new Error(`词库第 ${index} 项缺少 undercover`);
    }
    if (pair.civilian === pair.undercover) {
      throw new Error(`词库第 ${index} 项的两个词不能相同`);
    }
    return { civilian: pair.civilian, undercover: pair.undercover };
  });
}

export function loadWordPairs(): WordPair[] {
  return validateWordPairs(rawWordPairs);
}

export function drawWordPair(pairs: WordPair[], rng: () => number): WordPair {
  if (pairs.length === 0) {
    throw new Error('词库为空，无法发词');
  }
  const index = Math.min(Math.floor(rng() * pairs.length), pairs.length - 1);
  return pairs[index];
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/game/word-bank.test.ts`
Expected: PASS，`8 passed`。

- [ ] **Step 7: 用词库自检替换脚手架的临时测试**

删除 `lib/game/version.ts`，并把 `tests/setup.test.ts` 整体改写为：

```ts
import { describe, expect, it } from 'vitest';

import { loadWordPairs } from '@/lib/game/word-bank';

describe('测试基线', () => {
  it('可以通过 @ 别名 import lib 模块并读取内置 JSON', () => {
    expect(loadWordPairs()[0].civilian).toBe('牛奶');
  });
});
```

```bash
rm lib/game/version.ts
```

- [ ] **Step 8: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部 PASS，typecheck 无输出。

- [ ] **Step 9: Commit**

```bash
git add lib/game/types.ts lib/game/word-bank.ts data/word-pairs.json tests/game/word-bank.test.ts tests/setup.test.ts
git add -u lib/game
git commit -m "feat: add domain types and built-in word bank"
```

---

## Task 3: 规则纯函数

唱票、并列最高票、随机选取、胜负判定。这是整局最容易出错也最容易测的部分，先把它锁死。

**Files:**
- Create: `lib/game/rules.ts`
- Test: `tests/game/rules.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `Seat`、`VoteEntry`、`Winner`。
- Produces:
  - `tallyVotes(votes: VoteEntry[]): Record<number, number>`
  - `topCandidates(tally: Record<number, number>): number[]`（按座位号升序；空票池返回 `[]`）
  - `pickRandom<T>(items: T[], rng: () => number): T`
  - `checkWinner(seats: Seat[]): Winner | null`

- [ ] **Step 1: 写失败测试 `tests/game/rules.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { checkWinner, pickRandom, tallyVotes, topCandidates } from '@/lib/game/rules';
import type { Role, Seat, VoteEntry } from '@/lib/game/types';

function vote(seatId: number, targetSeatId: number): VoteEntry {
  return { kind: 'vote', round: 1, seatId, targetSeatId, reason: '理由', fallback: false };
}

function seat(id: number, role: Role, alive: boolean): Seat {
  return {
    id,
    name: `P${id}`,
    personaId: `p${id}`,
    personaLabel: '标签',
    role,
    word: role === 'undercover' ? '豆浆' : '牛奶',
    alive,
  };
}

describe('tallyVotes', () => {
  it('按被投座位累计票数', () => {
    expect(tallyVotes([vote(0, 2), vote(1, 2), vote(3, 1)])).toEqual({ 2: 2, 1: 1 });
  });

  it('空投票返回空对象', () => {
    expect(tallyVotes([])).toEqual({});
  });
});

describe('topCandidates', () => {
  it('唯一最高票只返回一个座位', () => {
    expect(topCandidates({ 2: 2, 1: 1 })).toEqual([2]);
  });

  it('并列最高票按座位号升序返回全部', () => {
    expect(topCandidates({ 3: 1, 0: 1, 2: 1 })).toEqual([0, 2, 3]);
  });

  it('空票池返回空数组', () => {
    expect(topCandidates({})).toEqual([]);
  });
});

describe('pickRandom', () => {
  it('按 rng 落点取元素', () => {
    expect(pickRandom([10, 20, 30], () => 0)).toBe(10);
    expect(pickRandom([10, 20, 30], () => 0.9)).toBe(30);
  });

  it('rng 返回 1 时不越界', () => {
    expect(pickRandom([10, 20], () => 1)).toBe(20);
  });

  it('空列表抛错', () => {
    expect(() => pickRandom([], () => 0)).toThrow('无法从空列表中随机选取');
  });
});

describe('checkWinner', () => {
  it('卧底出局时平民胜', () => {
    const seats = [
      seat(0, 'civilian', true),
      seat(1, 'civilian', true),
      seat(2, 'civilian', true),
      seat(3, 'undercover', false),
    ];
    expect(checkWinner(seats)).toBe('civilians');
  });

  it('只剩 2 人且含卧底时卧底胜', () => {
    const seats = [
      seat(0, 'civilian', true),
      seat(1, 'civilian', false),
      seat(2, 'civilian', false),
      seat(3, 'undercover', true),
    ];
    expect(checkWinner(seats)).toBe('undercover');
  });

  it('4 人全活时未分胜负', () => {
    const seats = [
      seat(0, 'civilian', true),
      seat(1, 'civilian', true),
      seat(2, 'civilian', true),
      seat(3, 'undercover', true),
    ];
    expect(checkWinner(seats)).toBeNull();
  });

  it('3 人存活且卧底还在时未分胜负', () => {
    const seats = [
      seat(0, 'civilian', true),
      seat(1, 'civilian', true),
      seat(2, 'civilian', false),
      seat(3, 'undercover', true),
    ];
    expect(checkWinner(seats)).toBeNull();
  });

  it('座位里没有卧底时抛错', () => {
    expect(() => checkWinner([seat(0, 'civilian', true)])).toThrow('座位中没有卧底');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/game/rules.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/game/rules"`。

- [ ] **Step 3: 写 `lib/game/rules.ts`**

```ts
import type { Seat, VoteEntry, Winner } from '@/lib/game/types';

export function tallyVotes(votes: VoteEntry[]): Record<number, number> {
  const tally: Record<number, number> = {};
  for (const vote of votes) {
    tally[vote.targetSeatId] = (tally[vote.targetSeatId] ?? 0) + 1;
  }
  return tally;
}

export function topCandidates(tally: Record<number, number>): number[] {
  const entries = Object.entries(tally).map(([seatId, count]) => [Number(seatId), count] as const);
  if (entries.length === 0) {
    return [];
  }
  const highest = Math.max(...entries.map(([, count]) => count));
  return entries
    .filter(([, count]) => count === highest)
    .map(([seatId]) => seatId)
    .sort((a, b) => a - b);
}

export function pickRandom<T>(items: T[], rng: () => number): T {
  if (items.length === 0) {
    throw new Error('无法从空列表中随机选取');
  }
  return items[Math.min(Math.floor(rng() * items.length), items.length - 1)];
}

export function checkWinner(seats: Seat[]): Winner | null {
  const undercover = seats.find((seat) => seat.role === 'undercover');
  if (!undercover) {
    throw new Error('座位中没有卧底，游戏状态非法');
  }
  if (!undercover.alive) {
    return 'civilians';
  }
  return seats.filter((seat) => seat.alive).length <= 2 ? 'undercover' : null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/game/rules.test.ts`
Expected: PASS，`13 passed`。

- [ ] **Step 5: Commit**

```bash
git add lib/game/rules.ts tests/game/rules.test.ts
git commit -m "feat: add pure game rules for tally, tie detection and win check"
```

---

## Task 4: GameState 创建、突变与视图投影

建局发词（3 平民同词 + 1 卧底异词）、记录日志的突变辅助，以及三种投影：公开视图、上帝视角、Agent 私有视图。**这里落地「私有词不泄露」这条硬性要求。**

**Files:**
- Create: `lib/game/state.ts`
- Test: `tests/game/state.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `GameState`、`Seat`、`Persona`、`WordPair`、`SEAT_COUNT`、`PublicGameView`、`GodGameView`、`AgentView`、`RevealSeat`、各类 `LogEntry`。
- Produces:
  - `createGame(input: CreateGameInput): GameState`，其中 `interface CreateGameInput { gameId: string; personas: Persona[]; pair: WordPair; undercoverSeatId: number }`
  - `aliveSeats(state: GameState): Seat[]`
  - `seatById(state: GameState, seatId: number): Seat`
  - `recordSpeech(state: GameState, entry: SpeechEntry): void`
  - `recordVote(state: GameState, entry: VoteEntry): void`
  - `eliminate(state: GameState, seatId: number, tieBreak: boolean): void`
  - `revealOf(state: GameState): RevealSeat[]`
  - `toPublicView(state: GameState): PublicGameView`
  - `toGodView(state: GameState): GodGameView`
  - `buildAgentView(state: GameState, seatId: number): AgentView`

- [ ] **Step 1: 写失败测试 `tests/game/state.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import {
  aliveSeats,
  buildAgentView,
  createGame,
  eliminate,
  recordSpeech,
  recordVote,
  revealOf,
  seatById,
  toGodView,
  toPublicView,
} from '@/lib/game/state';
import type { GameState, Persona, WordPair } from '@/lib/game/types';

const PAIR: WordPair = { civilian: '牛奶', undercover: '豆浆' };

const PERSONAS: Persona[] = [0, 1, 2, 3].map((id) => ({
  id: `persona-${id}`,
  name: `玩家${id}`,
  label: `人设${id}`,
  systemPrompt: `你是玩家${id}`,
}));

function newGame(undercoverSeatId = 2): GameState {
  return createGame({ gameId: 'g-1', personas: PERSONAS, pair: PAIR, undercoverSeatId });
}

describe('createGame', () => {
  it('生成 4 个座位，1 个卧底 3 个平民', () => {
    const state = newGame();
    expect(state.seats).toHaveLength(4);
    expect(state.seats.filter((seat) => seat.role === 'undercover')).toHaveLength(1);
    expect(state.seats.filter((seat) => seat.role === 'civilian')).toHaveLength(3);
  });

  it('平民拿同一个词，卧底拿另一个词', () => {
    const state = newGame(2);
    expect(state.seats.map((seat) => seat.word)).toEqual(['牛奶', '牛奶', '豆浆', '牛奶']);
  });

  it('初始阶段是 setup，轮次为 0，日志为空', () => {
    const state = newGame();
    expect(state.phase).toBe('setup');
    expect(state.round).toBe(0);
    expect(state.activeSeatId).toBeNull();
    expect(state.log).toEqual([]);
    expect(state.winner).toBeNull();
    expect(state.errorMessage).toBeNull();
  });

  it('persona 数量不是 4 时抛错', () => {
    expect(() =>
      createGame({ gameId: 'g', personas: PERSONAS.slice(0, 3), pair: PAIR, undercoverSeatId: 0 }),
    ).toThrow('需要 4 个 persona');
  });

  it('卧底座位号越界时抛错', () => {
    expect(() =>
      createGame({ gameId: 'g', personas: PERSONAS, pair: PAIR, undercoverSeatId: 4 }),
    ).toThrow('卧底座位号越界');
  });
});

describe('突变辅助', () => {
  it('recordSpeech / recordVote 按顺序追加日志', () => {
    const state = newGame();
    state.round = 1;
    recordSpeech(state, { kind: 'speech', round: 1, seatId: 0, text: '白白的', fallback: false });
    recordVote(state, {
      kind: 'vote',
      round: 1,
      seatId: 0,
      targetSeatId: 2,
      reason: '他很虚',
      fallback: false,
    });
    expect(state.log.map((entry) => entry.kind)).toEqual(['speech', 'vote']);
  });

  it('eliminate 把座位置为出局并写一条 elimination 日志', () => {
    const state = newGame();
    state.round = 1;
    eliminate(state, 2, true);
    expect(seatById(state, 2).alive).toBe(false);
    expect(state.log.at(-1)).toEqual({ kind: 'elimination', round: 1, seatId: 2, tieBreak: true });
    expect(aliveSeats(state).map((seat) => seat.id)).toEqual([0, 1, 3]);
  });

  it('seatById 对不存在的座位抛错', () => {
    expect(() => seatById(newGame(), 9)).toThrow('座位 9 不存在');
  });
});

describe('toPublicView', () => {
  it('座位只暴露 id / name / personaLabel / alive 四个字段', () => {
    const view = toPublicView(newGame());
    for (const seat of view.seats) {
      expect(Object.keys(seat).sort()).toEqual(['alive', 'id', 'name', 'personaLabel']);
    }
  });

  it('序列化后不含任何私有词与 role 字段', () => {
    const serialized = JSON.stringify(toPublicView(newGame()));
    expect(serialized).not.toContain(PAIR.civilian);
    expect(serialized).not.toContain(PAIR.undercover);
    expect(serialized).not.toContain('"role"');
  });

  it('日志被完整带上', () => {
    const state = newGame();
    state.round = 1;
    recordSpeech(state, { kind: 'speech', round: 1, seatId: 0, text: '白白的', fallback: false });
    expect(toPublicView(state).log).toHaveLength(1);
  });
});

describe('toGodView / revealOf', () => {
  it('上帝视角额外给出每个座位的身份与词', () => {
    const state = newGame(2);
    expect(revealOf(state)).toEqual([
      { seatId: 0, role: 'civilian', word: '牛奶' },
      { seatId: 1, role: 'civilian', word: '牛奶' },
      { seatId: 2, role: 'undercover', word: '豆浆' },
      { seatId: 3, role: 'civilian', word: '牛奶' },
    ]);
    expect(toGodView(state).reveal).toHaveLength(4);
    expect(toGodView(state).seats).toEqual(toPublicView(state).seats);
  });
});

describe('buildAgentView', () => {
  it('只给出自己的词和公开信息', () => {
    const state = newGame(2);
    const view = buildAgentView(state, 2);
    expect(view.seatId).toBe(2);
    expect(view.seatName).toBe('玩家2');
    expect(view.word).toBe('豆浆');
    expect(JSON.stringify(view.seats)).not.toContain('牛奶');
    expect(view.aliveOtherIds).toEqual([0, 1, 3]);
  });

  it('出局的人不出现在 aliveOtherIds 里', () => {
    const state = newGame(2);
    state.round = 1;
    eliminate(state, 1, false);
    expect(buildAgentView(state, 2).aliveOtherIds).toEqual([0, 3]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/game/state.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/game/state"`。

- [ ] **Step 3: 写 `lib/game/state.ts`**

```ts
import {
  SEAT_COUNT,
  type AgentView,
  type GameState,
  type GodGameView,
  type Persona,
  type PublicGameView,
  type PublicSeat,
  type RevealSeat,
  type Seat,
  type SpeechEntry,
  type VoteEntry,
  type WordPair,
} from '@/lib/game/types';

export interface CreateGameInput {
  gameId: string;
  personas: Persona[];
  pair: WordPair;
  undercoverSeatId: number;
}

export function createGame(input: CreateGameInput): GameState {
  if (input.personas.length !== SEAT_COUNT) {
    throw new Error(`需要 ${SEAT_COUNT} 个 persona，实际收到 ${input.personas.length} 个`);
  }
  if (!Number.isInteger(input.undercoverSeatId) || input.undercoverSeatId < 0 || input.undercoverSeatId >= SEAT_COUNT) {
    throw new Error(`卧底座位号越界：${input.undercoverSeatId}`);
  }

  const seats: Seat[] = input.personas.map((persona, id) => {
    const isUndercover = id === input.undercoverSeatId;
    const seat: Seat = {
      id,
      name: persona.name,
      personaId: persona.id,
      personaLabel: persona.label,
      role: isUndercover ? 'undercover' : 'civilian',
      word: isUndercover ? input.pair.undercover : input.pair.civilian,
      alive: true,
    };
    return seat;
  });

  return {
    gameId: input.gameId,
    seats,
    round: 0,
    phase: 'setup',
    activeSeatId: null,
    log: [],
    winner: null,
    errorMessage: null,
  };
}

export function aliveSeats(state: GameState): Seat[] {
  return state.seats.filter((seat) => seat.alive);
}

export function seatById(state: GameState, seatId: number): Seat {
  const seat = state.seats.find((candidate) => candidate.id === seatId);
  if (!seat) {
    throw new Error(`座位 ${seatId} 不存在`);
  }
  return seat;
}

export function recordSpeech(state: GameState, entry: SpeechEntry): void {
  state.log.push(entry);
}

export function recordVote(state: GameState, entry: VoteEntry): void {
  state.log.push(entry);
}

export function eliminate(state: GameState, seatId: number, tieBreak: boolean): void {
  seatById(state, seatId).alive = false;
  state.log.push({ kind: 'elimination', round: state.round, seatId, tieBreak });
}

export function revealOf(state: GameState): RevealSeat[] {
  return state.seats.map((seat) => ({ seatId: seat.id, role: seat.role, word: seat.word }));
}

function toPublicSeats(state: GameState): PublicSeat[] {
  return state.seats.map((seat) => ({
    id: seat.id,
    name: seat.name,
    personaLabel: seat.personaLabel,
    alive: seat.alive,
  }));
}

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
  };
}

export function toGodView(state: GameState): GodGameView {
  return { ...toPublicView(state), reveal: revealOf(state) };
}

export function buildAgentView(state: GameState, seatId: number): AgentView {
  const seat = seatById(state, seatId);
  return {
    seatId: seat.id,
    seatName: seat.name,
    word: seat.word,
    round: state.round,
    seats: toPublicSeats(state),
    log: [...state.log],
    aliveOtherIds: aliveSeats(state)
      .filter((candidate) => candidate.id !== seatId)
      .map((candidate) => candidate.id),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/game/state.test.ts`
Expected: PASS，`14 passed`。

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部 PASS，typecheck 无输出。

- [ ] **Step 6: Commit**

```bash
git add lib/game/state.ts tests/game/state.test.ts
git commit -m "feat: add game state creation, mutations and leak-free view projections"
```

---

## Task 5: LLM 客户端接口与智谱封装

定义 Judge/Agent 唯一依赖的 `LlmClient` 接口，并实现智谱 BigModel chat completions 封装：请求超时、429/5xx/网络错误指数退避重试最多 2 次、4xx 立即失败、缺 Key 抛可读错误。

**Files:**
- Create: `lib/llm/types.ts`
- Create: `lib/llm/zhipu.ts`
- Test: `tests/llm/zhipu.test.ts`

**Interfaces:**
- Consumes: 无（独立模块）。
- Produces:
  - `interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string }`
  - `interface LlmCompleteOptions { temperature?: number; maxTokens?: number }`
  - `interface LlmClient { complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<string> }`
  - `class LlmError extends Error { readonly status?: number }`
  - `class MissingApiKeyError extends Error`
  - `readZhipuConfigFromEnv(env: NodeJS.ProcessEnv): { apiKey: string; model: string }`
  - `createZhipuClient(options: ZhipuClientOptions): LlmClient`，`interface ZhipuClientOptions { apiKey: string; model: string; baseUrl?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number; timeoutMs?: number }`
  - `ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'`
  - `ZHIPU_DEFAULT_MODEL = 'glm-4-flash'`

- [ ] **Step 1: 写 `lib/llm/types.ts`**

这个文件只有接口和一个错误类，实现由 `zhipu.ts` 提供、由 Task 5 的测试覆盖。

```ts
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LlmClient {
  complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<string>;
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

- [ ] **Step 2: 写失败测试 `tests/llm/zhipu.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  MissingApiKeyError,
  ZHIPU_DEFAULT_BASE_URL,
  createZhipuClient,
  readZhipuConfigFromEnv,
} from '@/lib/llm/zhipu';

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
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

describe('readZhipuConfigFromEnv', () => {
  it('读取 key 与 model', () => {
    expect(readZhipuConfigFromEnv({ ZHIPU_API_KEY: 'k', ZHIPU_MODEL: 'glm-4-plus' })).toEqual({
      apiKey: 'k',
      model: 'glm-4-plus',
    });
  });

  it('未配置 ZHIPU_MODEL 时回退到 glm-4-flash', () => {
    expect(readZhipuConfigFromEnv({ ZHIPU_API_KEY: 'k' }).model).toBe('glm-4-flash');
  });

  it('缺少 ZHIPU_API_KEY 时抛 MissingApiKeyError', () => {
    expect(() => readZhipuConfigFromEnv({})).toThrow(MissingApiKeyError);
    expect(() => readZhipuConfigFromEnv({ ZHIPU_API_KEY: '   ' })).toThrow('缺少 ZHIPU_API_KEY');
  });
});

describe('createZhipuClient', () => {
  it('把消息发到 chat/completions 并返回首个 choice 的文本', async () => {
    const fetchImpl = vi.fn(async () => okResponse('白白的液体'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const text = await client.complete([{ role: 'user', content: '描述一下' }], {
      temperature: 0.2,
    });

    expect(text).toBe('白白的液体');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ZHIPU_DEFAULT_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'glm-4-flash',
      temperature: 0.2,
      stream: false,
      messages: [{ role: 'user', content: '描述一下' }],
    });
  });

  it('429 后退避重试并最终成功，退避是 500ms / 1000ms', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse('成功'));
    const { client, sleep } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toBe('成功');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });

  it('一直 500 时最多请求 3 次后抛错', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow('智谱接口返回 500');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('400 不重试', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(400));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow('智谱接口返回 400');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('网络异常会重试', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse('恢复了'));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).resolves.toBe('恢复了');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('返回空内容视为可重试失败', async () => {
    const fetchImpl = vi.fn(async () => okResponse('   '));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow('智谱接口返回了空内容');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/llm/zhipu.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/llm/zhipu"`。

- [ ] **Step 4: 写 `lib/llm/zhipu.ts`**

```ts
import { LlmError, type LlmClient, type LlmCompleteOptions, type LlmMessage } from '@/lib/llm/types';

export const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const ZHIPU_DEFAULT_MODEL = 'glm-4-flash';

const RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 400;

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

export function readZhipuConfigFromEnv(env: NodeJS.ProcessEnv): ZhipuConfig {
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

/** 429 / 5xx / 网络错误 / 超时都值得重试；其余 4xx 是我们自己的请求有问题，重试没意义。 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof LlmError && error.status !== undefined) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

export function createZhipuClient(options: ZhipuClientOptions): LlmClient {
  const baseUrl = options.baseUrl ?? ZHIPU_DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function attempt(messages: LlmMessage[], completeOptions?: LlmCompleteOptions): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
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
        const body = await response.text();
        throw new LlmError(`智谱接口返回 ${response.status}：${body.slice(0, 200)}`, response.status);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new LlmError('智谱接口返回了空内容');
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
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
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/llm/zhipu.test.ts`
Expected: PASS，`9 passed`。

- [ ] **Step 6: Commit**

```bash
git add lib/llm tests/llm
git commit -m "feat: add zhipu llm client with backoff retry and env config"
```

---

## Task 6: 人设与 prompt 构造 / 回复解析

四套 system 人设，加上把 `AgentView` 变成 prompt、把模型回复解析成结构化结果的纯函数。**「不得念出词面」在这里用程序化校验落地**：发言里出现自己的词就判为不合格。

**Files:**
- Create: `lib/agents/personas.ts`
- Create: `lib/agents/prompt.ts`
- Test: `tests/agents/prompt.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `AgentView`、`Persona`、`LogEntry`；Task 5 的 `LlmMessage`。
- Produces:
  - `PERSONAS: Persona[]`（长度 4，id 依次为 `analyst` / `joker` / `striker` / `watcher`）
  - `renderTranscript(view: AgentView): string`
  - `buildSpeechMessages(persona: Persona, view: AgentView): LlmMessage[]`
  - `buildVoteMessages(persona: Persona, view: AgentView, candidateIds: number[]): LlmMessage[]`
  - `extractJsonObject(raw: string): Record<string, unknown> | null`
  - `parseSpeechReply(raw: string, forbiddenWord: string): string | null`
  - `parseVoteReply(raw: string, candidateIds: number[]): { targetSeatId: number; reason: string } | null`
  - `DEFAULT_VOTE_REASON = '（没有说明理由）'`

- [ ] **Step 1: 写 `lib/agents/personas.ts`**

```ts
import type { Persona } from '@/lib/game/types';

export const PERSONAS: Persona[] = [
  {
    id: 'analyst',
    name: '阿岚',
    label: '谨慎分析',
    systemPrompt:
      '你叫阿岚，是「谁是卧底」里最克制的玩家。你说话讲逻辑，习惯先对比再排除，不轻易下结论。你只输出合法 JSON，不写任何解释性前后缀，不使用 Markdown 代码块。',
  },
  {
    id: 'joker',
    name: '小柯',
    label: '幽默带节奏',
    systemPrompt:
      '你叫小柯，是「谁是卧底」里最会活跃气氛的玩家。你爱用轻松的比喻描述事物，也会顺势把怀疑抛给别人。你只输出合法 JSON，不写任何解释性前后缀，不使用 Markdown 代码块。',
  },
  {
    id: 'striker',
    name: '雷子',
    label: '激进带节奏',
    systemPrompt:
      '你叫雷子，是「谁是卧底」里最敢咬人的玩家。你强势表态、推动大家投票，但绝不编造别人没说过的话。你只输出合法 JSON，不写任何解释性前后缀，不使用 Markdown 代码块。',
  },
  {
    id: 'watcher',
    name: '沉舟',
    label: '少话观察',
    systemPrompt:
      '你叫沉舟，是「谁是卧底」里最沉默的玩家。你的发言尽量短，把观察到的细节留到投票时才说。你只输出合法 JSON，不写任何解释性前后缀，不使用 Markdown 代码块。',
  },
];
```

- [ ] **Step 2: 写失败测试 `tests/agents/prompt.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { PERSONAS } from '@/lib/agents/personas';
import {
  DEFAULT_VOTE_REASON,
  buildSpeechMessages,
  buildVoteMessages,
  extractJsonObject,
  parseSpeechReply,
  parseVoteReply,
  renderTranscript,
} from '@/lib/agents/prompt';
import type { AgentView } from '@/lib/game/types';

const VIEW: AgentView = {
  seatId: 2,
  seatName: '雷子',
  word: '豆浆',
  round: 2,
  seats: [
    { id: 0, name: '阿岚', personaLabel: '谨慎分析', alive: true },
    { id: 1, name: '小柯', personaLabel: '幽默带节奏', alive: false },
    { id: 2, name: '雷子', personaLabel: '激进带节奏', alive: true },
    { id: 3, name: '沉舟', personaLabel: '少话观察', alive: true },
  ],
  log: [
    { kind: 'speech', round: 1, seatId: 0, text: '白白的，早上喝', fallback: false },
    { kind: 'vote', round: 1, seatId: 0, targetSeatId: 1, reason: '他太笼统', fallback: false },
    { kind: 'elimination', round: 1, seatId: 1, tieBreak: true },
  ],
  aliveOtherIds: [0, 3],
};

describe('PERSONAS', () => {
  it('恰好 4 套人设，id 与名字都不重复', () => {
    expect(PERSONAS).toHaveLength(4);
    expect(new Set(PERSONAS.map((persona) => persona.id)).size).toBe(4);
    expect(new Set(PERSONAS.map((persona) => persona.name)).size).toBe(4);
  });
});

describe('renderTranscript', () => {
  it('把三类日志渲染成带玩家名的中文行', () => {
    expect(renderTranscript(VIEW)).toBe(
      [
        '第1轮 发言 阿岚：白白的，早上喝',
        '第1轮 投票 阿岚 → 小柯，理由：他太笼统',
        '第1轮 出局：小柯（平票随机）',
      ].join('\n'),
    );
  });

  it('没有记录时给出占位文案', () => {
    expect(renderTranscript({ ...VIEW, log: [] })).toBe('（暂无公开记录）');
  });
});

describe('buildSpeechMessages', () => {
  it('第一条是人设 system，第二条 user 含自己的词、轮次与公开记录', () => {
    const messages = buildSpeechMessages(PERSONAS[2], VIEW);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'system', content: PERSONAS[2].systemPrompt });
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('你拿到的词是「豆浆」');
    expect(messages[1].content).toContain('第 2 轮发言');
    expect(messages[1].content).toContain('白白的，早上喝');
    expect(messages[1].content).toContain('{"speech":"你的发言"}');
    expect(messages[1].content).toContain('1=小柯（已出局）');
  });
});

describe('buildVoteMessages', () => {
  it('user 消息里只列出候选座位', () => {
    const messages = buildVoteMessages(PERSONAS[2], VIEW, [0, 3]);
    expect(messages[1].content).toContain('可投的座位号：0（阿岚）、3（沉舟）');
    expect(messages[1].content).toContain('{"vote":0,"reason":"一句话理由"}');
    expect(messages[1].content).not.toContain('2（雷子）');
  });
});

describe('extractJsonObject', () => {
  it('解析裸 JSON', () => {
    expect(extractJsonObject('{"speech":"白白的"}')).toEqual({ speech: '白白的' });
  });

  it('剥掉 Markdown 代码块与前后废话', () => {
    expect(extractJsonObject('好的：\n```json\n{"speech":"白白的"}\n```\n')).toEqual({
      speech: '白白的',
    });
  });

  it('不是 JSON 时返回 null', () => {
    expect(extractJsonObject('我觉得是 1 号')).toBeNull();
  });

  it('JSON 数组不算合法对象', () => {
    expect(extractJsonObject('[1,2]')).toBeNull();
  });
});

describe('parseSpeechReply', () => {
  it('取出 speech 并去掉首尾空白', () => {
    expect(parseSpeechReply('{"speech":"  白白的，早上喝  "}', '豆浆')).toBe('白白的，早上喝');
  });

  it('发言里出现自己的词时判为不合格', () => {
    expect(parseSpeechReply('{"speech":"我的词是豆浆"}', '豆浆')).toBeNull();
  });

  it('speech 缺失或为空时返回 null', () => {
    expect(parseSpeechReply('{"speech":""}', '豆浆')).toBeNull();
    expect(parseSpeechReply('{"reason":"x"}', '豆浆')).toBeNull();
    expect(parseSpeechReply('不是 JSON', '豆浆')).toBeNull();
  });
});

describe('parseVoteReply', () => {
  it('取出合法候选与理由', () => {
    expect(parseVoteReply('{"vote":3,"reason":"他最虚"}', [0, 3])).toEqual({
      targetSeatId: 3,
      reason: '他最虚',
    });
  });

  it('座位号是数字字符串也接受', () => {
    expect(parseVoteReply('{"vote":"0","reason":"稳"}', [0, 3])).toEqual({
      targetSeatId: 0,
      reason: '稳',
    });
  });

  it('缺理由时补默认理由', () => {
    expect(parseVoteReply('{"vote":0}', [0, 3])).toEqual({
      targetSeatId: 0,
      reason: DEFAULT_VOTE_REASON,
    });
  });

  it('投了不在候选里的座位时返回 null', () => {
    expect(parseVoteReply('{"vote":2,"reason":"就他"}', [0, 3])).toBeNull();
  });

  it('不是 JSON 时返回 null', () => {
    expect(parseVoteReply('我投 3 号', [0, 3])).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/agents/prompt.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/agents/prompt"`。

- [ ] **Step 4: 写 `lib/agents/prompt.ts`**

```ts
import type { AgentView, Persona, PublicSeat } from '@/lib/game/types';
import type { LlmMessage } from '@/lib/llm/types';

export const DEFAULT_VOTE_REASON = '（没有说明理由）';

function nameOf(seats: PublicSeat[], seatId: number): string {
  return seats.find((seat) => seat.id === seatId)?.name ?? `座位${seatId}`;
}

export function renderTranscript(view: AgentView): string {
  if (view.log.length === 0) {
    return '（暂无公开记录）';
  }
  return view.log
    .map((entry) => {
      switch (entry.kind) {
        case 'speech':
          return `第${entry.round}轮 发言 ${nameOf(view.seats, entry.seatId)}：${entry.text}`;
        case 'vote':
          return `第${entry.round}轮 投票 ${nameOf(view.seats, entry.seatId)} → ${nameOf(
            view.seats,
            entry.targetSeatId,
          )}，理由：${entry.reason}`;
        case 'elimination':
          return `第${entry.round}轮 出局：${nameOf(view.seats, entry.seatId)}${
            entry.tieBreak ? '（平票随机）' : ''
          }`;
      }
    })
    .join('\n');
}

function renderRoster(view: AgentView): string {
  return view.seats
    .map((seat) => `${seat.id}=${seat.name}${seat.alive ? '' : '（已出局）'}`)
    .join('，');
}

const RULES_BRIEF =
  '你正在玩「谁是卧底」。全场 4 人，其中 3 名平民拿到同一个词，1 名卧底拿到一个近义但不同的词。没有人知道自己是不是卧底。';

export function buildSpeechMessages(persona: Persona, view: AgentView): LlmMessage[] {
  return [
    { role: 'system', content: persona.systemPrompt },
    {
      role: 'user',
      content: [
        RULES_BRIEF,
        `你是 ${view.seatName}（座位 ${view.seatId}）。你拿到的词是「${view.word}」。`,
        `座位表：${renderRoster(view)}`,
        `现在是第 ${view.round} 轮发言。到目前为止的公开记录：`,
        renderTranscript(view),
        '要求：用 1~3 句话描述你手里的词，可以结合别人的发言。绝对不能写出词面本身，也不能拆字或拼音暗示；不要复述别人的原句。',
        '只输出 JSON，格式严格为：{"speech":"你的发言"}',
      ].join('\n'),
    },
  ];
}

export function buildVoteMessages(
  persona: Persona,
  view: AgentView,
  candidateIds: number[],
): LlmMessage[] {
  const candidates = candidateIds
    .map((seatId) => `${seatId}（${nameOf(view.seats, seatId)}）`)
    .join('、');
  return [
    { role: 'system', content: persona.systemPrompt },
    {
      role: 'user',
      content: [
        RULES_BRIEF,
        `你是 ${view.seatName}（座位 ${view.seatId}）。你拿到的词是「${view.word}」。`,
        `座位表：${renderRoster(view)}`,
        `现在是第 ${view.round} 轮投票。到目前为止的公开记录：`,
        renderTranscript(view),
        `可投的座位号：${candidates}。你必须从中选一个，不能弃票，不能投自己。`,
        '只输出 JSON，格式严格为：{"vote":0,"reason":"一句话理由"}',
      ].join('\n'),
    },
  ];
}

export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const withoutFence = raw.replace(/```(?:json)?/gi, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(withoutFence.slice(start, end + 1));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseSpeechReply(raw: string, forbiddenWord: string): string | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return null;
  }
  const speech = parsed.speech;
  if (typeof speech !== 'string') {
    return null;
  }
  const text = speech.trim();
  if (text === '' || text.includes(forbiddenWord)) {
    return null;
  }
  return text;
}

export function parseVoteReply(
  raw: string,
  candidateIds: number[],
): { targetSeatId: number; reason: string } | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return null;
  }
  const rawVote = parsed.vote;
  const targetSeatId =
    typeof rawVote === 'number' ? rawVote : typeof rawVote === 'string' ? Number(rawVote) : Number.NaN;
  if (!Number.isInteger(targetSeatId) || !candidateIds.includes(targetSeatId)) {
    return null;
  }
  const rawReason = parsed.reason;
  const reason = typeof rawReason === 'string' && rawReason.trim() !== '' ? rawReason.trim() : DEFAULT_VOTE_REASON;
  return { targetSeatId, reason };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/agents/prompt.test.ts`
Expected: PASS，`17 passed`。

- [ ] **Step 6: Commit**

```bash
git add lib/agents tests/agents
git commit -m "feat: add personas, prompt builders and reply parsers"
```

---

## Task 7: PlayerAgent（重试一次 + 兜底）

把 prompt 构造、LLM 调用、解析、重试、兜底串成实现 `SeatAgent` 接口的 `PlayerAgent`。规则：**每个动作最多请求模型 2 次**（第一次不合格或抛错就再来一次），仍失败则兜底并把 `fallback` 标为 `true`。

**Files:**
- Create: `lib/agents/player-agent.ts`
- Test: `tests/agents/player-agent.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `AgentView` / `SeatAgent` / `SpeechResult` / `VoteResult` / `Persona`；Task 3 的 `pickRandom`；Task 5 的 `LlmClient`；Task 6 的 `PERSONAS` / `buildSpeechMessages` / `buildVoteMessages` / `parseSpeechReply` / `parseVoteReply`。
- Produces:
  - `class PlayerAgent implements SeatAgent`，构造签名 `new PlayerAgent(persona: Persona, deps: PlayerAgentDeps)`
  - `interface PlayerAgentDeps { llm: LlmClient; temperature?: number }`
  - `FALLBACK_SPEECH = '（本轮没有给出有效发言）'`
  - `FALLBACK_VOTE_REASON = '（模型没有给出有效投票，已随机选择）'`
  - `AGENT_MAX_ATTEMPTS = 2`

- [ ] **Step 1: 写失败测试 `tests/agents/player-agent.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

import { PERSONAS } from '@/lib/agents/personas';
import {
  FALLBACK_SPEECH,
  FALLBACK_VOTE_REASON,
  PlayerAgent,
} from '@/lib/agents/player-agent';
import type { AgentView } from '@/lib/game/types';
import type { LlmClient } from '@/lib/llm/types';

const VIEW: AgentView = {
  seatId: 2,
  seatName: '雷子',
  word: '豆浆',
  round: 1,
  seats: [
    { id: 0, name: '阿岚', personaLabel: '谨慎分析', alive: true },
    { id: 1, name: '小柯', personaLabel: '幽默带节奏', alive: true },
    { id: 2, name: '雷子', personaLabel: '激进带节奏', alive: true },
    { id: 3, name: '沉舟', personaLabel: '少话观察', alive: true },
  ],
  log: [],
  aliveOtherIds: [0, 1, 3],
};

function scriptedLlm(replies: Array<string | Error>): LlmClient & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async () => {
    const next = replies.shift();
    if (next === undefined) {
      throw new Error('脚本用尽：不应该再调用模型');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  return { complete } as unknown as LlmClient & { complete: ReturnType<typeof vi.fn> };
}

describe('PlayerAgent.speak', () => {
  it('第一次就合格时直接返回，只调用一次模型', async () => {
    const llm = scriptedLlm(['{"speech":"早上常喝的白色饮品"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早上常喝的白色饮品',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('首次输出念出词面时重试一次并采用第二次结果', async () => {
    const llm = scriptedLlm(['{"speech":"我的词就是豆浆"}', '{"speech":"早上常喝的白色饮品"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.speak(VIEW)).resolves.toEqual({
      text: '早上常喝的白色饮品',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('两次都不合格时兜底为空发言并标记 fallback', async () => {
    const llm = scriptedLlm(['乱七八糟', '还是乱七八糟']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.speak(VIEW)).resolves.toEqual({ text: FALLBACK_SPEECH, fallback: true });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('模型连续抛错时也兜底，不向外抛', async () => {
    const llm = scriptedLlm([new Error('网络炸了'), new Error('又炸了')]);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.speak(VIEW)).resolves.toEqual({ text: FALLBACK_SPEECH, fallback: true });
  });
});

describe('PlayerAgent.vote', () => {
  it('合法投票直接返回', async () => {
    const llm = scriptedLlm(['{"vote":1,"reason":"描述太笼统"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.vote(VIEW, [0, 1, 3], () => 0)).resolves.toEqual({
      targetSeatId: 1,
      reason: '描述太笼统',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('投了非候选座位时重试一次', async () => {
    const llm = scriptedLlm(['{"vote":2,"reason":"投自己"}', '{"vote":3,"reason":"他太安静"}']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.vote(VIEW, [0, 1, 3], () => 0)).resolves.toEqual({
      targetSeatId: 3,
      reason: '他太安静',
      fallback: false,
    });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('两次都不合格时按 rng 随机投一个合法候选', async () => {
    const llm = scriptedLlm(['不是 JSON', '还是不是 JSON']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.vote(VIEW, [0, 1, 3], () => 0.99)).resolves.toEqual({
      targetSeatId: 3,
      reason: FALLBACK_VOTE_REASON,
      fallback: true,
    });
  });

  it('候选为空时抛错（Judge 不应该这样调用）', async () => {
    const llm = scriptedLlm(['不是 JSON', '还是不是 JSON']);
    const agent = new PlayerAgent(PERSONAS[2], { llm });

    await expect(agent.vote(VIEW, [], () => 0)).rejects.toThrow('无法从空列表中随机选取');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agents/player-agent.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/agents/player-agent"`。

- [ ] **Step 3: 写 `lib/agents/player-agent.ts`**

```ts
import {
  buildSpeechMessages,
  buildVoteMessages,
  parseSpeechReply,
  parseVoteReply,
} from '@/lib/agents/prompt';
import { pickRandom } from '@/lib/game/rules';
import type { AgentView, Persona, SeatAgent, SpeechResult, VoteResult } from '@/lib/game/types';
import type { LlmClient } from '@/lib/llm/types';

export const FALLBACK_SPEECH = '（本轮没有给出有效发言）';
export const FALLBACK_VOTE_REASON = '（模型没有给出有效投票，已随机选择）';
export const AGENT_MAX_ATTEMPTS = 2;
const DEFAULT_AGENT_TEMPERATURE = 0.4;

export interface PlayerAgentDeps {
  llm: LlmClient;
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
      const raw = await this.tryComplete(messages);
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
      const raw = await this.tryComplete(messages);
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
  private async tryComplete(messages: Parameters<LlmClient['complete']>[0]): Promise<string | null> {
    try {
      return await this.deps.llm.complete(messages, {
        temperature: this.deps.temperature ?? DEFAULT_AGENT_TEMPERATURE,
      });
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agents/player-agent.test.ts`
Expected: PASS，`8 passed`。

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部 PASS，typecheck 无输出。

- [ ] **Step 6: Commit**

```bash
git add lib/agents/player-agent.ts tests/agents/player-agent.test.ts
git commit -m "feat: add player agent with single retry and deterministic fallbacks"
```

---

## Task 8: Judge 循环

裁判把一局跑完：`setup` → 循环（发言轮 → 投票轮 →（平票则重投一次，仍平则随机）→ 出局 → 判胜负）→ `result`。任何异常或硬超时都转成 `error` 事件并让 `runGame` 正常返回（不抛出），这样调用方不会挂起。

**Files:**
- Create: `lib/game/judge.ts`
- Test: `tests/game/judge.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `GameState` / `GameEvent` / `SeatAgent` / `SpeechEntry` / `VoteEntry` / `Phase`；Task 3 的 `checkWinner` / `pickRandom` / `tallyVotes` / `topCandidates`；Task 4 的 `aliveSeats` / `buildAgentView` / `eliminate` / `recordSpeech` / `recordVote` / `revealOf`。
- Produces:
  - `interface JudgeDeps { agents: Map<number, SeatAgent>; rng: () => number; emit: (event: GameEvent) => void; now: () => number; hardTimeoutMs?: number }`
  - `runGame(state: GameState, deps: JudgeDeps): Promise<GameState>`
  - `DEFAULT_HARD_TIMEOUT_MS = 180_000`
  - `MAX_VOTE_ROUNDS = 2`
  - `HARD_TIMEOUT_MESSAGE = '单局硬超时，已终止本局'`

- [ ] **Step 1: 写失败测试 `tests/game/judge.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

import { HARD_TIMEOUT_MESSAGE, runGame, type JudgeDeps } from '@/lib/game/judge';
import { createGame } from '@/lib/game/state';
import type { AgentView, GameEvent, Persona, SeatAgent } from '@/lib/game/types';

const PERSONAS: Persona[] = [0, 1, 2, 3].map((id) => ({
  id: `persona-${id}`,
  name: `玩家${id}`,
  label: `人设${id}`,
  systemPrompt: `你是玩家${id}`,
}));

/** 按脚本投票的假 agent：voteScript[callIndex] 给出这次要投谁；不在候选里就投候选第一个。 */
function scriptedAgent(seatId: number, voteScript: number[]): SeatAgent {
  let voteCall = 0;
  return {
    async speak(view: AgentView) {
      return { text: `我是${view.seatName}，第${view.round}轮发言`, fallback: false };
    },
    async vote(_view, candidateIds) {
      const wanted = voteScript[Math.min(voteCall, voteScript.length - 1)];
      voteCall += 1;
      return {
        targetSeatId: candidateIds.includes(wanted) ? wanted : candidateIds[0],
        reason: `座位${seatId}的理由`,
        fallback: false,
      };
    },
  };
}

function makeDeps(
  voteScripts: Record<number, number[]>,
  overrides: Partial<JudgeDeps> = {},
): { deps: JudgeDeps; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const agents = new Map<number, SeatAgent>(
    [0, 1, 2, 3].map((seatId) => [seatId, scriptedAgent(seatId, voteScripts[seatId] ?? [0])]),
  );
  const deps: JudgeDeps = {
    agents,
    rng: () => 0,
    now: () => 0,
    emit: (event) => events.push(event),
    ...overrides,
  };
  return { deps, events };
}

function newGame() {
  return createGame({
    gameId: 'g-1',
    personas: PERSONAS,
    pair: { civilian: '牛奶', undercover: '豆浆' },
    undercoverSeatId: 3,
  });
}

describe('runGame', () => {
  it('所有人投卧底时平民一轮取胜', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    const state = await runGame(newGame(), deps);

    expect(state.winner).toBe('civilians');
    expect(state.phase).toBe('result');
    expect(state.round).toBe(1);
    expect(state.seats[3].alive).toBe(false);
  });

  it('每个存活者每轮都发一次言', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    await runGame(newGame(), deps);

    const speeches = events.filter((event) => event.type === 'speech');
    expect(speeches).toHaveLength(4);
    expect(speeches.map((event) => (event.type === 'speech' ? event.seatId : -1))).toEqual([0, 1, 2, 3]);
  });

  it('结束时推一条带 winner 与 reveal 的 result 事件', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    await runGame(newGame(), deps);

    const results = events.filter((event) => event.type === 'result');
    expect(results).toHaveLength(1);
    const last = results[0];
    if (last.type !== 'result') {
      throw new Error('类型断言失败');
    }
    expect(last.eliminatedSeatId).toBe(3);
    expect(last.tieBreak).toBe(false);
    expect(last.winner).toBe('civilians');
    expect(last.reveal).toEqual([
      { seatId: 0, role: 'civilian', word: '牛奶' },
      { seatId: 1, role: 'civilian', word: '牛奶' },
      { seatId: 2, role: 'civilian', word: '牛奶' },
      { seatId: 3, role: 'undercover', word: '豆浆' },
    ]);
  });

  it('未结束的 result 事件不带 reveal', async () => {
    const { deps, events } = makeDeps({ 0: [1, 2], 1: [0, 2], 2: [0, 0], 3: [1, 2] });
    await runGame(newGame(), deps);

    const results = events.filter((event) => event.type === 'result');
    expect(results.length).toBeGreaterThan(1);
    const first = results[0];
    if (first.type !== 'result') {
      throw new Error('类型断言失败');
    }
    expect(first.winner).toBeNull();
    expect(first.reveal).toBeNull();
  });

  it('连续淘汰两名平民后卧底胜', async () => {
    const { deps } = makeDeps({ 0: [1, 2], 1: [0, 2], 2: [0, 0], 3: [1, 2] });
    const state = await runGame(newGame(), deps);

    expect(state.winner).toBe('undercover');
    expect(state.seats.filter((seat) => seat.alive)).toHaveLength(2);
  });

  it('首轮平票时重投一轮，重投出唯一最高票则不算随机出局', async () => {
    // 首轮：0→1, 1→0, 2→3, 3→2，四人各 1 票；重投候选收窄到 [0,1,2,3]，全部投 1（3 号投不了自己以外的限制不触发）
    const { deps, events } = makeDeps({ 0: [1, 1], 1: [0, 0], 2: [3, 1], 3: [2, 1] });
    const state = await runGame(newGame(), deps);

    const votes = events.filter((event) => event.type === 'vote');
    expect(votes.length).toBeGreaterThanOrEqual(8);
    const elimination = state.log.find((entry) => entry.kind === 'elimination');
    expect(elimination).toEqual({ kind: 'elimination', round: 1, seatId: 1, tieBreak: false });
  });

  it('两轮都平票时按 rng 在并列者中随机出局并标记 tieBreak', async () => {
    const { deps } = makeDeps({ 0: [1], 1: [0], 2: [3], 3: [2] }, { rng: () => 0 });
    const state = await runGame(newGame(), deps);

    const elimination = state.log.find((entry) => entry.kind === 'elimination');
    expect(elimination).toMatchObject({ kind: 'elimination', round: 1, tieBreak: true });
  });

  it('硬超时会推 error 事件并把状态置为 error', async () => {
    let clock = 0;
    const { deps, events } = makeDeps(
      { 0: [3], 1: [3], 2: [3], 3: [0] },
      {
        now: () => {
          clock += 5_000;
          return clock;
        },
        hardTimeoutMs: 1_000,
      },
    );
    const state = await runGame(newGame(), deps);

    expect(state.phase).toBe('error');
    expect(state.errorMessage).toBe(HARD_TIMEOUT_MESSAGE);
    expect(events.at(-1)).toEqual({ type: 'error', message: HARD_TIMEOUT_MESSAGE });
  });

  it('agent 抛错时转成 error 事件而不是向外抛', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    deps.agents.set(1, {
      speak: vi.fn(async () => {
        throw new Error('agent 内部炸了');
      }),
      vote: vi.fn(async () => {
        throw new Error('agent 内部炸了');
      }),
    });

    const state = await runGame(newGame(), deps);

    expect(state.phase).toBe('error');
    expect(state.errorMessage).toBe('agent 内部炸了');
    expect(events.at(-1)).toEqual({ type: 'error', message: 'agent 内部炸了' });
  });

  it('缺少座位对应的 agent 时推 error', async () => {
    const { deps, events } = makeDeps({ 0: [3], 1: [3], 2: [3], 3: [0] });
    deps.agents.delete(2);

    const state = await runGame(newGame(), deps);

    expect(state.phase).toBe('error');
    expect(state.errorMessage).toBe('座位 2 没有绑定 agent');
    expect(events.at(-1)?.type).toBe('error');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/game/judge.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/game/judge"`。

- [ ] **Step 3: 写 `lib/game/judge.ts`**

```ts
import { checkWinner, pickRandom, tallyVotes, topCandidates } from '@/lib/game/rules';
import {
  aliveSeats,
  buildAgentView,
  eliminate,
  recordSpeech,
  recordVote,
  revealOf,
} from '@/lib/game/state';
import type { GameEvent, GameState, Phase, SeatAgent, VoteEntry } from '@/lib/game/types';

export const DEFAULT_HARD_TIMEOUT_MS = 180_000;
export const MAX_VOTE_ROUNDS = 2;
export const HARD_TIMEOUT_MESSAGE = '单局硬超时，已终止本局';

export interface JudgeDeps {
  agents: Map<number, SeatAgent>;
  rng: () => number;
  emit: (event: GameEvent) => void;
  now: () => number;
  hardTimeoutMs?: number;
}

interface VoteOutcome {
  seatId: number;
  tieBreak: boolean;
}

type EnsureTime = () => void;

function setPhase(state: GameState, deps: JudgeDeps, phase: Phase, activeSeatId: number | null): void {
  state.phase = phase;
  state.activeSeatId = activeSeatId;
  deps.emit({ type: 'phase', phase, round: state.round, activeSeatId });
}

function requireAgent(deps: JudgeDeps, seatId: number): SeatAgent {
  const agent = deps.agents.get(seatId);
  if (!agent) {
    throw new Error(`座位 ${seatId} 没有绑定 agent`);
  }
  return agent;
}

async function runSpeechPhase(state: GameState, deps: JudgeDeps, ensureTime: EnsureTime): Promise<void> {
  for (const seat of aliveSeats(state)) {
    ensureTime();
    setPhase(state, deps, 'speak', seat.id);
    const result = await requireAgent(deps, seat.id).speak(buildAgentView(state, seat.id));
    recordSpeech(state, {
      kind: 'speech',
      round: state.round,
      seatId: seat.id,
      text: result.text,
      fallback: result.fallback,
    });
    deps.emit({
      type: 'speech',
      round: state.round,
      seatId: seat.id,
      text: result.text,
      fallback: result.fallback,
    });
  }
}

async function collectVotes(
  state: GameState,
  deps: JudgeDeps,
  voterIds: number[],
  targetPool: number[],
  ensureTime: EnsureTime,
): Promise<VoteEntry[]> {
  const entries: VoteEntry[] = [];
  for (const voterId of voterIds) {
    ensureTime();
    const candidateIds = targetPool.filter((seatId) => seatId !== voterId);
    if (candidateIds.length === 0) {
      continue;
    }
    state.activeSeatId = voterId;
    const result = await requireAgent(deps, voterId).vote(
      buildAgentView(state, voterId),
      candidateIds,
      deps.rng,
    );
    const entry: VoteEntry = {
      kind: 'vote',
      round: state.round,
      seatId: voterId,
      targetSeatId: result.targetSeatId,
      reason: result.reason,
      fallback: result.fallback,
    };
    recordVote(state, entry);
    entries.push(entry);
    deps.emit({
      type: 'vote',
      round: entry.round,
      seatId: entry.seatId,
      targetSeatId: entry.targetSeatId,
      reason: entry.reason,
      fallback: entry.fallback,
    });
  }
  state.activeSeatId = null;
  return entries;
}

async function runVotePhase(
  state: GameState,
  deps: JudgeDeps,
  ensureTime: EnsureTime,
): Promise<VoteOutcome> {
  const voterIds = aliveSeats(state).map((seat) => seat.id);
  let targetPool = voterIds;

  for (let voteRound = 1; voteRound <= MAX_VOTE_ROUNDS; voteRound += 1) {
    ensureTime();
    setPhase(state, deps, 'vote', null);
    const entries = await collectVotes(state, deps, voterIds, targetPool, ensureTime);
    const leaders = topCandidates(tallyVotes(entries));
    if (leaders.length === 1) {
      return { seatId: leaders[0], tieBreak: false };
    }
    targetPool = leaders.length > 0 ? leaders : targetPool;
  }

  // 两轮都平：规则写死为在并列者中随机出局，绝不卡死。
  return { seatId: pickRandom(targetPool, deps.rng), tieBreak: true };
}

export async function runGame(state: GameState, deps: JudgeDeps): Promise<GameState> {
  const startedAt = deps.now();
  const hardTimeoutMs = deps.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
  const ensureTime: EnsureTime = () => {
    if (deps.now() - startedAt > hardTimeoutMs) {
      throw new Error(HARD_TIMEOUT_MESSAGE);
    }
  };

  try {
    setPhase(state, deps, 'setup', null);

    while (state.winner === null) {
      ensureTime();
      state.round += 1;
      await runSpeechPhase(state, deps, ensureTime);
      const outcome = await runVotePhase(state, deps, ensureTime);
      eliminate(state, outcome.seatId, outcome.tieBreak);
      state.winner = checkWinner(state.seats);
      deps.emit({
        type: 'result',
        round: state.round,
        eliminatedSeatId: outcome.seatId,
        tieBreak: outcome.tieBreak,
        winner: state.winner,
        reveal: state.winner === null ? null : revealOf(state),
      });
    }

    setPhase(state, deps, 'result', null);
    return state;
  } catch (error) {
    state.phase = 'error';
    state.activeSeatId = null;
    state.errorMessage = error instanceof Error ? error.message : String(error);
    deps.emit({ type: 'error', message: state.errorMessage });
    return state;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/game/judge.test.ts`
Expected: PASS，`10 passed`。

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部 PASS，typecheck 无输出。

- [ ] **Step 6: Commit**

```bash
git add lib/game/judge.ts tests/game/judge.test.ts
git commit -m "feat: add judge loop with tie re-vote, hard timeout and error events"
```

---

## Task 9: 会话事件总线、注册表与组局装配

把 Judge 产出的事件存进内存 session（支持迟到订阅者回放），用 `globalThis` 上的注册表按 `gameId` 索引，再用 `startGame` 把「读环境变量 → 建 LlmClient → 抽词 → 建局 → 建 4 个 PlayerAgent → 启动 Judge」串起来。

**Files:**
- Create: `lib/game/session.ts`
- Create: `lib/game/registry.ts`
- Create: `lib/game/bootstrap.ts`
- Test: `tests/game/session.test.ts`
- Test: `tests/game/bootstrap.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `GameEvent` / `GameState` / `SeatAgent` / `SEAT_COUNT`；Task 2 的 `drawWordPair` / `loadWordPairs`；Task 4 的 `createGame`；Task 5 的 `createZhipuClient` / `readZhipuConfigFromEnv` / `LlmClient`；Task 6 的 `PERSONAS`；Task 7 的 `PlayerAgent`；Task 8 的 `runGame` / `JudgeDeps`。
- Produces:
  - `type GameEventListener = (event: GameEvent) => void`
  - `interface GameSession { gameId: string; state: GameState; events: GameEvent[]; subscribers: Set<GameEventListener>; finished: boolean; completion?: Promise<void> }`
  - `createSession(state: GameState): GameSession`
  - `publish(session: GameSession, event: GameEvent): void`
  - `subscribe(session: GameSession, listener: GameEventListener): () => void`（先同步回放已有事件，再注册；返回退订函数）
  - `isTerminalEvent(event: GameEvent): boolean`
  - `putSession(session: GameSession): void` / `getSession(gameId: string): GameSession | undefined` / `deleteSession(gameId: string): void` / `sessionCount(): number`
  - `startGame(options?: StartGameOptions): GameSession`，`interface StartGameOptions { env?: NodeJS.ProcessEnv; rng?: () => number; now?: () => number; llm?: LlmClient; hardTimeoutMs?: number }`

- [ ] **Step 1: 写失败测试 `tests/game/session.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import {
  deleteSession,
  getSession,
  putSession,
  sessionCount,
} from '@/lib/game/registry';
import { createSession, isTerminalEvent, publish, subscribe } from '@/lib/game/session';
import { createGame } from '@/lib/game/state';
import type { GameEvent, Persona } from '@/lib/game/types';

const PERSONAS: Persona[] = [0, 1, 2, 3].map((id) => ({
  id: `persona-${id}`,
  name: `玩家${id}`,
  label: `人设${id}`,
  systemPrompt: `你是玩家${id}`,
}));

function newSession(gameId = 'g-1') {
  return createSession(
    createGame({
      gameId,
      personas: PERSONAS,
      pair: { civilian: '牛奶', undercover: '豆浆' },
      undercoverSeatId: 0,
    }),
  );
}

const PHASE_EVENT: GameEvent = { type: 'phase', phase: 'speak', round: 1, activeSeatId: 0 };
const ERROR_EVENT: GameEvent = { type: 'error', message: '炸了' };

describe('session 事件总线', () => {
  it('publish 会把事件写进缓冲区', () => {
    const session = newSession();
    publish(session, PHASE_EVENT);
    expect(session.events).toEqual([PHASE_EVENT]);
  });

  it('subscribe 先回放历史事件，再收后续事件', () => {
    const session = newSession();
    publish(session, PHASE_EVENT);

    const received: GameEvent[] = [];
    subscribe(session, (event) => received.push(event));
    expect(received).toEqual([PHASE_EVENT]);

    publish(session, ERROR_EVENT);
    expect(received).toEqual([PHASE_EVENT, ERROR_EVENT]);
  });

  it('退订后不再收到事件', () => {
    const session = newSession();
    const received: GameEvent[] = [];
    const unsubscribe = subscribe(session, (event) => received.push(event));
    unsubscribe();
    publish(session, PHASE_EVENT);
    expect(received).toEqual([]);
  });

  it('监听器抛错时把它移除，不影响其他监听器', () => {
    const session = newSession();
    const received: GameEvent[] = [];
    subscribe(session, () => {
      throw new Error('连接已断');
    });
    subscribe(session, (event) => received.push(event));

    publish(session, PHASE_EVENT);
    publish(session, ERROR_EVENT);

    expect(received).toEqual([PHASE_EVENT, ERROR_EVENT]);
    expect(session.subscribers.size).toBe(1);
  });

  it('终局事件会把 finished 置为 true', () => {
    const session = newSession();
    expect(session.finished).toBe(false);
    publish(session, {
      type: 'result',
      round: 1,
      eliminatedSeatId: 0,
      tieBreak: false,
      winner: 'civilians',
      reveal: [],
    });
    expect(session.finished).toBe(true);
  });

  it('未分胜负的 result 不算终局', () => {
    expect(
      isTerminalEvent({
        type: 'result',
        round: 1,
        eliminatedSeatId: 0,
        tieBreak: false,
        winner: null,
        reveal: null,
      }),
    ).toBe(false);
    expect(isTerminalEvent(ERROR_EVENT)).toBe(true);
    expect(isTerminalEvent(PHASE_EVENT)).toBe(false);
  });
});

describe('registry', () => {
  it('按 gameId 存取与删除', () => {
    const before = sessionCount();
    const session = newSession('g-registry');
    putSession(session);
    expect(getSession('g-registry')).toBe(session);
    expect(sessionCount()).toBe(before + 1);

    deleteSession('g-registry');
    expect(getSession('g-registry')).toBeUndefined();
    expect(sessionCount()).toBe(before);
  });

  it('查不到的 gameId 返回 undefined', () => {
    expect(getSession('不存在的局')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/game/session.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/game/registry"`。

- [ ] **Step 3: 写 `lib/game/session.ts`**

```ts
import type { GameEvent, GameState } from '@/lib/game/types';

export type GameEventListener = (event: GameEvent) => void;

export interface GameSession {
  gameId: string;
  state: GameState;
  events: GameEvent[];
  subscribers: Set<GameEventListener>;
  finished: boolean;
  /** Judge 跑完这一局的 promise；测试用它等待整局结束。 */
  completion?: Promise<void>;
}

export function createSession(state: GameState): GameSession {
  return {
    gameId: state.gameId,
    state,
    events: [],
    subscribers: new Set<GameEventListener>(),
    finished: false,
  };
}

export function isTerminalEvent(event: GameEvent): boolean {
  if (event.type === 'error') {
    return true;
  }
  return event.type === 'result' && event.winner !== null;
}

export function publish(session: GameSession, event: GameEvent): void {
  session.events.push(event);
  if (isTerminalEvent(event)) {
    session.finished = true;
  }
  for (const listener of [...session.subscribers]) {
    try {
      listener(event);
    } catch {
      // 监听器抛错说明那条 SSE 连接已经断了，直接摘掉它。
      session.subscribers.delete(listener);
    }
  }
}

export function subscribe(session: GameSession, listener: GameEventListener): () => void {
  for (const event of [...session.events]) {
    listener(event);
  }
  session.subscribers.add(listener);
  return () => {
    session.subscribers.delete(listener);
  };
}
```

- [ ] **Step 4: 写 `lib/game/registry.ts`**

```ts
import type { GameSession } from '@/lib/game/session';

type RegistryHolder = typeof globalThis & {
  __agentUndercoverGameRegistry?: Map<string, GameSession>;
};

/** 挂在 globalThis 上，这样 next dev 的模块热替换不会把正在进行的对局弄丢。 */
function registry(): Map<string, GameSession> {
  const holder = globalThis as RegistryHolder;
  holder.__agentUndercoverGameRegistry ??= new Map<string, GameSession>();
  return holder.__agentUndercoverGameRegistry;
}

export function putSession(session: GameSession): void {
  registry().set(session.gameId, session);
}

export function getSession(gameId: string): GameSession | undefined {
  return registry().get(gameId);
}

export function deleteSession(gameId: string): void {
  registry().delete(gameId);
}

export function sessionCount(): number {
  return registry().size;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/game/session.test.ts`
Expected: PASS，`8 passed`。

- [ ] **Step 6: 写失败测试 `tests/game/bootstrap.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { startGame } from '@/lib/game/bootstrap';
import { getSession } from '@/lib/game/registry';
import { MissingApiKeyError } from '@/lib/llm/zhipu';
import type { LlmClient } from '@/lib/llm/types';

/** 永远给出合法发言与合法投票（总投候选里的第一个）的假模型。 */
function fakeLlm(): LlmClient {
  return {
    async complete(messages) {
      const prompt = messages[messages.length - 1].content;
      if (prompt.includes('"speech"')) {
        return '{"speech":"一种常见的日常事物"}';
      }
      const match = prompt.match(/可投的座位号：(\d+)/);
      const seatId = match ? Number(match[1]) : 0;
      return `{"vote":${seatId},"reason":"先投票再说"}`;
    },
  };
}

describe('startGame', () => {
  it('缺少 ZHIPU_API_KEY 时抛 MissingApiKeyError，且不建局', () => {
    expect(() => startGame({ env: {} })).toThrow(MissingApiKeyError);
  });

  it('注入 mock 模型时能跑完整局并把 session 注册进 registry', async () => {
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });

    expect(getSession(session.gameId)).toBe(session);
    await session.completion;

    expect(session.finished).toBe(true);
    expect(session.state.winner).not.toBeNull();
    expect(session.events.at(-1)?.type).toBe('phase');
    expect(session.events.some((event) => event.type === 'speech')).toBe(true);
    expect(session.events.some((event) => event.type === 'vote')).toBe(true);
  });

  it('座位配置为 4 人 3 平民 1 卧底，并使用内置人设', async () => {
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
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
    const first = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
    const second = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
    await Promise.all([first.completion, second.completion]);

    expect(first.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.gameId).not.toBe(second.gameId);
  });
});
```

- [ ] **Step 7: 跑测试确认失败**

Run: `npx vitest run tests/game/bootstrap.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/game/bootstrap"`。

- [ ] **Step 8: 写 `lib/game/bootstrap.ts`**

```ts
import { randomUUID } from 'node:crypto';

import { PERSONAS } from '@/lib/agents/personas';
import { PlayerAgent } from '@/lib/agents/player-agent';
import { runGame } from '@/lib/game/judge';
import { putSession } from '@/lib/game/registry';
import { createSession, publish, type GameSession } from '@/lib/game/session';
import { createGame } from '@/lib/game/state';
import { SEAT_COUNT, type SeatAgent } from '@/lib/game/types';
import { drawWordPair, loadWordPairs } from '@/lib/game/word-bank';
import type { LlmClient } from '@/lib/llm/types';
import { createZhipuClient, readZhipuConfigFromEnv } from '@/lib/llm/zhipu';

export interface StartGameOptions {
  env?: NodeJS.ProcessEnv;
  rng?: () => number;
  now?: () => number;
  llm?: LlmClient;
  hardTimeoutMs?: number;
}

/**
 * 同步完成建局与注册，然后把 Judge 的整局循环放到后台跑。
 * 缺 API Key 会在这里同步抛出 MissingApiKeyError，调用方据此返回可读错误，绝不空跑。
 */
export function startGame(options: StartGameOptions = {}): GameSession {
  const env = options.env ?? process.env;
  const rng = options.rng ?? Math.random;
  const now = options.now ?? Date.now;
  const llm = options.llm ?? createZhipuClient(readZhipuConfigFromEnv(env));

  const pair = drawWordPair(loadWordPairs(), rng);
  const undercoverSeatId = Math.min(Math.floor(rng() * SEAT_COUNT), SEAT_COUNT - 1);
  const state = createGame({ gameId: randomUUID(), personas: PERSONAS, pair, undercoverSeatId });

  const session = createSession(state);
  putSession(session);

  const agents = new Map<number, SeatAgent>(
    PERSONAS.map((persona, seatId) => [seatId, new PlayerAgent(persona, { llm })]),
  );

  session.completion = runGame(state, {
    agents,
    rng,
    now,
    hardTimeoutMs: options.hardTimeoutMs,
    emit: (event) => publish(session, event),
  }).then(() => undefined);

  return session;
}
```

- [ ] **Step 9: 跑测试确认通过**

Run: `npx vitest run tests/game/bootstrap.test.ts`
Expected: PASS，`4 passed`。

- [ ] **Step 10: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部 PASS，typecheck 无输出。

- [ ] **Step 11: Commit**

```bash
git add lib/game/session.ts lib/game/registry.ts lib/game/bootstrap.ts tests/game/session.test.ts tests/game/bootstrap.test.ts
git commit -m "feat: add in-memory session bus, registry and game bootstrap"
```

---

## Task 10: API 路由（创建对局 / SSE / 上帝视角）

三个 App Router 路由。SSE 路由的关键点：**先发一条 `snapshot` 给出座位表，再回放缓冲事件并续推**；收到终局事件就关流，客户端断开时也要退订。

**Files:**
- Create: `app/api/games/route.ts`
- Create: `app/api/games/[gameId]/events/route.ts`
- Create: `app/api/games/[gameId]/reveal/route.ts`
- Test: `tests/api/routes.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `toPublicView` / `toGodView`；Task 5 的 `MissingApiKeyError`；Task 9 的 `startGame` / `getSession` / `subscribe` / `isTerminalEvent`。
- Produces:
  - `POST /api/games` → `201 { gameId: string }`；缺 Key → `400 { error: string }`；其它异常 → `500 { error: string }`
  - `GET /api/games/<gameId>/events` → `text/event-stream`，帧格式 `event: <name>\ndata: <json>\n\n`，`name` 取值 `snapshot` / `phase` / `speech` / `vote` / `result` / `error`；对局不存在 → `404 { error }`
  - `GET /api/games/<gameId>/reveal` → `200 GodGameView`；`ENABLE_GOD_VIEW !== 'true'` → `403 { error }`；对局不存在 → `404 { error }`

- [ ] **Step 1: 写失败测试 `tests/api/routes.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/games/route';
import { GET as getEvents } from '@/app/api/games/[gameId]/events/route';
import { GET as getReveal } from '@/app/api/games/[gameId]/reveal/route';
import { startGame } from '@/lib/game/bootstrap';
import type { LlmClient } from '@/lib/llm/types';

function fakeLlm(): LlmClient {
  return {
    async complete(messages) {
      const prompt = messages[messages.length - 1].content;
      if (prompt.includes('"speech"')) {
        return '{"speech":"一种常见的日常事物"}';
      }
      const match = prompt.match(/可投的座位号：(\d+)/);
      return `{"vote":${match ? Number(match[1]) : 0},"reason":"先投票再说"}`;
    },
  };
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
});

describe('POST /api/games', () => {
  it('缺少 ZHIPU_API_KEY 时返回 400 和可读错误', async () => {
    vi.stubEnv('ZHIPU_API_KEY', '');

    const response = await POST();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '缺少 ZHIPU_API_KEY：请在 .env.local 里配置智谱 API Key 后重启服务',
    });
  });
});

describe('GET /api/games/[gameId]/events', () => {
  it('对局不存在时返回 404', async () => {
    const response = await getEvents(new Request('http://localhost/e'), params('不存在'));
    expect(response.status).toBe(404);
  });

  it('先推 snapshot，再回放事件，终局后关流', async () => {
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
    await session.completion;

    const response = await getEvents(new Request('http://localhost/e'), params(session.gameId));
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');

    const body = await readStream(response);
    expect(body.startsWith('event: snapshot\ndata: ')).toBe(true);
    expect(body).toContain('event: speech\ndata: ');
    expect(body).toContain('event: vote\ndata: ');
    expect(body).toContain('event: result\ndata: ');

    const snapshotLine = body.split('\n\n')[0].split('data: ')[1];
    const snapshot = JSON.parse(snapshotLine) as { seats: unknown[] };
    expect(snapshot.seats).toHaveLength(4);
  });
});

describe('GET /api/games/[gameId]/reveal', () => {
  it('未启用上帝视角时返回 403', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'false');
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
    await session.completion;

    const response = await getReveal(new Request('http://localhost/r'), params(session.gameId));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: '上帝视角未启用：请在 .env.local 设置 ENABLE_GOD_VIEW=true 后重启服务',
    });
  });

  it('启用后返回身份与私有词', async () => {
    vi.stubEnv('ENABLE_GOD_VIEW', 'true');
    const session = startGame({ env: { ZHIPU_API_KEY: 'k' }, llm: fakeLlm(), rng: () => 0 });
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

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/api/routes.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/app/api/games/route"`。

- [ ] **Step 3: 写 `app/api/games/route.ts`**

```ts
import { NextResponse } from 'next/server';

import { startGame } from '@/lib/game/bootstrap';
import { MissingApiKeyError } from '@/lib/llm/zhipu';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    const session = startGame();
    return NextResponse.json({ gameId: session.gameId }, { status: 201 });
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `创建对局失败：${message}` }, { status: 500 });
  }
}
```

- [ ] **Step 4: 写 `app/api/games/[gameId]/events/route.ts`**

```ts
import { getSession } from '@/lib/game/registry';
import { isTerminalEvent, subscribe } from '@/lib/game/session';
import { toPublicView } from '@/lib/game/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function frame(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId } = await context.params;
  const session = getSession(gameId);
  if (!session) {
    return new Response(JSON.stringify({ error: `对局 ${gameId} 不存在或已结束` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // 流已经被对端关掉了，忽略即可。
        }
      };

      controller.enqueue(encoder.encode(frame('snapshot', toPublicView(session.state))));

      unsubscribe = subscribe(session, (event) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(frame(event.type, event)));
        if (isTerminalEvent(event)) {
          close();
        }
      });

      // 回放时就已经读到终局事件的话，上面的 close() 还拿不到 unsubscribe，这里补一次。
      if (closed) {
        unsubscribe();
      }

      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
```

- [ ] **Step 5: 写 `app/api/games/[gameId]/reveal/route.ts`**

```ts
import { NextResponse } from 'next/server';

import { getSession } from '@/lib/game/registry';
import { toGodView } from '@/lib/game/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  if (process.env.ENABLE_GOD_VIEW !== 'true') {
    return NextResponse.json(
      { error: '上帝视角未启用：请在 .env.local 设置 ENABLE_GOD_VIEW=true 后重启服务' },
      { status: 403 },
    );
  }

  const { gameId } = await context.params;
  const session = getSession(gameId);
  if (!session) {
    return NextResponse.json({ error: `对局 ${gameId} 不存在或已结束` }, { status: 404 });
  }

  return NextResponse.json(toGodView(session.state));
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/api/routes.test.ts`
Expected: PASS，`6 passed`。

- [ ] **Step 7: 跑全量测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部 PASS，typecheck 无输出。

- [ ] **Step 8: Commit**

```bash
git add app/api tests/api
git commit -m "feat: add create-game, SSE stream and god-view API routes"
```

---

## Task 11: 客户端事件归约与格式化

浏览器只拿得到 `snapshot` + 事件流，需要一个纯函数把事件折叠回 `PublicGameView`。这一层不碰 React，因此可以完整单测。

**Files:**
- Create: `lib/client/apply-event.ts`
- Create: `lib/client/format.ts`
- Test: `tests/client/apply-event.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `PublicGameView` / `GameEvent` / `PublicSeat` / `Phase` / `Winner` / `VoteEntry`；Task 3 的 `tallyVotes`。
- Produces:
  - `applyEvent(view: PublicGameView, event: GameEvent): PublicGameView`
  - `PHASE_LABELS: Record<Phase, string>`
  - `WINNER_LABELS: Record<Winner, string>`
  - `seatName(seats: PublicSeat[], seatId: number): string`
  - `currentRoundVotes(view: PublicGameView): VoteEntry[]`
  - `voteTally(view: PublicGameView): Record<number, number>`

- [ ] **Step 1: 写失败测试 `tests/client/apply-event.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { applyEvent } from '@/lib/client/apply-event';
import {
  PHASE_LABELS,
  WINNER_LABELS,
  currentRoundVotes,
  seatName,
  voteTally,
} from '@/lib/client/format';
import type { PublicGameView } from '@/lib/game/types';

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
};

describe('applyEvent', () => {
  it('phase 事件更新阶段、轮次与行动者', () => {
    const next = applyEvent(BASE, { type: 'phase', phase: 'speak', round: 1, activeSeatId: 2 });
    expect(next.phase).toBe('speak');
    expect(next.round).toBe(1);
    expect(next.activeSeatId).toBe(2);
  });

  it('speech 事件追加一条发言日志', () => {
    const next = applyEvent(BASE, {
      type: 'speech',
      round: 1,
      seatId: 0,
      text: '白白的',
      fallback: false,
    });
    expect(next.log).toEqual([
      { kind: 'speech', round: 1, seatId: 0, text: '白白的', fallback: false },
    ]);
  });

  it('vote 事件追加一条投票日志', () => {
    const next = applyEvent(BASE, {
      type: 'vote',
      round: 1,
      seatId: 0,
      targetSeatId: 3,
      reason: '太安静',
      fallback: true,
    });
    expect(next.log).toEqual([
      { kind: 'vote', round: 1, seatId: 0, targetSeatId: 3, reason: '太安静', fallback: true },
    ]);
  });

  it('result 事件把出局者置为死亡、写日志并记录胜负', () => {
    const next = applyEvent(BASE, {
      type: 'result',
      round: 1,
      eliminatedSeatId: 3,
      tieBreak: true,
      winner: 'civilians',
      reveal: [],
    });
    expect(next.seats[3].alive).toBe(false);
    expect(next.log).toEqual([{ kind: 'elimination', round: 1, seatId: 3, tieBreak: true }]);
    expect(next.winner).toBe('civilians');
  });

  it('error 事件切到 error 阶段并带上提示', () => {
    const next = applyEvent(BASE, { type: 'error', message: '模型挂了' });
    expect(next.phase).toBe('error');
    expect(next.activeSeatId).toBeNull();
    expect(next.errorMessage).toBe('模型挂了');
  });

  it('不修改传入的 view（纯函数）', () => {
    const snapshot = JSON.stringify(BASE);
    applyEvent(BASE, { type: 'phase', phase: 'vote', round: 2, activeSeatId: null });
    expect(JSON.stringify(BASE)).toBe(snapshot);
  });
});

describe('format 辅助', () => {
  it('五个阶段都有中文标签', () => {
    expect(Object.keys(PHASE_LABELS).sort()).toEqual(['error', 'result', 'setup', 'speak', 'vote']);
    expect(PHASE_LABELS.speak).toBe('发言轮');
    expect(WINNER_LABELS.undercover).toBe('卧底胜');
  });

  it('seatName 找不到座位时回退到座位号', () => {
    expect(seatName(BASE.seats, 1)).toBe('小柯');
    expect(seatName(BASE.seats, 9)).toBe('座位9');
  });

  it('currentRoundVotes 只取当前轮的投票', () => {
    const view: PublicGameView = {
      ...BASE,
      round: 2,
      log: [
        { kind: 'vote', round: 1, seatId: 0, targetSeatId: 1, reason: 'a', fallback: false },
        { kind: 'vote', round: 2, seatId: 0, targetSeatId: 3, reason: 'b', fallback: false },
        { kind: 'vote', round: 2, seatId: 1, targetSeatId: 3, reason: 'c', fallback: false },
        { kind: 'speech', round: 2, seatId: 2, text: 'x', fallback: false },
      ],
    };
    expect(currentRoundVotes(view)).toHaveLength(2);
    expect(voteTally(view)).toEqual({ 3: 2 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/client/apply-event.test.ts`
Expected: FAIL，报错 `Failed to resolve import "@/lib/client/apply-event"`。

- [ ] **Step 3: 写 `lib/client/apply-event.ts`**

```ts
import type { GameEvent, PublicGameView } from '@/lib/game/types';

export function applyEvent(view: PublicGameView, event: GameEvent): PublicGameView {
  switch (event.type) {
    case 'phase':
      return { ...view, phase: event.phase, round: event.round, activeSeatId: event.activeSeatId };
    case 'speech':
      return {
        ...view,
        log: [
          ...view.log,
          {
            kind: 'speech',
            round: event.round,
            seatId: event.seatId,
            text: event.text,
            fallback: event.fallback,
          },
        ],
      };
    case 'vote':
      return {
        ...view,
        log: [
          ...view.log,
          {
            kind: 'vote',
            round: event.round,
            seatId: event.seatId,
            targetSeatId: event.targetSeatId,
            reason: event.reason,
            fallback: event.fallback,
          },
        ],
      };
    case 'result':
      return {
        ...view,
        seats: view.seats.map((seat) =>
          seat.id === event.eliminatedSeatId ? { ...seat, alive: false } : seat,
        ),
        log:
          event.eliminatedSeatId === null
            ? [...view.log]
            : [
                ...view.log,
                {
                  kind: 'elimination',
                  round: event.round,
                  seatId: event.eliminatedSeatId,
                  tieBreak: event.tieBreak,
                },
              ],
        winner: event.winner,
      };
    case 'error':
      return { ...view, phase: 'error', activeSeatId: null, errorMessage: event.message };
  }
}
```

- [ ] **Step 4: 写 `lib/client/format.ts`**

```ts
import { tallyVotes } from '@/lib/game/rules';
import type { Phase, PublicGameView, PublicSeat, VoteEntry, Winner } from '@/lib/game/types';

export const PHASE_LABELS: Record<Phase, string> = {
  setup: '准备中',
  speak: '发言轮',
  vote: '投票轮',
  result: '已结束',
  error: '出错了',
};

export const WINNER_LABELS: Record<Winner, string> = {
  civilians: '平民胜',
  undercover: '卧底胜',
};

export function seatName(seats: PublicSeat[], seatId: number): string {
  return seats.find((seat) => seat.id === seatId)?.name ?? `座位${seatId}`;
}

export function currentRoundVotes(view: PublicGameView): VoteEntry[] {
  return view.log.filter(
    (entry): entry is VoteEntry => entry.kind === 'vote' && entry.round === view.round,
  );
}

export function voteTally(view: PublicGameView): Record<number, number> {
  return tallyVotes(currentRoundVotes(view));
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/client/apply-event.test.ts`
Expected: PASS，`9 passed`。

- [ ] **Step 6: Commit**

```bash
git add lib/client tests/client
git commit -m "feat: add client-side event reducer and display formatters"
```

---

## Task 12: 旁观 UI（hook + 组件 + 页面）

把牌桌画出来：顶栏（局号 / 阶段 / 开始按钮）、四张座位卡、发言时间线、投票条、上帝视角面板。这一层没有单元测试（v1 不做浏览器 E2E），验收靠 `npm run typecheck`、`npm run build` 与浏览器实跑；本任务的每个组件都给出完整代码，实现者不需要自己设计结构。

**Files:**
- Create: `lib/client/use-game-stream.ts`
- Create: `components/TopBar.tsx`
- Create: `components/SeatCard.tsx`
- Create: `components/Timeline.tsx`
- Create: `components/VoteBar.tsx`
- Create: `components/GodPanel.tsx`
- Modify: `app/page.tsx`（整体替换 Task 1 的占位实现）
- Modify: `app/globals.css`（在文件末尾追加牌桌样式）

**Interfaces:**
- Consumes: Task 2 的 `GameEvent` / `PublicGameView` / `GodGameView` / `PublicSeat` / `SpeechEntry`；Task 11 的 `applyEvent` / `PHASE_LABELS` / `WINNER_LABELS` / `seatName` / `currentRoundVotes` / `voteTally`；Task 10 的三个路由。
- Produces:
  - `type StreamStatus = 'idle' | 'starting' | 'streaming' | 'finished' | 'error'`
  - `interface GameStream { view: PublicGameView | null; status: StreamStatus; errorMessage: string | null; start: () => Promise<void> }`
  - `useGameStream(): GameStream`
  - `<TopBar view status onStart />`、`<SeatCard seat activeSeatId />`、`<Timeline view />`、`<VoteBar view />`、`<GodPanel gameId />`

- [ ] **Step 1: 写 `lib/client/use-game-stream.ts`**

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { applyEvent } from '@/lib/client/apply-event';
import type { GameEvent, PublicGameView } from '@/lib/game/types';

export type StreamStatus = 'idle' | 'starting' | 'streaming' | 'finished' | 'error';

export interface GameStream {
  view: PublicGameView | null;
  status: StreamStatus;
  errorMessage: string | null;
  start: () => Promise<void>;
}

const EVENT_NAMES = ['phase', 'speech', 'vote', 'result', 'error'] as const;

export function useGameStream(): GameStream {
  const [view, setView] = useState<PublicGameView | null>(null);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  const start = useCallback(async () => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setView(null);
    setErrorMessage(null);
    setStatus('starting');

    let response: Response;
    try {
      response = await fetch('/api/games', { method: 'POST' });
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

  return { view, status, errorMessage, start };
}
```

- [ ] **Step 2: 写 `components/TopBar.tsx`**

```tsx
'use client';

import { PHASE_LABELS, WINNER_LABELS } from '@/lib/client/format';
import type { StreamStatus } from '@/lib/client/use-game-stream';
import type { PublicGameView } from '@/lib/game/types';

interface TopBarProps {
  view: PublicGameView | null;
  status: StreamStatus;
  onStart: () => void;
}

export function TopBar({ view, status, onStart }: TopBarProps) {
  const running = status === 'starting' || status === 'streaming';
  const buttonText = status === 'idle' ? '开始' : running ? '进行中…' : '再来一局';

  return (
    <header className="panel topbar">
      <div>
        <h1 className="topbar-title">Agent Undercover</h1>
        <p className="muted topbar-meta">
          局号：{view ? view.gameId : '—'} ｜ 第 {view ? view.round : 0} 轮 ｜ 阶段：
          {view ? PHASE_LABELS[view.phase] : '未开始'}
          {view?.winner ? ` ｜ ${WINNER_LABELS[view.winner]}` : ''}
        </p>
      </div>
      <button className="primary" type="button" onClick={onStart} disabled={running}>
        {buttonText}
      </button>
    </header>
  );
}
```

- [ ] **Step 3: 写 `components/SeatCard.tsx`**

```tsx
'use client';

import type { PublicSeat } from '@/lib/game/types';

interface SeatCardProps {
  seat: PublicSeat;
  activeSeatId: number | null;
}

export function SeatCard({ seat, activeSeatId }: SeatCardProps) {
  const classNames = ['seat-card'];
  if (!seat.alive) {
    classNames.push('seat-card-out');
  }
  if (seat.alive && seat.id === activeSeatId) {
    classNames.push('seat-card-active');
  }

  return (
    <article className={classNames.join(' ')}>
      <div className="seat-name">{seat.name}</div>
      <div className="muted seat-persona">{seat.personaLabel}</div>
      <div className="seat-status">
        {seat.alive ? (seat.id === activeSeatId ? '正在行动' : '存活') : '已出局'}
      </div>
    </article>
  );
}
```

- [ ] **Step 4: 写 `components/Timeline.tsx`**

```tsx
'use client';

import { seatName } from '@/lib/client/format';
import type { PublicGameView, SpeechEntry } from '@/lib/game/types';

interface TimelineProps {
  view: PublicGameView;
}

export function Timeline({ view }: TimelineProps) {
  const speeches = view.log.filter((entry): entry is SpeechEntry => entry.kind === 'speech');

  return (
    <section className="panel">
      <h2 className="section-title">发言时间线</h2>
      {speeches.length === 0 ? (
        <p className="muted">还没有人发言。</p>
      ) : (
        <ol className="timeline">
          {speeches.map((entry, index) => (
            <li key={`${entry.round}-${entry.seatId}-${index}`} className="timeline-item">
              <span className="muted timeline-round">第 {entry.round} 轮</span>
              <strong className="timeline-speaker">{seatName(view.seats, entry.seatId)}</strong>
              <span className={entry.fallback ? 'danger' : undefined}>{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 5: 写 `components/VoteBar.tsx`**

```tsx
'use client';

import { currentRoundVotes, seatName, voteTally } from '@/lib/client/format';
import type { PublicGameView } from '@/lib/game/types';

interface VoteBarProps {
  view: PublicGameView;
}

export function VoteBar({ view }: VoteBarProps) {
  const votes = currentRoundVotes(view);
  const tally = voteTally(view);
  const tallyEntries = Object.entries(tally).sort((a, b) => Number(b[1]) - Number(a[1]));

  return (
    <section className="panel">
      <h2 className="section-title">第 {view.round} 轮投票</h2>
      {votes.length === 0 ? (
        <p className="muted">本轮还没有人投票。</p>
      ) : (
        <>
          <ul className="vote-list">
            {votes.map((entry, index) => (
              <li key={`${entry.seatId}-${index}`} className="vote-item">
                <strong>{seatName(view.seats, entry.seatId)}</strong>
                <span className="muted"> 投给 </span>
                <strong>{seatName(view.seats, entry.targetSeatId)}</strong>
                <span className={entry.fallback ? 'danger vote-reason' : 'muted vote-reason'}>
                  {entry.reason}
                </span>
              </li>
            ))}
          </ul>
          <p className="vote-tally">
            本轮汇总：
            {tallyEntries
              .map(([seatId, count]) => `${seatName(view.seats, Number(seatId))} ${count} 票`)
              .join('，')}
          </p>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 6: 写 `components/GodPanel.tsx`**

```tsx
'use client';

import { useState } from 'react';

import type { GodGameView } from '@/lib/game/types';

interface GodPanelProps {
  gameId: string;
}

export function GodPanel({ gameId }: GodPanelProps) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState<GodGameView['reveal'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setError(null);
    const response = await fetch(`/api/games/${gameId}/reveal`);
    const payload = (await response.json()) as Partial<GodGameView> & { error?: string };
    if (!response.ok || !payload.reveal) {
      setError(payload.error ?? '拉取上帝视角失败');
      setReveal(null);
      setOpen(true);
      return;
    }
    setReveal(payload.reveal);
    setOpen(true);
  }

  return (
    <section className="panel">
      <div className="god-header">
        <h2 className="section-title">上帝视角（调试用，默认关闭）</h2>
        <button type="button" onClick={toggle}>
          {open ? '隐藏' : '显示身份与私有词'}
        </button>
      </div>
      {open && error ? <p className="danger">{error}</p> : null}
      {open && reveal ? (
        <ul className="god-list">
          {reveal.map((item) => (
            <li key={item.seatId}>
              座位 {item.seatId}：{item.role === 'undercover' ? '卧底' : '平民'} ｜ 词：{item.word}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 7: 整体替换 `app/page.tsx`**

```tsx
'use client';

import { GodPanel } from '@/components/GodPanel';
import { SeatCard } from '@/components/SeatCard';
import { Timeline } from '@/components/Timeline';
import { TopBar } from '@/components/TopBar';
import { VoteBar } from '@/components/VoteBar';
import { useGameStream } from '@/lib/client/use-game-stream';

export default function HomePage() {
  const { view, status, errorMessage, start } = useGameStream();

  return (
    <main className="page">
      <TopBar view={view} status={status} onStart={() => void start()} />

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
        <p className="panel muted">点「开始」让四个 AI 玩家自动打一局。</p>
      )}
    </main>
  );
}
```

- [ ] **Step 8: 在 `app/globals.css` 末尾追加牌桌样式**

```css
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.topbar-title {
  margin: 0 0 4px;
  font-size: 20px;
}

.topbar-meta {
  margin: 0;
  font-size: 13px;
}

button {
  background: #232a36;
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 14px;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #0d1117;
  font-weight: 600;
}

.section-title {
  margin: 0 0 12px;
  font-size: 15px;
}

.seat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.seat-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
}

.seat-card-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent) inset;
}

.seat-card-out {
  opacity: 0.45;
}

.seat-name {
  font-size: 16px;
  font-weight: 600;
}

.seat-persona {
  font-size: 12px;
  margin: 4px 0 8px;
}

.seat-status {
  font-size: 12px;
}

.timeline,
.vote-list,
.god-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.timeline-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
  line-height: 1.6;
}

.timeline-round {
  font-size: 12px;
}

.timeline-speaker {
  min-width: 56px;
}

.vote-reason {
  margin-left: 8px;
  font-size: 13px;
}

.vote-tally {
  margin: 14px 0 0;
  font-size: 13px;
}

.god-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.god-header .section-title {
  margin: 0;
}
```

- [ ] **Step 9: 类型检查与构建**

Run: `npm run typecheck && npm run build`
Expected: typecheck 无输出；build 打印 `✓ Compiled successfully`，路由清单包含 `/`、`/api/games`、`/api/games/[gameId]/events`、`/api/games/[gameId]/reveal`。

- [ ] **Step 10: 跑全量测试**

Run: `npm test`
Expected: 全部 PASS（此任务没有新增测试，确认既有测试未被破坏）。

- [ ] **Step 11: Commit**

```bash
git add lib/client/use-game-stream.ts components app/page.tsx app/globals.css
git commit -m "feat: add spectator UI with SSE-driven table, timeline and vote bar"
```

---

## Task 13: README、环境变量文档与本地联调验收

最后一关：把 README 写成「新人照着能跑起来」的程度，然后逐条验收设计文档第 9 节的三个成功标准。

**Files:**
- Modify: `README.md`（整体替换仓库现有内容）
- Test: 无新增自动化测试；本任务用真实智谱 Key 做一次人工联调

**Interfaces:**
- Consumes: Task 1~12 的全部产物。
- Produces: 可交付的 v1（README + 一次通过的人工验收记录）。

- [ ] **Step 1: 整体替换 `README.md`**

````markdown
# agent-undercover

四个 AI 玩家自动进行的「谁是卧底」网页旁观牌桌。3 名平民 + 1 名卧底，经典双词规则，全部由同一个智谱 BigModel 模型 + 四套不同人设驱动；你在浏览器里看它们发言、投票、决出胜负。

## 环境要求

- Node.js >= 20.9
- 一个智谱 BigModel API Key

## 快速开始

```bash
npm install
cp .env.example .env.local
# 编辑 .env.local，填入 ZHIPU_API_KEY
npm run dev
```

打开 http://localhost:3000 ，点「开始」。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `ZHIPU_API_KEY` | 是 | 无 | 智谱 BigModel API Key；缺失时点「开始」会直接看到可读错误，不会空转 |
| `ZHIPU_MODEL` | 否 | `glm-4-flash` | chat completions 模型名 |
| `ENABLE_GOD_VIEW` | 否 | 未设置（等价于关闭） | 设为 `true` 才开放 `GET /api/games/<gameId>/reveal`，页面上的「上帝视角」才能拿到身份与私有词 |

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
lib/llm/                          智谱客户端
lib/client/                       事件归约、格式化、SSE hook
data/word-pairs.json              内置词库
docs/superpowers/specs/           设计文档
tests/                            Vitest 单测
```

SSE 事件：`snapshot`（连接时的公开快照）、`phase`、`speech`、`vote`、`result`、`error`。默认视图**不包含**任何人的身份与私有词，只有终局的 `result` 事件和上帝视角接口才会揭示。

## 容错

- 智谱超时 / 429 / 5xx：指数退避（500ms、1000ms）最多重试 2 次。
- Agent 输出不合格（不是 JSON、投了非法座位、发言念出词面）：重试 1 次，仍失败则兜底（空发言或随机合法票），该条记录在界面上标红。
- 单局硬超时（默认 180 秒）：结束对局并推 `error` 事件。
- 缺 `ZHIPU_API_KEY`：`POST /api/games` 返回 400 与可读错误。

## v1 不包含

空白卧底规则、真人入座、多模型混搭 UI、登录、多局持久化与战绩、浏览器 E2E 测试、真·多进程 agent 隔离。
````

- [ ] **Step 2: 跑全量测试与构建**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全部 PASS；typecheck 无输出；build 成功。

- [ ] **Step 3: 验收「缺 Key 有明确提示，不无限挂起」**

```bash
cp .env.example .env.local
npm run dev
```

在浏览器打开 http://localhost:3000 ，点「开始」。
Expected: 页面出现红色提示「缺少 ZHIPU_API_KEY：请在 .env.local 里配置智谱 API Key 后重启服务」，按钮恢复为「再来一局」，没有转圈卡死。

- [ ] **Step 4: 验收「配置 Key 后能自动跑完一局」**

把真实 Key 写进 `.env.local` 的 `ZHIPU_API_KEY`，重启 `npm run dev`，刷新页面后点「开始」。
Expected: 四张座位卡依次高亮「正在行动」；发言时间线逐条出现；投票条显示「X 投给 Y」与本轮票数汇总；出局者座位卡变灰；顶栏最终显示「平民胜」或「卧底胜」，阶段变为「已结束」。

- [ ] **Step 5: 验收「默认视图不泄露身份与私有词」**

对局跑到一半时，在浏览器 DevTools 的 Network 里找到 `events` 这条 EventStream，逐帧检查。
Expected: `snapshot` 与 `phase` / `speech` / `vote` 帧里都没有 `role` 与 `word` 字段；只有终局那条 `result` 帧带 `reveal`。同时点页面上的「显示身份与私有词」。
Expected: 因为 `.env.local` 里 `ENABLE_GOD_VIEW=false`，显示红字「上帝视角未启用：请在 .env.local 设置 ENABLE_GOD_VIEW=true 后重启服务」。

- [ ] **Step 6: 验收「上帝视角可调试」**

把 `.env.local` 改成 `ENABLE_GOD_VIEW=true`，重启 `npm run dev`，重新跑一局并点「显示身份与私有词」。
Expected: 列出 4 个座位的身份与词，其中恰好 1 个「卧底」，3 个「平民」且平民的词完全相同。

- [ ] **Step 7: 用 curl 复核 SSE 帧格式**

```bash
GAME_ID=$(curl -s -X POST http://localhost:3000/api/games | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).gameId')
curl -N -s "http://localhost:3000/api/games/$GAME_ID/events" | head -n 20
```

Expected: 第一帧是 `event: snapshot`，随后出现 `event: phase`、`event: speech` 等帧，每帧以空行分隔。

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: document setup, env vars, rules and architecture"
```

- [ ] **Step 9: 推分支**

```bash
git push -u origin feat/v1-agent-undercover
```

---

## Self-Review

写完后对着设计文档重新过了一遍，结论与已做的修正如下。

### 1. Spec coverage

| 设计文档要求 | 落在哪个 Task |
|------|------|
| §1 v1 范围：4 人 3v1 纯 AI | Task 2（`SEAT_COUNT = 4`）、Task 4（`createGame`）、Task 9（`startGame` 装配 4 个 `PlayerAgent`） |
| §1 经典双词规则 | Task 2（`WordPair`）、Task 4（平民同词 / 卧底异词的发词测试） |
| §1 简单网页旁观 UI | Task 12 |
| §1 同一模型 + 不同人设 | Task 6（`PERSONAS`）、Task 9（四个 agent 共享同一个 `LlmClient`） |
| §1 单体全栈、模块边界清晰 | File Structure + Task 3/4/8/9 的模块拆分 |
| §2.1 随机指定卧底 + 抽词 | Task 2（`drawWordPair`）、Task 9（`undercoverSeatId` 由 rng 决定） |
| §2.2 发言轮按序、不得念出词面 | Task 8（`runSpeechPhase` 按座位号顺序）、Task 6（`parseSpeechReply` 程序化校验词面） |
| §2.3 必须投他人、最高票出局 | Task 8（`collectVotes` 过滤自己）、Task 3（`topCandidates`） |
| §2.3 平票再投一轮、仍平随机 | Task 8（`MAX_VOTE_ROUNDS = 2` + `pickRandom`），Task 8 有两条对应测试 |
| §2.5 胜负判定 | Task 3（`checkWinner`） |
| §3 模块表（GameState / Judge / PlayerAgent / LlmClient / WordBank） | 分别是 Task 4 / Task 8 / Task 7 / Task 5 / Task 2 |
| §3 技术栈：Next App Router + TS、纯 TS 逻辑、智谱环境变量、SSE、内置词库 | Task 1 / Task 5 / Task 10 / Task 2 |
| §3 数据流：POST /api/games → Judge 循环 → SSE | Task 10 + Task 9 |
| §3 公开视图 + 可选上帝视角（默认关） | Task 4（`toPublicView` / `toGodView`）、Task 10（`ENABLE_GOD_VIEW` 守卫） |
| §3 SSE 五种事件 | Task 2（`GameEvent` 联合类型）、Task 8（全部 emit 点）、Task 10（帧名） |
| §4 UI：顶栏 / 座位卡 / 时间线 / 投票条 / 上帝视角开关 | Task 12 的五个组件 |
| §5 四套人设、低温度、结构化输出 | Task 6（`PERSONAS`、JSON 输出约定）、Task 7（`DEFAULT_AGENT_TEMPERATURE = 0.4`） |
| §5 投票理由进入公开日志 | Task 8（`VoteEntry.reason` 写入 `state.log` 并 emit） |
| §6 超时 / 429 指数退避最多 2 次 | Task 5（`isRetryable` + `RETRY_BASE_DELAY_MS`） |
| §6 输出不合格重试 1 次后兜底、日志标红 | Task 7（`AGENT_MAX_ATTEMPTS = 2` + fallback）、Task 12（`fallback` 渲染成 `danger` 红字） |
| §6 单局硬超时推 error | Task 8（`ensureTime` / `HARD_TIMEOUT_MESSAGE`） |
| §6 缺 Key 直接返回可读错误 | Task 5（`MissingApiKeyError`）、Task 10（400 分支） |
| §7 测试：纯函数、Judge + mock LLM、不做 E2E | Task 3/4 纯函数；Task 8/9 mock LLM 跑整局；全程无浏览器 E2E |
| §8 仓库结构 | File Structure 与设计文档一致，并把设计文档移进 `docs/superpowers/specs/`（Task 1 Step 14） |
| §9 成功标准三条 | Task 13 Step 3~6 逐条验收 |
| §10 后续项 | 全部排除在 Global Constraints 的「v1 明确不做」里 |

**发现的缺口与修补：** 初稿把「发言不得念出词面」只写进了 prompt 文案，没有程序化保证。已在 Task 6 把 `parseSpeechReply` 改成接收 `forbiddenWord` 参数，命中即判为不合格，从而触发 Task 7 的重试与兜底链路，并在两处补了对应测试。

### 2. Placeholder scan

通篇搜过 `TBD`、`TODO`、`待补`、`类似 Task`、`fill in`、「加错误处理」「处理边界情况」这类空泛表述，结果为零：

- 每个需要写代码的 Step 都给出了完整可粘贴的代码块，没有「参考上一个任务」式的引用；Task 9 与 Task 10 都各自重复写了一份 `fakeLlm()`，没有让实现者回头翻别的任务。
- 所有容错要求都落成了具体机制与具体文案：`MissingApiKeyError` 的中文提示、`HARD_TIMEOUT_MESSAGE`、`FALLBACK_SPEECH`、`FALLBACK_VOTE_REASON`、`DEFAULT_VOTE_REASON`，而不是「加错误处理」。
- 每条 Run 命令都写了具体的 Expected（失败时的报错文本 / 通过用例数 / 构建输出）。

### 3. Type consistency

按名字逐个对过跨任务引用，全部一致：

- `SeatAgent.speak(view) / vote(view, candidateIds, rng)` 在 Task 2 定义，Task 7 `PlayerAgent` 实现，Task 8 `runSpeechPhase` / `collectVotes` 调用，三处签名与参数顺序一致。
- `AgentView` 的字段（`seatId` / `seatName` / `word` / `round` / `seats` / `log` / `aliveOtherIds`）在 Task 2 定义，Task 4 `buildAgentView` 构造，Task 6 prompt 与 Task 7 测试夹具消费，字段名完全对齐。
- `GameEvent` 的 `result` 分支字段 `eliminatedSeatId` / `tieBreak` / `winner` / `reveal` 在 Task 2 定义，Task 8 emit，Task 9 `isTerminalEvent` 判定，Task 11 `applyEvent` 归约，Task 12 hook 消费，四处一致。
- `tallyVotes` 接受 `VoteEntry[]`（Task 3），Task 8 传的是刚收集到的 `VoteEntry[]`、Task 11 `voteTally` 传的是 `currentRoundVotes(view)` 返回的 `VoteEntry[]`，类型吻合。
- `PublicSeat` 只有 `id` / `name` / `personaLabel` / `alive`；Task 12 的 `SeatCard` 也只用了这四个字段，没有引用 `role` 或 `word`。
- `GameSession` 的 `completion` 字段在 Task 9 定义并赋值，Task 9 与 Task 10 的测试都 `await session.completion`，没有出现 `session.done` 之类的别名。
- `startGame` 的可选项 `env` / `rng` / `now` / `llm` / `hardTimeoutMs` 在 Task 9 定义，Task 9 与 Task 10 的测试只用这些键。

**修正过的一处不一致：** 初稿 Task 9 的 bootstrap 测试里写了一个名为「未注入 llm 时用环境变量创建智谱客户端」的用例，实际却注入了 mock、并且会留下一个悬空的 promise；已改写为校验 `gameId` 为 UUID 且每局不同的用例，并同步删掉了该测试文件里已不再使用的 `vi` import。
