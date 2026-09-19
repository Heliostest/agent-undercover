import { describe, expect, it } from 'vitest';

import { loadWordPairs } from '@/lib/game/word-bank';

describe('测试基线', () => {
  it('可以通过 @ 别名 import lib 模块并读取内置 JSON', () => {
    expect(loadWordPairs()[0].civilian).toBe('牛奶');
  });
});
