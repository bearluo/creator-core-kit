import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  archiveManifests,
  buildManifest,
  buildSplitManifests,
  isEngineBound,
  toVersionManifest,
  rollbackManifests,
  verifyManifest,
  writeManifests,
  writeSplitManifests,
  type Manifest,
} from '../hot-update-manifest';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cck-manifest-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'assets', 'sub'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.js'), 'console.log(1)'); // 14 字节
  writeFileSync(join(root, 'assets', 'sub', 'data.json'), '{"a":1}');
  writeFileSync(join(root, 'assets', 'pack.zip'), 'ZIPBYTES');
  writeFileSync(join(root, 'assets', '.hidden'), 'secret'); // 隐藏文件应被跳过
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const opts = () => ({ root, packageUrl: 'http://host/remote', version: '1.2.3' });

describe('buildManifest', () => {
  it('md5/size 正确，key 用相对 root 的正斜杠路径（子目录含）', () => {
    const m = buildManifest(opts());
    const md5 = createHash('md5').update(readFileSync(join(root, 'src', 'app.js'))).digest('hex');
    expect(m.assets['src/app.js'].md5).toBe(md5);
    expect(m.assets['src/app.js'].size).toBe(14);
    expect(m.assets['assets/sub/data.json']).toBeDefined();
  });

  it('.zip 标 compressed，非 zip 不带该字段', () => {
    const m = buildManifest(opts());
    expect(m.assets['assets/pack.zip'].compressed).toBe(true);
    expect(m.assets['src/app.js'].compressed).toBeUndefined();
  });

  it('隐藏文件被跳过', () => {
    const m = buildManifest(opts());
    expect(Object.keys(m.assets).some((k) => k.includes('.hidden'))).toBe(false);
  });

  it('dirs 里不存在的子目录静默跳过、不抛', () => {
    expect(() => buildManifest({ ...opts(), dirs: ['src', 'does-not-exist'] })).not.toThrow();
  });

  it('packageUrl 补尾斜杠，remote URL 拼接正确', () => {
    const m = buildManifest(opts());
    expect(m.packageUrl).toBe('http://host/remote/');
    expect(m.remoteManifestUrl).toBe('http://host/remote/project.manifest');
    expect(m.remoteVersionUrl).toBe('http://host/remote/version.manifest');
  });
});

describe('toVersionManifest', () => {
  it('删 assets + searchPaths，其余保留', () => {
    const v = toVersionManifest(buildManifest(opts()));
    expect(v).not.toHaveProperty('assets');
    expect(v).not.toHaveProperty('searchPaths');
    expect(v.version).toBe('1.2.3');
    expect(v.remoteManifestUrl).toBe('http://host/remote/project.manifest');
  });
});

