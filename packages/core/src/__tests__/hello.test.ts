import { describe, it, expect } from 'vitest';
import { hello, CCK_CORE_VERSION } from '../index';

describe('@cck/core 骨架自检', () => {
  it('hello() 返回问候语（证明纯逻辑可在 node 环境单测、零 cc）', () => {
    expect(hello('cck')).toBe('hello, cck from @cck/core');
  });

  it('导出版本号常量', () => {
    expect(CCK_CORE_VERSION).toBe('0.0.0');
  });
});
