import { describe, expect, it } from 'vitest';
import { bundleManifestName, bundleStoragePath, normalizeSearchPaths } from '../hotupdate-paths';

describe('normalizeSearchPaths', () => {
  it('去重且保序（首次出现的位置）', () => {
    // 真机实测过的形状：C++ 已前插一次、JS 再插一次 → 同一条重复
    expect(
      normalizeSearchPaths([
        '/data/files/cck-remote-asset/',
        '/data/files/cck-remote-asset/',
        '@assets/',
        '@assets/data/',
        '@assets/',
      ]),
    ).toEqual(['/data/files/cck-remote-asset/', '@assets/', '@assets/data/']);
  });

  it('滤掉空串（裸文件名 manifestUrl 时 C++ 会前插一个）', () => {
    expect(normalizeSearchPaths(['', '/a/', ''])).toEqual(['/a/']);
  });

  it('已归一的数组原样返回', () => {
    expect(normalizeSearchPaths(['/a/', '/b/'])).toEqual(['/a/', '/b/']);
  });

  it('空数组不抛', () => {
    expect(normalizeSearchPaths([])).toEqual([]);
  });

  it('不被 Set 展开降级坑到——多元素集合必须逐个保留', () => {
    const many = Array.from({ length: 5 }, (_, i) => `/p${i}/`);
    expect(normalizeSearchPaths(many)).toHaveLength(5);
  });
});

describe('bundleStoragePath', () => {
  it('一 bundle 一目录，root 尾斜杠可有可无', () => {
    expect(bundleStoragePath('/data/files/cck-bundle-asset/', 'shop')).toBe(
      '/data/files/cck-bundle-asset/shop/',
    );
    expect(bundleStoragePath('/data/files/cck-bundle-asset', 'shop')).toBe(
      '/data/files/cck-bundle-asset/shop/',
    );
  });

  it('不同 bundle 互不包含（缓存 manifest 文件名写死，重叠即互相覆盖）', () => {
    const a = bundleStoragePath('/r/', 'shop');
    const b = bundleStoragePath('/r/', 'lobby');
    expect(a.startsWith(b)).toBe(false);
    expect(b.startsWith(a)).toBe(false);
  });
});

describe('bundleManifestName', () => {
  it('对齐 cck-manifest --split 的产物名', () => {
    expect(bundleManifestName('shop')).toBe('shop.manifest');
  });
});