describe('buildSplitManifests（分包：base + 每个模块 bundle 一份）', () => {
  let sroot: string;

  beforeAll(() => {
    sroot = mkdtempSync(join(tmpdir(), 'cck-split-'));
    mkdirSync(join(sroot, 'src', 'cocos-js'), { recursive: true });
    mkdirSync(join(sroot, 'jsb-adapter'), { recursive: true });
    for (const b of ['main', 'internal', 'shop', 'lobby']) {
      mkdirSync(join(sroot, 'assets', b, 'import'), { recursive: true });
      writeFileSync(join(sroot, 'assets', b, 'index.js'), `// ${b}`);
      writeFileSync(join(sroot, 'assets', b, 'import', 'a.json'), '{}');
    }
    mkdirSync(join(sroot, 'assets', 'empty-bundle'), { recursive: true });
    writeFileSync(join(sroot, 'src', 'cocos-js', 'cc.js'), 'cc');
    writeFileSync(join(sroot, 'src', 'settings.json'), '{}');
    writeFileSync(join(sroot, 'jsb-adapter', 'engine-adapter.js'), 'ea');
    writeFileSync(join(sroot, 'assets', 'loose.txt'), 'x'); // assets 下的散文件，归 base
  });

  afterAll(() => rmSync(sroot, { recursive: true, force: true }));

  const sopts = () => ({ root: sroot, packageUrl: 'http://host/cdn', version: '2.0.0' });

  it('base ∪ bundles 恰好等于不切分时的全表——无重叠、无遗漏', () => {
    const whole = Object.keys(buildManifest(sopts()).assets).sort();
    const { base, bundles } = buildSplitManifests(sopts());
    const parts = [...Object.keys(base.assets), ...Object.values(bundles).flatMap((m) => Object.keys(m.assets))];
    expect(parts.length).toBe(whole.length); // 长度相等 + 集合相等 ⇒ 无重复
    expect([...parts].sort()).toEqual(whole);
  });

  it('模块 bundle 的 key 仍相对 data 根（不是相对 bundle 目录）', () => {
    const { bundles } = buildSplitManifests(sopts());
    expect(Object.keys(bundles.shop.assets).sort()).toEqual(['assets/shop/import/a.json', 'assets/shop/index.js']);
  });

  it('默认 base 名单（main/internal/resources）归 base，其余各自成包', () => {
    const { base, bundles } = buildSplitManifests(sopts());
    expect(Object.keys(bundles).sort()).toEqual(['lobby', 'shop']);
    expect(base.assets['assets/main/index.js']).toBeDefined();
    expect(base.assets['assets/internal/index.js']).toBeDefined();
    expect(base.assets['src/cocos-js/cc.js']).toBeDefined();
    expect(base.assets['jsb-adapter/engine-adapter.js']).toBeDefined();
    expect(base.assets['assets/loose.txt']).toBeDefined(); // assets 下的散文件
  });

  it('base 名单可配：把 lobby 也划进 base 后它不再单独成包', () => {
    const { base, bundles } = buildSplitManifests({ ...sopts(), baseBundles: ['main', 'internal', 'lobby'] });
    expect(Object.keys(bundles)).toEqual(['shop']);
    expect(base.assets['assets/lobby/index.js']).toBeDefined();
  });

  it('空 bundle 目录不产出空 manifest', () => {
    const { bundles } = buildSplitManifests(sopts());
    expect(bundles['empty-bundle']).toBeUndefined();
  });

  it('各 manifest 的 remote URL 指向各自的文件名', () => {
    const { base, bundles } = buildSplitManifests(sopts());
    expect(base.remoteManifestUrl).toBe('http://host/cdn/project.manifest');
    expect(base.remoteVersionUrl).toBe('http://host/cdn/version.manifest');
    expect(bundles.shop.remoteManifestUrl).toBe('http://host/cdn/shop.manifest');
    expect(bundles.shop.remoteVersionUrl).toBe('http://host/cdn/shop.version.manifest');
    expect(bundles.shop.version).toBe('2.0.0');
  });

  it('writeSplitManifests 落盘：base 用 project/version，模块用 <name>.manifest', () => {
    const out = mkdtempSync(join(tmpdir(), 'cck-split-out-'));
    const r = writeSplitManifests({ ...sopts(), outDir: out });
    expect(r.base.projectPath).toBe(join(out, 'project.manifest'));
    expect(r.bundles.shop.projectPath).toBe(join(out, 'shop.manifest'));
    expect(r.bundles.shop.versionPath).toBe(join(out, 'shop.version.manifest'));
    const lobby = JSON.parse(readFileSync(r.bundles.lobby.projectPath, 'utf8')) as Manifest;
    expect(Object.keys(lobby.assets).sort()).toEqual(['assets/lobby/import/a.json', 'assets/lobby/index.js']);
    expect(JSON.parse(readFileSync(r.bundles.lobby.versionPath, 'utf8'))).not.toHaveProperty('assets');
    // 每份 manifest 都能对同一个 root 自校验
    expect(verifyManifest(r.bundles.shop.projectPath, sroot)).toEqual([]);
    expect(verifyManifest(r.base.projectPath, sroot)).toEqual([]);
    rmSync(out, { recursive: true, force: true });
  });

  describe('prevDir：内容没动的包沿用旧版本号', () => {
    /** 原地发布：读同一个目录里的上一版、再写回去（真实 CDN 目录的用法）。 */
    const publish = (version: string, dir: string) =>
      writeSplitManifests({ ...sopts(), version, outDir: dir, prevDir: dir });

    let prev: string;
    beforeAll(() => {
      prev = mkdtempSync(join(tmpdir(), 'cck-prev-'));
      writeSplitManifests({ ...sopts(), version: '1.0.0', outDir: prev });
    });
    afterAll(() => rmSync(prev, { recursive: true, force: true }));

    it('全都没改 → base 和每个 bundle 都还是 1.0.0', () => {
      const { base, bundles } = buildSplitManifests({ ...sopts(), version: '1.0.1', prevDir: prev });
      expect(base.version).toBe('1.0.0');
      expect(bundles.shop.version).toBe('1.0.0');
      expect(bundles.lobby.version).toBe('1.0.0');
    });

    it('只改 shop → 只有 shop 涨到 1.0.1，lobby 与 base 不动', () => {
      const file = join(sroot, 'assets', 'shop', 'index.js');
      writeFileSync(file, '// shop v2');
      try {
        const { base, bundles } = buildSplitManifests({ ...sopts(), version: '1.0.1', prevDir: prev });
        expect(bundles.shop.version).toBe('1.0.1');
        expect(bundles.lobby.version).toBe('1.0.0');
        expect(base.version).toBe('1.0.0');
      } finally {
        writeFileSync(file, '// shop');
      }
    });

    it('改 base 里的文件 → base 涨版本，模块包不受影响', () => {
      const file = join(sroot, 'src', 'settings.json');
      writeFileSync(file, '{"changed":1}');
      try {
        const { base, bundles } = buildSplitManifests({ ...sopts(), version: '1.0.1', prevDir: prev });
        expect(base.version).toBe('1.0.1');
        expect(bundles.shop.version).toBe('1.0.0');
      } finally {
        writeFileSync(file, '{}');
      }
    });

    // 口径与引擎的 `Manifest::genDiff` 对齐：它只比资产表。判"改了"而引擎判"没改"，产出的就是
    // 「版本号涨了、引擎却算出空 diff」——AssetsManagerEx 在那个状态下会在 worker 线程上
    // updateSucceed() → UPDATE_FINISHED 进 JS VM → SIGSEGV。换址走 dispatcher 下发，不靠涨版本。
    it('packageUrl 变了不算改动——引擎 genDiff 不看它，涨版本只会造出空 diff 崩溃态', () => {
      const { bundles } = buildSplitManifests({
        ...sopts(),
        packageUrl: 'http://other/cdn',
        version: '1.0.1',
        prevDir: prev,
      });
      expect(bundles.shop.version).toBe('1.0.0');
    });

    it('资产真变了 → 照涨，不受 packageUrl 影响', () => {
      const file = join(sroot, 'assets', 'shop', 'index.js');
      writeFileSync(file, '// shop v3');
      try {
        const { bundles } = buildSplitManifests({
          ...sopts(),
          packageUrl: 'http://other/cdn',
          version: '1.0.1',
          prevDir: prev,
        });
        expect(bundles.shop.version).toBe('1.0.1');
      } finally {
        writeFileSync(file, '// shop');
      }
    });

    it('不给 prevDir → 一律用新版本号（老行为）', () => {
      const { base, bundles } = buildSplitManifests({ ...sopts(), version: '1.0.1' });
      expect(base.version).toBe('1.0.1');
      expect(bundles.shop.version).toBe('1.0.1');
    });

    it('prevDir 指向空目录 / 缺某个包的 manifest → 那个包用新版本号', () => {
      const empty = mkdtempSync(join(tmpdir(), 'cck-empty-'));
      const { base, bundles } = buildSplitManifests({ ...sopts(), version: '1.0.1', prevDir: empty });
      expect(base.version).toBe('1.0.1');
      expect(bundles.shop.version).toBe('1.0.1');
      rmSync(empty, { recursive: true, force: true });
    });

    it('prevDir 里是坏 JSON → 当没有上一版，不抛', () => {
      const broken = mkdtempSync(join(tmpdir(), 'cck-broken-'));
      writeFileSync(join(broken, 'shop.manifest'), '{ not json');
      expect(() => buildSplitManifests({ ...sopts(), version: '1.0.1', prevDir: broken })).not.toThrow();
      expect(buildSplitManifests({ ...sopts(), version: '1.0.1', prevDir: broken }).bundles.shop.version).toBe('1.0.1');
      rmSync(broken, { recursive: true, force: true });
    });

    it('prevDir === outDir（原地发进 CDN 目录）：先读后写，沿用生效', () => {
      const dir = mkdtempSync(join(tmpdir(), 'cck-inplace-'));
      publish('1.0.0', dir);
      const again = publish('1.0.1', dir);
      expect(again.bundles.shop.manifest.version).toBe('1.0.0');
      const onDisk = JSON.parse(readFileSync(again.bundles.shop.versionPath, 'utf8')) as Manifest;
      expect(onDisk.version).toBe('1.0.0');
      rmSync(dir, { recursive: true, force: true });
    });
  });
});

