import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectBundleDeps,
  findDepViolations,
  findUnpinnedRefs,
  scanAssetRefs,
  type BundleDeps,
} from '../bundle-deps';

let root: string;

/** 造一个 bundle 的 cc.config（md5 后缀可选，模拟 `md5Cache` 开关）。 */
const bundle = (name: string, cfg: Record<string, unknown>, md5?: string): void => {
  const d = join(root, 'assets', name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `cc.config${md5 ? `.${md5}` : ''}.json`), JSON.stringify({ name, ...cfg }));
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cck-deps-'));
  bundle('resources', { deps: [], redirect: [] }, '7721b');
  bundle('main', { deps: ['resources'], redirect: ['aaa@f9941', 0, 'bbb@f9941', 0] }, '5a776');
  bundle('skin-base-mail', { deps: ['resources'], redirect: ['aaa@f9941', 0] }, '8cf1a');
  bundle('skin-vest-lobby', { deps: ['skin-base-foundation'], redirect: ['ccc@f9941', 0] }); // 跨马甲
  bundle('shop', { deps: ['main'], redirect: ['ddd@f9941', 0] }); // 借 AOT
  bundle('lobby', { deps: [], redirect: [] });
  mkdirSync(join(root, 'assets', 'not-a-bundle'), { recursive: true }); // 没有 cc.config
  writeFileSync(join(root, 'assets', 'stray.txt'), 'x'); // 不是目录
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('collectBundleDeps', () => {
  it('只收有 deps 的 bundle，按名字排序', () => {
    expect(collectBundleDeps(root).map((b) => b.name)).toEqual([
      'main',
      'shop',
      'skin-base-mail',
      'skin-vest-lobby',
    ]);
  });

  it('redirect 的 depIndex 解回包名，同一个包的 uuid 归一条', () => {
    const main = collectBundleDeps(root).find((b) => b.name === 'main');
    expect(main?.borrows).toEqual({ resources: ['aaa@f9941', 'bbb@f9941'] });
  });

  it('cc.config 带不带 md5 后缀都认', () => {
    expect(collectBundleDeps(root).find((b) => b.name === 'skin-vest-lobby')).toBeDefined();
  });

  it('没有 assets/ 的目录返回空表，不抛', () => {
    expect(collectBundleDeps(join(root, 'nope'))).toEqual([]);
  });

  it('非目录 / 无 cc.config / deps 为空的一律跳过', () => {
    const names = collectBundleDeps(root).map((b) => b.name);
    expect(names).not.toContain('not-a-bundle');
    expect(names).not.toContain('stray.txt');
    expect(names).not.toContain('resources'); // deps 为空
    expect(names).not.toContain('lobby');
  });

  it('cc.config 是坏 JSON → 跳过而不是炸（发布前守卫不该被脏文件掀翻）', () => {
    const d = join(root, 'assets', 'broken');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'cc.config.json'), '{ 不是 JSON');
    expect(collectBundleDeps(root).map((b) => b.name)).not.toContain('broken');
    rmSync(d, { recursive: true, force: true });
  });

  it('deps 里有、redirect 没提到的（纯脚本依赖）也算借，uuid 列表为空', () => {
    const d = join(root, 'assets', 'script-only');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'cc.config.json'), JSON.stringify({ deps: ['foundation'], redirect: [] }));
    expect(collectBundleDeps(root).find((b) => b.name === 'script-only')?.borrows).toEqual({
      foundation: [],
    });
    rmSync(d, { recursive: true, force: true });
  });

  it('redirect 的 depIndex 越界 → 丢掉那一条，不造出 undefined 包名', () => {
    const d = join(root, 'assets', 'dirty');
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, 'cc.config.json'),
      JSON.stringify({ deps: ['resources'], redirect: ['x@f9941', 9] }),
    );
    expect(collectBundleDeps(root).find((b) => b.name === 'dirty')?.borrows).toEqual({
      resources: [],
    });
    rmSync(d, { recursive: true, force: true });
  });
});

describe('findDepViolations', () => {
  const list = (): BundleDeps[] => collectBundleDeps(root);

  it('默认只放行 resources：借 main 与跨马甲都算违规', () => {
    expect(findDepViolations(list())).toEqual([
      { bundle: 'shop', dep: 'main', uuids: ['ddd@f9941'] },
      { bundle: 'skin-vest-lobby', dep: 'skin-base-foundation', uuids: ['ccc@f9941'] },
    ]);
  });

  it('全指向共享仓 → 空表', () => {
    expect(
      findDepViolations([{ name: 'skin-base-mail', borrows: { resources: ['aaa@f9941'] } }]),
    ).toEqual([]);
  });

  it('shared 可自定义（接入方的仓不叫 resources）', () => {
    expect(findDepViolations(list(), ['resources', 'main', 'skin-base-foundation'])).toEqual([]);
  });

  it('shared 传空数组 → 任何跨包依赖都算违规', () => {
    expect(findDepViolations(list(), []).map((v) => v.bundle)).toEqual([
      'main',
      'shop',
      'skin-base-mail',
      'skin-vest-lobby',
    ]);
  });
});

