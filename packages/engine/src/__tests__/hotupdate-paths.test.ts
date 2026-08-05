import { describe, expect, it } from 'vitest';
import {
  bundleManifestName,
  bundleStoragePath,
  normalizeSearchPaths,
  retiredBundleDirs,
} from '../hotupdate-paths';

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

describe('retiredBundleDirs', () => {
  const R = '/data/files/cck-bundle-asset';
  // listFiles 的真实形状（真机 ls 对过）：完整路径、目录带尾 /、含 tinydir 给的 . 与 ..，
  // 以及 AssetsManagerEx 与 <bundle>/ 平级建的 <bundle>_temp/ 断点续传目录。
  const listing = [
    `${R}/./`,
    `${R}/../`,
    `${R}/shop/`,
    `${R}/shop_temp/`,
    `${R}/lobby/`,
    `${R}/arena/`,
    `${R}/arena_temp/`,
    `${R}/stray.txt`,
  ];

  it('只回收不在 keep 名单里的目录，连它的 _temp 一起，返回完整路径', () => {
    expect(retiredBundleDirs(listing, ['shop', 'lobby']).sort()).toEqual([`${R}/arena/`, `${R}/arena_temp/`]);
  });

  it('在用 bundle 的 _temp 不删——那是断点续传状态', () => {
    expect(retiredBundleDirs(listing, ['shop', 'lobby', 'arena'])).toEqual([]);
  });

  it('bundle 名字本身以 _temp 结尾也不误伤', () => {
    const l = [`${R}/foo_temp/`, `${R}/foo_temp_temp/`];
    expect(retiredBundleDirs(l, ['foo_temp'])).toEqual([]); // foo_temp 在用 → 连它的 _temp 一起留
    expect(retiredBundleDirs(l, ['foo'])).toEqual([`${R}/foo_temp_temp/`]); // foo_temp/ 是 foo 的续传目录
  });

  it('. 与 .. 永不返回——否则删的是存储根自己和它爹', () => {
    const out = retiredBundleDirs(listing, []);
    expect(out).not.toContain(`${R}/./`);
    expect(out).not.toContain(`${R}/../`);
    expect(out).toHaveLength(5);
  });

  it('文件（无尾 /）不动，只回收目录', () => {
    expect(retiredBundleDirs(listing, [])).not.toContain(`${R}/stray.txt`);
  });

  it('keep 里有还没下载过的 bundle 不影响结果', () => {
    expect(retiredBundleDirs(listing, ['shop', 'lobby', 'arena', 'never-downloaded'])).toEqual([]);
  });

  it('空目录列表不抛', () => {
    expect(retiredBundleDirs([], ['shop'])).toEqual([]);
  });
});