describe('writeManifests + verifyManifest', () => {
  it('落两份、可 JSON.parse 回来、自校验通过', () => {
    const out = mkdtempSync(join(tmpdir(), 'cck-out-'));
    const { projectPath, versionPath } = writeManifests({ ...opts(), outDir: out });
    const proj = JSON.parse(readFileSync(projectPath, 'utf8')) as { assets: Record<string, unknown> };
    expect(proj.assets['src/app.js']).toBeDefined();
    expect(JSON.parse(readFileSync(versionPath, 'utf8'))).not.toHaveProperty('assets');
    expect(verifyManifest(projectPath, root)).toEqual([]);
    rmSync(out, { recursive: true, force: true });
  });

  it('改内容（同尺寸）→ md5-mismatch，删文件 → missing', () => {
    const out = mkdtempSync(join(tmpdir(), 'cck-out2-'));
    const { projectPath } = writeManifests({ ...opts(), outDir: out });

    writeFileSync(join(root, 'src', 'app.js'), 'console.log(2)'); // 仍 14 字节 → 只 md5 变
    expect(verifyManifest(projectPath, root)).toContainEqual({ path: 'src/app.js', reason: 'md5-mismatch' });
    writeFileSync(join(root, 'src', 'app.js'), 'console.log(1)'); // 复原

    rmSync(join(root, 'assets', 'pack.zip'));
    expect(verifyManifest(projectPath, root)).toContainEqual({ path: 'assets/pack.zip', reason: 'missing' });
    writeFileSync(join(root, 'assets', 'pack.zip'), 'ZIPBYTES'); // 复原

    rmSync(out, { recursive: true, force: true });
  });
});