describe('scanAssetRefs / findUnpinnedRefs（源码期）', () => {
  let src: string;

  /** 写一个资产 + 它的 .meta。`uuids` 为空则只登记归属、不产生引用。 */
  const asset = (rel: string, uuid: string, uuids: string[] = [], subs: string[] = []): void => {
    const f = join(src, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(uuids.map((u) => ({ __uuid__: u }))));
    writeFileSync(
      `${f}.meta`,
      JSON.stringify({
        uuid,
        subMetas: Object.fromEntries(subs.map((s) => [s, { uuid: `${uuid}@${s}` }])),
      }),
    );
  };

  beforeAll(() => {
    src = mkdtempSync(join(tmpdir(), 'cck-pins-'));
    // 工程自有：一张图（带 spriteFrame 子资源）
    asset('shared/logo.png', 'aaaaaaaa-0000-0000-0000-000000000001', [], ['6c48a', 'f9941']);
    // 引用：内置图 BTN 被 3 处引用，内置图 SPLASH 只被 boot 引用，还引了自家 logo 的 spriteFrame
    asset('boot/LaunchOverlay.prefab', 'bbbbbbbb-0000-0000-0000-000000000001', [
      'INTERNAL-BTN@f9941',
      'INTERNAL-SPLASH@f9941',
      'aaaaaaaa-0000-0000-0000-000000000001@f9941',
    ]);
    asset('skins/base/mail/Mail.prefab', 'bbbbbbbb-0000-0000-0000-000000000002', ['INTERNAL-BTN@f9941']);
    asset('skins/vest/mail/Mail.prefab', 'bbbbbbbb-0000-0000-0000-000000000003', ['INTERNAL-BTN@f9941']);
    // 不带引用的格式（.ts / .json）即使写了 __uuid__ 也不扫
    mkdirSync(join(src, 'foundation'), { recursive: true });
    writeFileSync(join(src, 'foundation/net.ts'), '// "__uuid__": "NOT-SCANNED"');
  });

  afterAll(() => rmSync(src, { recursive: true, force: true }));

  it('owned 收 .meta 的 uuid 与 subMetas 的 uuid（被引用的是子资源那个）', () => {
    const { owned } = scanAssetRefs(src);
    expect(owned).toContain('aaaaaaaa-0000-0000-0000-000000000001');
    expect(owned).toContain('aaaaaaaa-0000-0000-0000-000000000001@f9941');
    expect(owned).toContain('aaaaaaaa-0000-0000-0000-000000000001@6c48a');
  });

  it('只扫 prefab/scene/material 这类资产，`.ts` 里的同名串不算引用', () => {
    const files = scanAssetRefs(src).refs.map((r) => r.file);
    expect(files).toEqual([
      'boot/LaunchOverlay.prefab',
      'skins/base/mail/Mail.prefab',
      'skins/vest/mail/Mail.prefab',
    ]);
  });

  it('没钉时：两个外部 uuid 都报，files 去重排序，自家资源不报', () => {
    const un = findUnpinnedRefs(scanAssetRefs(src));
    expect(un).toEqual([
      {
        uuid: 'INTERNAL-BTN@f9941',
        files: ['boot/LaunchOverlay.prefab', 'skins/base/mail/Mail.prefab', 'skins/vest/mail/Mail.prefab'],
      },
      { uuid: 'INTERNAL-SPLASH@f9941', files: ['boot/LaunchOverlay.prefab'] },
    ]);
  });

  it('**只被一个包引用**的外部资源照样报 —— 产物侧那道闸恰好漏的就是这一类', () => {
    const un = findUnpinnedRefs(scanAssetRefs(src));
    expect(un.map((u) => u.uuid)).toContain('INTERNAL-SPLASH@f9941');
  });

  it('钉子 prefab 进 resources/ 后 → 清零', () => {
    asset('resources/internal-pin.prefab', 'cccccccc-0000-0000-0000-000000000001', [
      'INTERNAL-BTN@f9941',
      'INTERNAL-SPLASH@f9941',
    ]);
    expect(findUnpinnedRefs(scanAssetRefs(src))).toEqual([]);
    rmSync(join(src, 'resources'), { recursive: true, force: true });
  });

  it('钉子只钉了一半 → 只报剩下那个', () => {
    asset('resources/internal-pin.prefab', 'cccccccc-0000-0000-0000-000000000002', ['INTERNAL-BTN@f9941']);
    expect(findUnpinnedRefs(scanAssetRefs(src)).map((u) => u.uuid)).toEqual(['INTERNAL-SPLASH@f9941']);
    rmSync(join(src, 'resources'), { recursive: true, force: true });
  });

  it('pinPrefix 可自定义（接入方的仓不叫 resources）', () => {
    const scan = scanAssetRefs(src);
    const withPin = {
      ...scan,
      refs: [...scan.refs, { file: 'my-vault/pin.prefab', uuids: ['INTERNAL-BTN@f9941', 'INTERNAL-SPLASH@f9941'] }],
    };
    expect(findUnpinnedRefs(withPin, 'my-vault/')).toEqual([]);
    expect(findUnpinnedRefs(withPin).length).toBe(2); // 默认前缀下那个 vault 不算仓
  });

  it('assets 目录不存在 → 空结果，不抛', () => {
    expect(scanAssetRefs(join(src, 'nope'))).toEqual({ owned: [], refs: [] });
    expect(findUnpinnedRefs({ owned: [], refs: [] })).toEqual([]);
  });

  it('.meta 是坏 JSON → 跳过而不是炸', () => {
    const f = join(src, 'boot/Broken.prefab');
    writeFileSync(f, JSON.stringify([{ __uuid__: 'INTERNAL-X@f9941' }]));
    writeFileSync(`${f}.meta`, '{ 不是 JSON');
    expect(findUnpinnedRefs(scanAssetRefs(src)).map((u) => u.uuid)).toContain('INTERNAL-X@f9941');
    rmSync(f);
    rmSync(`${f}.meta`);
  });
});
