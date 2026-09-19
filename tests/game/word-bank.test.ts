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