describe('contentHashed：md5 产物下 base 只丢引擎那一半', () => {
  let croot: string;

  beforeAll(() => {
    croot = mkdtempSync(join(tmpdir(), 'cck-md5-'));
    mkdirSync(join(croot, 'src', 'cocos-js'), { recursive: true });
    mkdirSync(join(croot, 'jsb-adapter'), { recursive: true });
    for (const b of ['main', 'internal', 'resources', 'foundation', 'shop']) {
      mkdirSync(join(croot, 'assets', b), { recursive: true });
      writeFileSync(join(croot, 'assets', b, `index.${b.slice(0, 5)}.js`), `// ${b}`);
      writeFileSync(join(croot, 'assets', b, `cc.config.${b.slice(0, 5)}.json`), '{}');
    }
    mkdirSync(join(croot, 'src', 'chunks'), { recursive: true });
    writeFileSync(join(croot, 'src', 'settings.763c7.json'), '{}');
    writeFileSync(join(croot, 'src', 'cck-base.json'), '{"application":"./application.56453.js"}');
    writeFileSync(join(croot, 'src', 'chunks', 'bundle.30ac6.js'), '// biz');
    writeFileSync(join(croot, 'application.56453.js'), '// entry');
    writeFileSync(join(croot, 'main.js'), '// boot');
    // 引擎那一半 —— 一个都不许进 base
    writeFileSync(join(croot, 'src', 'import-map.1d8b3.json'), '{}');
    writeFileSync(join(croot, 'src', 'system.bundle.590c7.js'), 'sys');
    writeFileSync(join(croot, 'src', 'effect.bin'), 'bin');
    writeFileSync(join(croot, 'src', 'cocos-js', 'cc.aaaaa.js'), 'cc');
    writeFileSync(join(croot, 'jsb-adapter', 'engine-adapter.js'), 'ea');
  });

  afterAll(() => rmSync(croot, { recursive: true, force: true }));

  const copts = () => ({
    root: croot,
    packageUrl: 'http://host/cdn',
    version: '3.0.0',
    files: ['application.56453.js'],
  });

  it('base 整条链都在 base 里：入口 + 指针 + settings + chunks + base 包', () => {
    const keys = Object.keys(buildSplitManifests({ ...copts(), contentHashed: true }).base.assets);
    expect(keys).toContain('application.56453.js');
    expect(keys).toContain('src/cck-base.json');
    expect(keys).toContain('src/settings.763c7.json');
    expect(keys).toContain('src/chunks/bundle.30ac6.js');
    for (const b of ['main', 'internal', 'resources']) {
      expect(keys).toContain(`assets/${b}/index.${b.slice(0, 5)}.js`);
    }
  });

  it('引擎绑死 / 名字写死的那几类一个都不发', () => {
    const keys = Object.keys(buildSplitManifests({ ...copts(), contentHashed: true }).base.assets);
    expect(keys).not.toContain('src/cocos-js/cc.aaaaa.js');
    expect(keys).not.toContain('src/effect.bin');
    expect(keys).not.toContain('src/system.bundle.590c7.js');
    expect(keys).not.toContain('src/import-map.1d8b3.json');
    expect(keys).not.toContain('jsb-adapter/engine-adapter.js');
  });

  it('main.js 永远不进任何 manifest —— 它跑在搜索路径还原之前', () => {
    const keys = Object.keys(buildSplitManifests({ ...copts(), contentHashed: true }).base.assets);
    expect(keys).not.toContain('main.js');
  });

  it('模块 bundle 一个不少，内容与不开这个开关时完全一致', () => {
    const off = buildSplitManifests(copts());
    const on = buildSplitManifests({ ...copts(), contentHashed: true });
    expect(Object.keys(on.bundles).sort()).toEqual(['foundation', 'shop']);
    expect(on.bundles).toEqual(off.bundles);
  });

  it('不开开关时 base 照收全表，连引擎那一半也在（老产物行为不变）', () => {
    const keys = Object.keys(buildSplitManifests(copts()).base.assets);
    expect(keys).toContain('src/settings.763c7.json');
    expect(keys).toContain('assets/main/index.main.js');
    expect(keys).toContain('src/cocos-js/cc.aaaaa.js');
    expect(keys).toContain('jsb-adapter/engine-adapter.js');
  });
});

