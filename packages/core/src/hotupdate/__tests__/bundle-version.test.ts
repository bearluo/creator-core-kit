import { describe, expect, it } from 'vitest';
import { bundleVersionFromAssetKeys } from '../bundle-version';

describe('bundleVersionFromAssetKeys', () => {
  it('1. 内容寻址产物 → 取 index.<md5>.js 的 md5', () => {
    const keys = ['assets/foundation/cc.config.d6501.json', 'assets/foundation/index.d6501.js'];
    expect(bundleVersionFromAssetKeys('foundation', keys)).toBe('d6501');
  });

  it('2. 没开 md5Cache（index.js）→ undefined，让调用方回落', () => {
    expect(bundleVersionFromAssetKeys('shop', ['assets/shop/index.js'])).toBeUndefined();
  });

  it('3. 只认自己那个 bundle，别的包的入口不算数', () => {
    const keys = ['assets/lobby/index.aaaaa.js', 'assets/shop/index.bbbbb.js'];
    expect(bundleVersionFromAssetKeys('shop', keys)).toBe('bbbbb');
  });

  it('4. bundle 名里的连字符按字面匹配（不当正则元字符）', () => {
    const keys = ['assets/skin-base-lobby/index.c0ffe.js'];
    expect(bundleVersionFromAssetKeys('skin-base-lobby', keys)).toBe('c0ffe');
  });

  it('5. 名字前缀相同的别的包不误命中（shop vs shop-vip）', () => {
    expect(bundleVersionFromAssetKeys('shop', ['assets/shop-vip/index.12345.js'])).toBeUndefined();
  });

  it('6. 空表 / 只有资源没有入口 → undefined', () => {
    expect(bundleVersionFromAssetKeys('shop', [])).toBeUndefined();
    expect(
      bundleVersionFromAssetKeys('shop', ['assets/shop/import/ab/abcd.9f8e7.json']),
    ).toBeUndefined();
  });

  it('7. 多段名（index.a.b.js）不是 Creator 的产物形态，不认', () => {
    expect(bundleVersionFromAssetKeys('shop', ['assets/shop/index.a.b.js'])).toBeUndefined();
  });

  it('8. 子目录下的同名文件不算入口', () => {
    expect(bundleVersionFromAssetKeys('shop', ['assets/shop/sub/index.abcde.js'])).toBeUndefined();
  });
});
