# Spicy 词库题材 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `spicy` 词库题材（12 对八卦/撕逼/互联网黑话），抽题时袋内仍有 spicy 则只抽 spicy，耗尽后再回落旧题材轮换。

**Architecture:** 扩展 `WORD_CATEGORIES`；`data/word-pairs.json` 追加 12 对；在 `createWordPairDeck.draw` 开头把候选收窄到剩余 spicy（若有）。不拆双袋、不加配置开关。

**Tech Stack:** TypeScript 5.9（strict）、Vitest 3、既有 word-bank。无新 npm 依赖。

## Global Constraints

- **字段名：** JSON / `WordPair` 使用 `civilian` / `undercover`（不是其他别名）。
- **函数名：** `validateWordPairs` / `createWordPairDeck` / `drawNextWordPair` / `loadWordPairs`（以仓库现状为准）。
- **不上黄：** spicy 词对保持八卦/撕逼/黑话，无 NSFW。
- **旧库不动：** 现有 60 对不删不改。
- **不泄漏：** `category` 仍不得出现在公开视图 / SSE。
- **测试纪律：** 每 Task 先红后绿；收尾 `npm test` + `npm run typecheck` 全绿再提交。
- **Spec：** `docs/superpowers/specs/2026-09-21-spicy-word-bank-design.md`

---

## File Structure

| 文件 | 职责 |
|------|------|
| `lib/game/types.ts` | `WORD_CATEGORIES` 增加 `'spicy'` |
| `data/word-pairs.json` | +12 spicy 词对 |
| `lib/game/word-bank.ts` | `draw`：有 spicy 剩余时候选只留 spicy |
| `tests/game/word-bank.test.ts` | spicy 校验 + 优先抽完测试 |

---

## Task 1: 题材枚举 + 失败测试（spicy 优先）

**Files:**
- Modify: `lib/game/types.ts`
- Modify: `tests/game/word-bank.test.ts`

- [ ] **Step 1:** 在 `WORD_CATEGORIES` 末尾加入 `'spicy'`。

- [ ] **Step 2:** 在 `tests/game/word-bank.test.ts` 的 `validateWordPairs` 下增加：接受 `category: 'spicy'`；仍拒绝未知题材。

- [ ] **Step 3:** 在 `createWordPairDeck` 下增加测试：袋内含 2 spicy + 2 classic 时，前两抽（任意固定 rng）的 `category` 均为 `'spicy'`；第三抽起可为 classic。

```ts
it('袋内还有 spicy 时只抽 spicy，抽完才回落其他题材', () => {
  const deck = createWordPairDeck([
    { civilian: '牛奶', undercover: '豆浆', category: 'classic' },
    { civilian: '钢笔', undercover: '铅笔', category: 'classic' },
    { civilian: '塌房', undercover: '翻车', category: 'spicy' },
    { civilian: '对线', undercover: '撕逼', category: 'spicy' },
  ]);
  const first = deck.draw(() => 0);
  const second = deck.draw(() => 0);
  expect(first.category).toBe('spicy');
  expect(second.category).toBe('spicy');
  const third = deck.draw(() => 0);
  expect(third.category).toBe('classic');
});
```

- [ ] **Step 4:** 跑测试确认新用例失败（draw 尚未优先 spicy）：

```bash
npx vitest run tests/game/word-bank.test.ts
```

- [ ] **Step 5:** Commit

```bash
git add lib/game/types.ts tests/game/word-bank.test.ts
git commit -m "test(game): spicy 题材枚举与优先抽题红灯"
```

---

## Task 2: draw 优先 spicy + 词库 12 对

**Files:**
- Modify: `lib/game/word-bank.ts`
- Modify: `data/word-pairs.json`

- [ ] **Step 1:** 在 `createWordPairDeck.draw` 中，在得到 `candidates` 之后、选 category 之前：

```ts
const spicyRemaining = candidates.filter((pair) => categoryOf(pair) === 'spicy');
const pool = spicyRemaining.length > 0 ? spicyRemaining : candidates;
```

后续用 `pool` 替代 `candidates` 做题材轮换与抽取。

- [ ] **Step 2:** 向 `data/word-pairs.json` 追加以下 12 对（`category: "spicy"`），字段为 `civilian` / `undercover`：

塌房/翻车、对线/撕逼、吃瓜/下场、洗白/甩锅、控评/删评、站姐/黑粉、造谣/爆料、绝交/拉黑、阴阳怪气/直球、躺平/摆烂、内卷/卷王、实锤/锤。

- [ ] **Step 3:** 跑测试全绿：

```bash
npx vitest run tests/game/word-bank.test.ts
npm test
npm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add lib/game/word-bank.ts data/word-pairs.json
git commit -m "feat(game): spicy 词库与抽题优先耗尽"
```

---

## Task 3: 验收与 PR

- [ ] **Step 1:** 确认 `loadWordPairs()` 长度为 72，其中 spicy 为 12。

- [ ] **Step 2:** 推送分支 `feat/spicy-word-bank`，`gh pr create`（若尚无 PR），标题/正文说明 spicy 优先抽完再回落。

- [ ] **Step 3:** 报告：PR 链接、测试结果、词库计数。
