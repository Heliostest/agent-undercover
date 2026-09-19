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
