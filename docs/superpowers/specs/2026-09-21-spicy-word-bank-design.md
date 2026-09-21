# Spicy 词库题材 — 设计文档

日期：2026-09-21  
仓库：https://github.com/Heliostest/agent-undercover  
状态：已与产品方对齐，待实现计划

## 1. 目标

现有 60 对词（classic / workplace / social / daily / mixup）偏日常温和，对局火药味不足。

1. **新增题材 `spicy`**：八卦 / 撕逼 / 互联网黑话风格词对，**不上黄、不违法**。
2. **抽题优先**：袋里只要还剩 `spicy`，就只从 `spicy` 抽；抽空后再按原「优先换题材」逻辑抽其余词对。
3. **旧词库保留**：现有 60 对不动，作 spicy 耗尽后的后备。

方案：**A** — 在现有 `createWordPairDeck` 上加 spicy 优先过滤（不拆双袋、不加配置开关）。

## 2. 非目标

- 不上 NSFW / 成人擦边 / 违法敏感内容
- 不整库换血，不删除或改写旧 60 对
- 不做抽题权重百分比（如 70% spicy）
- 不把 `category` 暴露给玩家视图 / 公开 SSE（现有约束不变）
- 不改发言、投票、伪装、超时等游戏逻辑

## 3. 机制

### 3.1 题材枚举

`lib/game/types.ts`：

```ts
export const WORD_CATEGORIES = [
  'classic', 'workplace', 'social', 'daily', 'mixup', 'spicy',
] as const;
```

### 3.2 词库数据

`data/word-pairs.json` 追加 **12** 对，`category: "spicy"`。定稿词对：

| civilian | undercover |
|----------|------------|
| 塌房 | 翻车 |
| 对线 | 撕逼 |
| 吃瓜 | 下场 |
| 洗白 | 甩锅 |
| 控评 | 删评 |
| 站姐 | 黑粉 |
| 造谣 | 爆料 |
| 绝交 | 拉黑 |
| 阴阳怪气 | 直球 |
| 躺平 | 摆烂 |
| 内卷 | 卷王 |
| 实锤 | 锤 |

校验仍走 `validateWordPairs`（非空、两词不同、题材合法、无重复）。

### 3.3 抽题（`createWordPairDeck.draw`）

在现有「候选 → 优先换题材 → 随机方向」之前插入：

1. 若 `remaining` 中存在 `category === 'spicy'` 的词对，则本抽候选 **仅限这些 spicy**。
2. 否则沿用现有逻辑：避开刚出的词对、优先换 `lastCategory`、再随机选对；`rng() < 0.5` 时对调 civilian/undercover。
3. 整袋抽空后 `remaining = [...pairs]` 重装；重装后若含 spicy，再次进入「只抽 spicy」阶段。

`drawNextWordPair` / 全局 deck 签名逻辑不变（词库 JSON 变了会自动重装袋）。

### 3.4 测试

`tests/game/word-bank.test.ts` 增补：

- 校验接受 `category: 'spicy'`，拒绝未知题材。
- 袋内同时有 spicy 与非 spicy 时，连续抽完所有 spicy 之前，抽出的 `category` 必须全是 `spicy`。
- spicy 耗尽后，下一抽可以是非 spicy（在固定 rng 下可断言）。

## 4. 文件清单

| 路径 | 变更 |
|------|------|
| `lib/game/types.ts` | `WORD_CATEGORIES` 增加 `spicy` |
| `data/word-pairs.json` | +12 spicy 词对 |
| `lib/game/word-bank.ts` | `draw` 在有 spicy 剩余时只抽 spicy |
| `tests/game/word-bank.test.ts` | 优先抽题 + 题材校验 |

## 5. 验收

- 冷启动后连续开 12 局（或同进程连抽 12 次），题目题材均为 spicy（忽略方向对调）。
- 第 13 次起可出现旧题材。
- 公开视图仍无 `category` 字段。
- 现有 word-bank / bootstrap 相关测试通过。
