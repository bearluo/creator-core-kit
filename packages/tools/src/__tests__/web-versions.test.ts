import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildWebVersions, readBundleVers } from '../web-versions';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** 造一份 web 构建产物的骨架：只有 `src/settings.<md5>.json` 是这套工具的输入。 */
function makeRoot(settings: unknown, name = 'settings.14d13.json'): string {
  const root = mkdtempSync(join(tmpdir(), 'cck-web-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  if (settings !== undefined) writeFileSync(join(root, 'src', name), JSON.stringify(settings));
  return root;
}

const FULL = {
  assets: {
    bundleVers: {
      main: '3cc4b',
      internal: '40b38',
      resources: 'dd229',
      lobby: 'ef2c3',
      shop: '50149',
      'skin-base-mail': '8cf1a',
    },
  },
};

describe('readBundleVers', () => {
  it('settings 文件名自己带 md5，照样找得到', () => {
    expect(readBundleVers(makeRoot(FULL))['lobby']).toBe('ef2c3');
  });

  it('bundleVers 为空 → 报错点名 md5Cache（关了 web 就没有版本可言）', () => {
    expect(() => readBundleVers(makeRoot({ assets: { bundleVers: {} } }))).toThrow(/md5Cache/);
  });

  it('没有 settings 文件 → 报错说清 root 该指哪', () => {
    expect(() => readBundleVers(makeRoot(undefined))).toThrow(/settings/);
  });

  it('多份 settings（上一次构建的残留）→ 报错而不是挑一个', () => {
    const root = makeRoot(FULL);
    writeFileSync(join(root, 'src', 'settings.99999.json'), '{}');
    expect(() => readBundleVers(root)).toThrow(/2 份/);
  });
});

describe('buildWebVersions', () => {
  it('剔掉 AOT 三件套 —— 它们的版本是页面自己的 settings.json 说了算', () => {
    const v = buildWebVersions(makeRoot(FULL), { version: '1.0.1' });
    expect(Object.keys(v.bundles).sort()).toEqual(['lobby', 'shop', 'skin-base-mail']);
    expect(v.version).toBe('1.0.1');
  });

  it('没给 core / minAppVersion 就不写那两个字段（闸对单边缺失恒放行，写个空串反而是假信息）', () => {
    const v = buildWebVersions(makeRoot(FULL), { version: '1.0.1' });
    expect('coreApiHash' in v).toBe(false);
    expect('minAppVersion' in v).toBe(false);
  });

  it('aotBundles 可覆盖', () => {
    const v = buildWebVersions(makeRoot(FULL), { version: '1', aotBundles: ['lobby'] });
    expect(v.bundles['lobby']).toBeUndefined();
    expect(v.bundles['main']).toBe('3cc4b');
  });
});
