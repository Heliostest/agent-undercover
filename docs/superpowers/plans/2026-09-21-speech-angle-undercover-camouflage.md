# 发言含混 + 卧底伪装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每轮发言注入轻量 `speechAngle`，并加强 speech/vote 提示词，降低同场景挤兑、提升少数方伪装，且不把 angle 泄漏到公开时间线。

**Architecture:** 新增 `lib/game/speech-angles.ts`（角度常量 + 本轮去重抽取）。`AgentView` 增加可选 `speechAngle`。`runSpeechPhase`（`lib/game/judge.ts`）在每位存活玩家发言前抽取 angle 并 merge 进 `buildAgentView` 结果。`lib/agents/prompt.ts` 的 `speechStrategy` / `thoughtPlan` / `buildSpeechMessages` / `buildVoteMessages` 按 spec 改文案。校验仍只查 JSON + 漏词。

**Tech Stack:** TypeScript 5.9（strict）、Vitest 3、既有 GameState / Judge / PlayerAgent。无新 npm 依赖。

## Global Constraints

- **不泄漏：** `speechAngle` 不得出现在公开 `log`、SSE/`emit` 事件、`toPublicView` JSON 中。
- **无角度硬校验：** 不解析 speech 是否「讲对角度」；靠 prompt + 注入。
- **无身份状态机：** 不向 agent 注入真实平民/卧底身份；伪装只靠 thought 自判 + prompt。
- **不改：** 投票规则、词库、人设、局流程（仍说完即投）、漏词校验结构、JSON 字段名。
- **测试纪律：** `npm test` + `npm run typecheck` 全绿再提交；每个 Task 收尾提交一次。
- **语言：** 用户可见 / prompt 文案中文；标识符英文。
- **Spec：** `docs/superpowers/specs/2026-09-21-speech-angle-undercover-camouflage-design.md`

---

## File Structure

### 新建

| 文件 | 职责 |
|------|------|
| `lib/game/speech-angles.ts` | `SPEECH_ANGLES`、`SpeechAngleId`、`SpeechAngle`、`pickSpeechAngles(seatIds, rng)` |
| `tests/game/speech-angles.test.ts` | 去重 / 不足 4 人允许重复 / 确定性 rng |

### 修改

| 文件 | 改动 |
|------|------|
| `lib/game/types.ts` | `AgentView.speechAngle?: SpeechAngle` |
| `lib/game/judge.ts` | `runSpeechPhase`：本轮开启发言前 `pickSpeechAngles`，每人 `speak({ ...buildAgentView(...), speechAngle })` |
| `lib/agents/prompt.ts` | `speechStrategy` / `thoughtPlan` / angle 硬约束 / 投票一句 |
| `tests/agents/prompt.test.ts` | 文案断言 + 有/无 angle |
| `tests/game/state.test.ts` 或 `judge.test.ts` | 公开视图 / emit 不含 speechAngle（若 judge 可测） |

### 不动

`word-bank.ts`、`personas.ts`、`rules.ts` 计票、billing、OmniRoute、Settings UI。

---

## Task 依赖顺序

```
Task 1 (speech-angles 模块 + 单测)
  └─ Task 2 (AgentView 类型 + judge 注入)
       └─ Task 3 (prompt 文案 + 单测)
            └─ Task 4 (泄漏回归 + typecheck 收尾)
```

---

### Task 1: `speech-angles` 抽取器

**Files:**
- Create: `lib/game/speech-angles.ts`
- Test: `tests/game/speech-angles.test.ts`

**Interfaces:**
- Produces:
  - `export type SpeechAngleId = 'feel' | 'timing' | 'habit' | 'object'`
  - `export interface SpeechAngle { id: SpeechAngleId; label: string; hint: string }`
  - `export const SPEECH_ANGLES: readonly SpeechAngle[]`（恰好 4 条，id/label/hint 与 spec §3.1 一致）
  - `export function pickSpeechAngles(seatIds: readonly number[], rng: () => number): Map<number, SpeechAngle>`
    - 对 `seatIds` 依次分配；优先从未用过的 id 中按 `rng` 抽取；池空则从全部 4 个里抽（允许重复）
    - `rng` 语义与项目其它处一致：返回 `[0, 1)`，用 `Math.floor(rng() * n)` 选下标

- [ ] **Step 1: 写失败单测**

