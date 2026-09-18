import { describe, expect, it } from 'vitest';

import { APP_NAME } from '@/lib/game/version';

describe('测试基线', () => {
  it('可以通过 @ 别名 import lib 模块', () => {
    expect(APP_NAME).toBe('agent-undercover');
  });
});
