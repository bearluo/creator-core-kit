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
