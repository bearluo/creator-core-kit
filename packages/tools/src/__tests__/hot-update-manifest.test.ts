import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildManifest,
  toVersionManifest,
  verifyManifest,
  writeManifests,
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