```ts
import { describe, expect, it } from 'vitest';
import { SPEECH_ANGLES, pickSpeechAngles } from '@/lib/game/speech-angles';

describe('SPEECH_ANGLES', () => {
  it('恰好 4 个且 id 不重复', () => {
    expect(SPEECH_ANGLES).toHaveLength(4);
    expect(new Set(SPEECH_ANGLES.map((a) => a.id)).size).toBe(4);
  });
});

describe('pickSpeechAngles', () => {
  it('4 个座位时 id 互不重复', () => {
    const map = pickSpeechAngles([0, 1, 2, 3], () => 0);
    const ids = [...map.values()].map((a) => a.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('2 个座位时各有 angle（允许将来轮次重复）', () => {
    const map = pickSpeechAngles([0, 3], () => 0.9);
    expect(map.size).toBe(2);
    expect(map.get(0)?.hint).toBeTruthy();
    expect(map.get(3)?.hint).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `npx vitest run tests/game/speech-angles.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

`lib/game/speech-angles.ts`：导出常量（feel/timing/habit/object 及中文 label/hint，文案对齐 spec）+ `pickSpeechAngles`。

Hint 文案（可原样使用）：
- feel: `身体或心情上的一点感觉`
- timing: `什么时候会想到它`
- habit: `一个很小的个人习惯`
- object: `相关的人或物（不说词本身）`

Label：`感受/心情`、`时机/场合`、`个人小习惯`、`相关的人或物`

- [ ] **Step 4: 跑测确认通过**

Run: `npx vitest run tests/game/speech-angles.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/speech-angles.ts tests/game/speech-angles.test.ts
git commit -m "feat(game): add speech angle pool and per-round picker"
```

---

### Task 2: `AgentView` + Judge 注入

**Files:**
- Modify: `lib/game/types.ts`（`AgentView`）
- Modify: `lib/game/judge.ts`（`runSpeechPhase`）
- Test: `tests/game/judge.test.ts`（若已有 speak mock）或扩展 `tests/game/state.test.ts` 仅保证 `buildAgentView` 默认无 `speechAngle`

**Interfaces:**
- Consumes: `pickSpeechAngles` from Task 1
- Produces: `AgentView.speechAngle?: SpeechAngle`（optional；缺省时 prompt 行为与旧版一致）

- [ ] **Step 1: 写/改失败单测**

在 `tests/game/judge.test.ts` 中（已有假 agent 的话）断言：每次 `speak` 收到的 view 带有 `speechAngle`，且同轮四人 `id` 尽量不重复。

若 judge 测试难扩展，最低要求：

```ts
// tests/game/state.test.ts
it('buildAgentView 默认不含 speechAngle', () => {
  const view = buildAgentView(state, 0);
  expect(view.speechAngle).toBeUndefined();
});
```

并在 judge 测试里用捕获到的 speak 参数断言 angle 存在（实现 Step 3 时一并加）。

- [ ] **Step 2: 跑相关测试看基线**

Run: `npx vitest run tests/game/state.test.ts tests/game/judge.test.ts`

- [ ] **Step 3: 改类型与 judge**

`AgentView` 增加：

```ts
speechAngle?: import('@/lib/game/speech-angles').SpeechAngle;
```

（或在 types 顶部显式 import `SpeechAngle`）

`runSpeechPhase` 伪代码：

```ts
const alive = aliveSeats(state);
const angles = pickSpeechAngles(
  alive.map((s) => s.id),
  deps.rng, // 若 JudgeDeps 无 rng，用 deps 已有的随机源；没有则 `Math.random`
);
for (const seat of alive) {
  ...
  const view = {
    ...buildAgentView(state, seat.id),
    speechAngle: angles.get(seat.id),
  };
  const result = await requireAgent(deps, seat.id).speak(view, deps.signal);
  ...
}
```

**注意：** `deps.emit({ type: 'speech', ... })` 仍只含 `text`/`fallback` 等公开字段，禁止加 `speechAngle`。

先确认 `JudgeDeps` 是否已有 `rng`（搜 `judge.ts` / `bootstrap`）。有则复用；无则本 Task 用 `Math.random` 并在注释标明与词分配随机源可后续统一。

- [ ] **Step 4: 跑测通过**

Run: `npx vitest run tests/game/state.test.ts tests/game/judge.test.ts tests/game/speech-angles.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/game/types.ts lib/game/judge.ts tests/game/state.test.ts tests/game/judge.test.ts
git commit -m "feat(game): inject per-seat speechAngle into speak views"
```

---

