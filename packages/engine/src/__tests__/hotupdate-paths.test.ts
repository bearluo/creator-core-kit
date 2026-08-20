import { afterEach, describe, expect, it } from 'vitest';
import {
  aotStamp,
  bundleManifestName,
  bundleStoragePath,
  bundleVersionName,
  manifestAssetKeys,
  normalizeSearchPaths,
  packagedAotEntry,
  rebaseManifest,
  retiredBundleDirs,
  searchPathsWithout,
  seedBundleManifest,
  engineHash,
  engineHashFromUrl,
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
    expect(bundleVersionName('shop')).toBe('shop.version.manifest');
  });
});

describe('seedBundleManifest', () => {
  const parse = (cdn: string, b: string): Record<string, unknown> =>
    JSON.parse(seedBundleManifest(cdn, b)) as Record<string, unknown>;

  it('远端地址指向 --split 出的那一对，基址尾斜杠可有可无', () => {
    for (const cdn of ['https://cdn.example.com/v1/', 'https://cdn.example.com/v1']) {
      expect(parse(cdn, 'skin-vest-mail')).toMatchObject({
        packageUrl: 'https://cdn.example.com/v1/',
        remoteManifestUrl: 'https://cdn.example.com/v1/skin-vest-mail.manifest',
        remoteVersionUrl: 'https://cdn.example.com/v1/skin-vest-mail.version.manifest',
      });
    }
  });

  it('asset 表为空 → diff 出全量（种子的用途就是把从没随包发过的包整个下下来）', () => {
    expect(parse('http://cdn/', 'shop')['assets']).toEqual({});
  });

  it('版本恒为 0.0.0 —— 比它新的缓存 manifest 才能接管，否则每次启动都被 removeDirectory 抹了重下', () => {
    expect(parse('http://cdn/', 'shop')['version']).toBe('0.0.0');
  });

  it('是合法 JSON 且字段齐全（少一个 Manifest::loadManifest 就取不到远端地址）', () => {
    const m = parse('http://cdn/', 'shop');
    for (const k of ['packageUrl', 'remoteManifestUrl', 'remoteVersionUrl', 'version', 'assets', 'searchPaths']) {
      expect(m).toHaveProperty(k);
    }
  });
});

