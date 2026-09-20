import { describe, expect, it } from 'vitest';

import { createWordPairDeck, drawWordPair, loadWordPairs, validateWordPairs } from '@/lib/game/word-bank';

describe('validateWordPairs', () => {
  it('保留题材、去掉词两端空格，并拒绝倒序重复题', () => {
    expect(validateWordPairs([{ civilian: ' 相亲 ', undercover: '面试', category: 'mixup' }]))
      .toEqual([{ civilian: '相亲', undercover: '面试', category: 'mixup' }]);
    expect(() => validateWordPairs([
      { civilian: '相亲', undercover: '面试' },
      { civilian: ' 面试 ', undercover: '相亲' },
    ])).toThrow('重复');
  });

  it('拒绝无效条目和未定义的题材', () => {
    expect(() => validateWordPairs([null])).toThrow('第 0 项');
    expect(() => validateWordPairs([{ civilian: '相亲', undercover: '面试', category: 'typo' }])).toThrow('题材');
  });

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

describe('createWordPairDeck', () => {
  const pairs = [
    { civilian: '牛奶', undercover: '豆浆', category: 'classic' as const },
    { civilian: '钢笔', undercover: '铅笔', category: 'classic' as const },
    { civilian: '相亲', undercover: '面试', category: 'mixup' as const },
    { civilian: '婚礼', undercover: '年会', category: 'mixup' as const },
  ];

  it('同一袋里不重复词对，并在有其他题材时交替抽取', () => {
    const deck = createWordPairDeck(pairs);
    const drawn = Array.from({ length: 4 }, () => deck.draw(() => 0));
    expect(drawn.map((p) => p.civilian)).toEqual(['牛奶', '相亲', '钢笔', '婚礼']);
    expect(drawn.map((p) => p.category)).toEqual(['classic', 'mixup', 'classic', 'mixup']);
  });

  it('换新袋后不紧接着重复上一袋的最后一题，即使只剩一种题材', () => {
    const deck = createWordPairDeck(pairs.slice(0, 2));
    const draws = [deck.draw(() => 0), deck.draw(() => 0), deck.draw(() => 1)];
    expect(draws.map((p) => [p.civilian, p.undercover].sort().join('/')))
      .toEqual(['牛奶/豆浆', '钢笔/铅笔', '牛奶/豆浆']);
  });

  it('同一题的两个词能交换平民和卧底方向，并且不修改原词库', () => {
    const original = [{ civilian: '相亲', undercover: '面试' }];
    const deck = createWordPairDeck(original);
    expect(deck.draw(() => 0)).toEqual({ civilian: '相亲', undercover: '面试' });
    expect(deck.draw(() => 1)).toEqual({ civilian: '面试', undercover: '相亲' });
    expect(original).toEqual([{ civilian: '相亲', undercover: '面试' }]);
  });

  it('题材数量不均时仍能抽完整袋，返回对象被修改也不影响后续题目', () => {
    const deck = createWordPairDeck(pairs.slice(0, 3));
    const first = deck.draw(() => 0);
    first.civilian = '被修改';
    const later = [deck.draw(() => 0), deck.draw(() => 0), deck.draw(() => 0)];
    expect(later.map((p) => p.civilian)).toEqual(['相亲', '钢笔', '相亲']);
    expect(later.every((p) => p.civilian !== '被修改')).toBe(true);
  });

  it('空牌袋拒绝抽题', () => {
    expect(() => createWordPairDeck([])).toThrow('词库必须是非空数组');
  });

  it('完整内置词库每袋都抽到全部词对，交换方向不算新题', () => {
    const pairs = loadWordPairs();
    const deck = createWordPairDeck(pairs);
    const expected = pairs.map((p) => [p.civilian, p.undercover].sort().join('/')).sort();
    for (let bag = 0; bag < 2; bag++) {
      const drawn = Array.from({ length: pairs.length }, () => deck.draw(() => 0.9));
      expect(drawn.map((p) => [p.civilian, p.undercover].sort().join('/')).sort()).toEqual(expected);
    }
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