describe('isEngineBound（与 .so 绑死 / 名字被 main.js 写死的那几类）', () => {
  it('引擎那一半', () => {
    expect(isEngineBound('src/cocos-js/cc.25e81.js')).toBe(true);
    expect(isEngineBound('src/effect.bin')).toBe(true);
    expect(isEngineBound('jsb-adapter/engine-adapter.js')).toBe(true);
    expect(isEngineBound('jsb-adapter/web-adapter.js')).toBe(true);
  });

  it('名字被 main.js 写死的引导链（开不开 md5 都认）', () => {
    expect(isEngineBound('src/system.bundle.590c7.js')).toBe(true);
    expect(isEngineBound('src/system.bundle.js')).toBe(true);
    expect(isEngineBound('src/polyfills.abc12.js')).toBe(true);
    expect(isEngineBound('src/import-map.1d8b3.json')).toBe(true);
    expect(isEngineBound('src/import-map.json')).toBe(true);
  });

  it('引擎那一半一个都不误伤', () => {
    for (const k of [
      'application.56453.js',
      'src/cck-base.json',
      'src/settings.a25ff.json',
      'src/chunks/bundle.30ac6.js',
      'assets/main/index.59bfe.js',
      'assets/resources/native/20835ba4.png',
    ]) {
      expect(isEngineBound(k)).toBe(false);
    }
  });

  it('前缀相近的不误伤：cocos-js 得是目录、effect.bin 得在 src 根', () => {
    expect(isEngineBound('src/cocos-jsx/a.js')).toBe(false);
    expect(isEngineBound('assets/main/effect.bin')).toBe(false);
    expect(isEngineBound('src/chunks/effect.bin')).toBe(false);
    expect(isEngineBound('src/system.bundle.a.b.js')).toBe(false); // 不是 Creator 的产物形态
  });
});

