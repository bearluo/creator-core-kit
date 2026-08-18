import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildManifest,
  buildSplitManifests,
  toVersionManifest,
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

  it('默认 AOT 名单（main/internal/resources）归 base，其余各自成包', () => {
    const { base, bundles } = buildSplitManifests(sopts());
    expect(Object.keys(bundles).sort()).toEqual(['lobby', 'shop']);
    expect(base.assets['assets/main/index.js']).toBeDefined();
    expect(base.assets['assets/internal/index.js']).toBeDefined();
    expect(base.assets['src/cocos-js/cc.js']).toBeDefined();
    expect(base.assets['jsb-adapter/engine-adapter.js']).toBeDefined();
    expect(base.assets['assets/loose.txt']).toBeDefined(); // assets 下的散文件
  });

  it('AOT 名单可配：把 lobby 也划进 base 后它不再单独成包', () => {
    const { base, bundles } = buildSplitManifests({ ...sopts(), aotBundles: ['main', 'internal', 'lobby'] });
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

    it('改 AOT 里的文件 → base 涨版本，模块包不受影响', () => {
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