### Task 3: Prompt 文案（含混 + 伪装 + angle 硬约束）

**Files:**
- Modify: `lib/agents/prompt.ts`
- Modify: `tests/agents/prompt.test.ts`

**Interfaces:**
- Consumes: `view.speechAngle?`
- Produces: 更新后的 `buildSpeechMessages` / `buildVoteMessages` 用户消息字符串

- [ ] **Step 1: 写失败单测（追加到 `prompt.test.ts`）**

```ts
it('有前人发言时要求判断是否可能是少数，并禁止挤同一场景', () => {
  const content = buildSpeechMessages(PERSONAS[2], VIEW)[1].content as string;
  expect(content).toMatch(/少数/);
  expect(content).toMatch(/同一.*场景|挤/);
});

it('有 speechAngle 时注入 label 与 hint', () => {
  const content = buildSpeechMessages(PERSONAS[2], {
    ...VIEW,
    speechAngle: {
      id: 'habit',
      label: '个人小习惯',
      hint: '一个很小的个人习惯',
    },
  })[1].content as string;
  expect(content).toContain('个人小习惯');
  expect(content).toContain('一个很小的个人习惯');
});

it('无 speechAngle 时不出现角度硬约束套话', () => {
  const content = buildSpeechMessages(PERSONAS[2], VIEW)[1].content as string;
  expect(content).not.toMatch(/本轮你的发言角度/);
});

it('投票提示不要只因场景不同就投票', () => {
  const content = buildVoteMessages(PERSONAS[2], VIEW, [0, 3])[1].content as string;
  expect(content).toMatch(/场景/);
});
```

（若现有 `thoughtPlan` 首轮文案测试过严，同步放宽/更新断言，保持与 spec 一致。）

- [ ] **Step 2: 跑测确认新断言失败**

Run: `npx vitest run tests/agents/prompt.test.ts`  
Expected: 新 it FAIL

- [ ] **Step 3: 改 `prompt.ts`**

按 spec §4：

1. `speechStrategy`：首轮 + 有前人（同边共鸣 / 自觉少数伪装）。
2. `thoughtPlan`：有前人时顺序含「是否可能是少数」+ 伪装策略句。
3. `buildSpeechMessages`：若 `view.speechAngle` 存在，追加：

   `本轮你的发言角度是「${label}」：${hint}。speech 必须落在这个角度；不要改聊别人已经占满的同一场景。thought 里可以提及其他角度，但 speech 只走这一条。`

4. `buildVoteMessages`：追加「不要只因为对方没复述你熟悉的那个场景就投票；先看他的细节是否和你的词相容。」

- [ ] **Step 4: 全绿 prompt 测**

Run: `npx vitest run tests/agents/prompt.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agents/prompt.ts tests/agents/prompt.test.ts
git commit -m "feat(agents): ambiguous speech angles and minority camouflage prompts"
```

---

### Task 4: 泄漏回归 + 全量校验

**Files:**
- Modify/扩展: `tests/game/judge.test.ts` 或 `tests/game/session.test.ts`（择一能断言 emit/public 的地方）

- [ ] **Step 1: 写泄漏断言**

对一次发言后的公开视图或捕获的 `emit` 调用：

```ts
expect(JSON.stringify(publicPayload)).not.toContain('speechAngle');
expect(JSON.stringify(publicPayload)).not.toContain('个人小习惯'); // 若 label 可能偶然出现在 speech 文本则改用 'speechAngle'
```

优先断言事件对象 **键** 不含 `speechAngle`。

- [ ] **Step 2: 跑全量**

Run: `npm test && npm run typecheck`  
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add tests/game/judge.test.ts tests/game/session.test.ts
git commit -m "test(game): ensure speechAngle never leaks to public events"
```

- [ ] **Step 4: 手工验收清单（实现者执行，不写进 CI）**

1. `npm run dev` + 本机 OmniRoute，开 1 局。  
2. 上帝视角看四人首轮 speech 是否场景岔开。  
3. 若有人 thought 认少数，speech 是否避开送上门/自己冲类硬伤。  
4. 浏览器 Network/事件流中无 `speechAngle` 字段。

---

## Execution Handoff

计划写好后，请用户选择：

1. **Subagent-driven（推荐）** — 按 Task 派生子代理，任务间 review  
2. **Inline** — 本会话按 `executing-plans` 顺序执行  

 whicheither: 从 Task 1 开始，严格 TDD，每 Task 提交。
