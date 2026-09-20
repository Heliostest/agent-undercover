import rawWordPairs from '@/data/word-pairs.json';
import { WORD_CATEGORIES, type WordCategory, type WordPair } from '@/lib/game/types';

export function validateWordPairs(input: unknown): WordPair[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('词库必须是非空数组');
  }

  const seen = new Set<string>();
  return input.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`词库第 ${index} 项必须是词对对象`);
    }
    const pair = item as Partial<WordPair>;
    if (typeof pair.civilian !== 'string' || pair.civilian.trim() === '') {
      throw new Error(`词库第 ${index} 项缺少 civilian`);
    }
    if (typeof pair.undercover !== 'string' || pair.undercover.trim() === '') {
      throw new Error(`词库第 ${index} 项缺少 undercover`);
    }
    const civilian = pair.civilian.trim();
    const undercover = pair.undercover.trim();
    if (civilian === undercover) {
      throw new Error(`词库第 ${index} 项的两个词不能相同`);
    }
    if (pair.category !== undefined && !WORD_CATEGORIES.includes(pair.category)) {
      throw new Error(`词库第 ${index} 项的题材无效`);
    }
    const key = JSON.stringify([civilian, undercover].sort());
    if (seen.has(key)) {
      throw new Error(`词库第 ${index} 项与已有词对重复`);
    }
    seen.add(key);
    return { civilian, undercover, ...(pair.category ? { category: pair.category } : {}) };
  });
}

export interface WordPairDeck {
  draw(rng?: () => number): WordPair;
}

/** 每袋不重复，优先换题材；重装时避开刚出的词对，发词方向单独随机。 */
export function createWordPairDeck(input: WordPair[]): WordPairDeck {
  const pairs = validateWordPairs(input);
  let remaining = [...pairs];
  let lastPair: WordPair | undefined;
  let lastCategory: WordCategory | undefined;
  const categoryOf = (pair: WordPair): WordCategory => pair.category ?? 'classic';
  const choose = <T>(items: T[], rng: () => number): T =>
    items[Math.min(Math.floor(rng() * items.length), items.length - 1)];

  return {
    draw(rng = Math.random) {
      if (remaining.length === 0) remaining = [...pairs];
      const candidates = remaining.length > 1
        ? remaining.filter((pair) => pair !== lastPair)
        : remaining;
      const categories = [...new Set(candidates.map(categoryOf))];
      const otherCategories = categories.filter((category) => category !== lastCategory);
      const category = choose(otherCategories.length > 0 ? otherCategories : categories, rng);
      const pair = choose(candidates.filter((item) => categoryOf(item) === category), rng);
      remaining = remaining.filter((item) => item !== pair);
      lastPair = pair;
      lastCategory = category;
      return rng() < 0.5
        ? { ...pair }
        : { ...pair, civilian: pair.undercover, undercover: pair.civilian };
    },
  };
}

type DeckHolder = typeof globalThis & {
  __agentUndercoverWordDeck?: { signature: string; deck: WordPairDeck };
};

/** 本地服务各局共用；热更新保留进度，词库变动或服务重启后重新装袋。 */
export function drawNextWordPair(rng: () => number = Math.random): WordPair {
  const holder = globalThis as DeckHolder;
  const signature = JSON.stringify(rawWordPairs);
  if (holder.__agentUndercoverWordDeck?.signature !== signature) {
    holder.__agentUndercoverWordDeck = { signature, deck: createWordPairDeck(loadWordPairs()) };
  }
  return holder.__agentUndercoverWordDeck.deck.draw(rng);
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