describe('files（收产物根上的散文件）', () => {
  it('收进来，key 相对 root；不存在的跳过', () => {
    const m = buildManifest({ ...opts(), files: ['src/app.js', 'nope.js'] });
    expect(m.assets['src/app.js']).toBeDefined();
    expect(m.assets['nope.js']).toBeUndefined();
  });

  it('传目录名不当文件收', () => {
    const m = buildManifest({ ...opts(), dirs: [], files: ['src'] });
    expect(Object.keys(m.assets)).toEqual([]);
  });
});

describe('archive + rollback（回滚 = 发一版号更大、内容是旧的）', () => {
  let cdn: string;

  beforeAll(() => {
    cdn = mkdtempSync(join(tmpdir(), 'cck-cdn-'));
  });
  afterAll(() => rmSync(cdn, { recursive: true, force: true }));

  /** 往 CDN 根写一版 manifest（只关心 version 与 assets 的身份，不必是真产物）。 */
  const publish = (version: string, entry: string): void => {
    for (const f of ['project.manifest', 'shop.manifest']) {
      writeFileSync(join(cdn, f), JSON.stringify({ version, assets: { [entry]: { size: 1, md5: 'x' } } }));
    }
    writeFileSync(join(cdn, 'shop.version.manifest'), JSON.stringify({ version }));
    archiveManifests(cdn, version);
  };

  it('archive 把这一版的 manifest 收进 releases/<version>/（只收 manifest，不收内容）', () => {
    publish('1.0.3', 'assets/shop/index.aaaaa.js');
    const dir = join(cdn, 'releases', '1.0.3');
    expect(readdirSync(dir).sort()).toEqual(['project.manifest', 'shop.manifest', 'shop.version.manifest']);
  });

  it('rollback 把旧内容配上更大的号发回根，并顺手归档新号', () => {
    publish('1.0.3', 'assets/shop/index.aaaaa.js');
    publish('1.0.5', 'assets/shop/index.bbbbb.js');

    const r = rollbackManifests({ cdnDir: cdn, release: '1.0.3', version: '1.0.6' });
    expect(r.changed.sort()).toEqual(['project.manifest', 'shop.manifest']);

    const m = JSON.parse(readFileSync(join(cdn, 'shop.manifest'), 'utf8')) as Manifest;
    expect(m.version).toBe('1.0.6'); // 号必须更大，否则客户端判 up-to-date、无声失败
    expect(Object.keys(m.assets)).toEqual(['assets/shop/index.aaaaa.js']); // 内容是 1.0.3 那版
    // version.manifest 同步，否则 check 拿到的头与 manifest 对不上
    expect(JSON.parse(readFileSync(join(cdn, 'shop.version.manifest'), 'utf8')).version).toBe('1.0.6');
    expect(readdirSync(join(cdn, 'releases'))).toContain('1.0.6');
  });

  it('⚠️ 内容与当前在发的一致的包**不许**涨版本号 —— 涨了客户端会在 worker 线程 SIGSEGV', () => {
    // 归档 1.1.0 与 1.1.1 内容完全相同（模拟「这次发布只改了别的包」）
    publish('1.1.0', 'assets/shop/index.same0.js');
    publish('1.1.1', 'assets/shop/index.same0.js');

    const r = rollbackManifests({ cdnDir: cdn, release: '1.1.0', version: '1.1.2' });

    expect(r.changed).toEqual([]);
    expect(r.skipped.sort()).toEqual(['project.manifest', 'shop.manifest']);
    // 根上那份原样不动：版本号还是 1.1.1，客户端判 up-to-date、什么也不做
    const m = JSON.parse(readFileSync(join(cdn, 'shop.manifest'), 'utf8')) as Manifest;
    expect(m.version).toBe('1.1.1');
    expect(JSON.parse(readFileSync(join(cdn, 'shop.version.manifest'), 'utf8')).version).toBe('1.1.1');
  });

  it('没归档过的版本 → 直接抛，别让人以为回滚成功了', () => {
    expect(() => rollbackManifests({ cdnDir: cdn, release: '9.9.9', version: '2.0.0' })).toThrow();
  });
});