describe('rebaseManifest', () => {
  /** 一份最小但字段齐全的远端 manifest，基址是「出包时烘进去的老地址」。 */
  const REMOTE = JSON.stringify({
    packageUrl: 'http://old-cdn/baked/',
    remoteManifestUrl: 'http://old-cdn/baked/project.manifest',
    remoteVersionUrl: 'http://old-cdn/baked/version.manifest',
    version: '1.0.7',
    assets: { 'src/index.js': { size: 12, md5: 'abc' } },
    searchPaths: ['x'],
  });
  const parse = (cdn: string): Record<string, unknown> =>
    JSON.parse(rebaseManifest(REMOTE, cdn, 'project.manifest', 'version.manifest')) as Record<
      string,
      unknown
    >;

  it('三个地址全部改写到下发的基址，尾斜杠可有可无', () => {
    for (const cdn of ['http://new-cdn/live/', 'http://new-cdn/live']) {
      expect(parse(cdn)).toMatchObject({
        packageUrl: 'http://new-cdn/live/',
        remoteManifestUrl: 'http://new-cdn/live/project.manifest',
        remoteVersionUrl: 'http://new-cdn/live/version.manifest',
      });
    }
  });

  it('version / assets / searchPaths 原样保留 —— 动了 assets 就是拿全量当增量下', () => {
    expect(parse('http://new-cdn/live/')).toMatchObject({
      version: '1.0.7',
      assets: { 'src/index.js': { size: 12, md5: 'abc' } },
      searchPaths: ['x'],
    });
  });

  it('分包的那对文件名同样能改（base 与 bundle 走同一条注入路）', () => {
    const m = JSON.parse(
      rebaseManifest(REMOTE, 'http://new-cdn/live', 'shop.manifest', 'shop.version.manifest'),
    ) as Record<string, unknown>;
    expect(m['remoteManifestUrl']).toBe('http://new-cdn/live/shop.manifest');
    expect(m['remoteVersionUrl']).toBe('http://new-cdn/live/shop.version.manifest');
  });

  it('非 JSON 直接抛 —— CDN 路由错了会回一坨 200 的 HTML，别把它当 manifest 灌进引擎', () => {
    expect(() => rebaseManifest('<!doctype html><html>', 'http://cdn/', 'a.manifest', 'a.v')).toThrow();
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

describe('manifestAssetKeys（反推该加载哪个 md5 的输入）', () => {
  it('取 assets 的键', () => {
    const j = JSON.stringify({
      version: '1.0.1',
      assets: { 'assets/shop/index.a1b2c.js': { size: 1, md5: 'x' }, 'assets/shop/cc.config.a1b2c.json': {} },
    });
    expect(manifestAssetKeys(j)).toEqual(['assets/shop/index.a1b2c.js', 'assets/shop/cc.config.a1b2c.json']);
  });

  it('种子 manifest（assets 空）→ 空数组', () => {
    expect(manifestAssetKeys(seedBundleManifest('http://cdn/', 'shop'))).toEqual([]);
  });

  it('不是 JSON（CDN 路由错时会回 200 + 一坨 HTML）→ 空数组，不抛', () => {
    expect(manifestAssetKeys('<!doctype html><html>404</html>')).toEqual([]);
  });

  it('没有 assets 字段 / assets 不是对象 → 空数组', () => {
    expect(manifestAssetKeys('{"version":"1.0.1"}')).toEqual([]);
    expect(manifestAssetKeys('{"assets":[1,2]}')).toEqual([]);
    expect(manifestAssetKeys('null')).toEqual([]);
  });
});

describe('aotStamp（APK 换没换的判据 = 包内 AOT 入口的 md5）', () => {
  it('从 main.js 烘的入口名抠 md5，前缀形态不挑', () => {
    expect(aotStamp('./application.56453.js')).toBe('56453');
    expect(aotStamp('application.56453.js')).toBe('56453');
  });

  it('没开 md5Cache（application.js）→ undefined = 判不了，调用方原样不动', () => {
    expect(aotStamp('./application.js')).toBeUndefined();
  });

  it('老模板没挂全局 / 形状不认识 → undefined 而不是抛', () => {
    expect(aotStamp(undefined)).toBeUndefined();
    expect(aotStamp(null)).toBeUndefined();
    expect(aotStamp('')).toBeUndefined();
    expect(aotStamp('./main.js')).toBeUndefined();
    expect(aotStamp('./application.a.b.js')).toBeUndefined();
  });

  it('AOT 热更换了入口，这个判据也不该跟着翻 —— 它读的是包内那份', () => {
    // 同一个 APK 里 main.js 烘的名字恒定；运行时真正加载的入口是另一回事（指针解析出来的）。
    const packaged = './application.56453.js';
    expect(aotStamp(packaged)).toBe(aotStamp(packaged));
    expect(aotStamp('./application.99999.js')).not.toBe(aotStamp(packaged)); // 换了 APK 才翻
  });
});

describe('packagedAotEntry（main.js 挂上来的包内入口名）', () => {
  const g = globalThis as { __cckAotEntry?: unknown };
  afterEach(() => delete g.__cckAotEntry);

  it('挂了就取到', () => {
    g.__cckAotEntry = './application.56453.js';
    expect(packagedAotEntry()).toBe('./application.56453.js');
  });

  it('没挂 / 空串 / 不是字符串 → undefined（闸休眠，别当成换了 APK）', () => {
    expect(packagedAotEntry()).toBeUndefined();
    g.__cckAotEntry = '';
    expect(packagedAotEntry()).toBeUndefined();
    g.__cckAotEntry = 42;
    expect(packagedAotEntry()).toBeUndefined();
  });
});

describe('searchPathsWithout（删完热更目录，指向它的搜索路径也要摘掉）', () => {
  const base = '/w/cck-remote-asset/';
  const root = '/w/cck-bundle-asset/';

  it('摘掉前缀命中的，保留其余；顺带去重滤空（复用 normalizeSearchPaths）', () => {
    const got = searchPathsWithout(
      [base, `${root}shop/`, '', '@assets/', '@assets/', '/w/other/'],
      [base, root],
    );
    expect(got).toEqual(['@assets/', '/w/other/']);
  });

  it('没有命中项 → 只做归一化', () => {
    expect(searchPathsWithout(['@assets/', '@assets/'], [base])).toEqual(['@assets/']);
  });
});

describe('engineHashFromUrl（引擎内容指纹 = cc.<md5>.js 的那段 md5）', () => {
  it('认得出各种解析形态', () => {
    expect(engineHashFromUrl('./cocos-js/cc.25e81.js')).toBe('25e81');
    expect(engineHashFromUrl('src/cocos-js/cc.25e81.js')).toBe('25e81');
    expect(engineHashFromUrl('http://h/src/cocos-js/cc.25e81.js?v=1')).toBe('25e81');
  });

  it('没开 md5Cache（就叫 cc.js）→ undefined，闸休眠而不是误判', () => {
    expect(engineHashFromUrl('src/cocos-js/cc.js')).toBeUndefined();
  });

  it('不是 cc 模块 / 非字符串 → undefined', () => {
    expect(engineHashFromUrl('src/chunks/bundle.50111.js')).toBeUndefined();
    expect(engineHashFromUrl('src/cocos-js/ccx.25e81.js')).toBeUndefined();
    expect(engineHashFromUrl(undefined)).toBeUndefined();
    expect(engineHashFromUrl(null)).toBeUndefined();
  });
});

describe('engineHash（走 SystemJS 的 import map，不碰文件系统）', () => {
  const g = globalThis as { System?: unknown };
  const saved = g.System;
  afterEach(() => {
    if (saved === undefined) delete g.System;
    else g.System = saved;
  });

  it('SystemJS 解析得到 cc → 抠出指纹', () => {
    g.System = { resolve: (id: string) => (id === 'cc' ? 'src/cocos-js/cc.25e81.js' : id) };
    expect(engineHash()).toBe('25e81');
  });

  it('没有 SystemJS（编辑器 / 单测环境）→ undefined', () => {
    delete g.System;
    expect(engineHash()).toBeUndefined();
  });

  it('resolve 抛（没 warmup）→ undefined 而不是炸掉启动', () => {
    g.System = { resolve: () => { throw new Error('no such module'); } };
    expect(engineHash()).toBeUndefined();
  });
});
