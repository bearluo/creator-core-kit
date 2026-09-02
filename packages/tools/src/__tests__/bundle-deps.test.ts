import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bundleOf,
  collectBundleDeps,
  findDepViolations,
  findEdgeViolations,
  findUnpinnedRefs,
  MAIN_BUNDLE,
  readBundles,
  scanAssetRefs,
  scanCodeEdges,
  toMermaid,
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
  bundle('skin-default-mail', { deps: ['resources'], redirect: ['aaa@f9941', 0] }, '8cf1a');
  bundle('skin-vest-lobby', { deps: ['skin-default-foundation'], redirect: ['ccc@f9941', 0] }); // 跨马甲
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
      'skin-default-mail',
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
      { bundle: 'skin-vest-lobby', dep: 'skin-default-foundation', uuids: ['ccc@f9941'] },
    ]);
  });

  it('全指向共享仓 → 空表', () => {
    expect(
      findDepViolations([{ name: 'skin-default-mail', borrows: { resources: ['aaa@f9941'] } }]),
    ).toEqual([]);
  });

  it('shared 可自定义（接入方的仓不叫 resources）', () => {
    expect(findDepViolations(list(), ['resources', 'main', 'skin-default-foundation'])).toEqual([]);
  });

  it('shared 传空数组 → 任何跨包依赖都算违规', () => {
    expect(findDepViolations(list(), []).map((v) => v.bundle)).toEqual([
      'main',
      'shop',
      'skin-default-mail',
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
    asset('skins/default/mail/Mail.prefab', 'bbbbbbbb-0000-0000-0000-000000000002', ['INTERNAL-BTN@f9941']);
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
      'skins/default/mail/Mail.prefab',
      'skins/vest/mail/Mail.prefab',
    ]);
  });

  it('没钉时：两个外部 uuid 都报，files 去重排序，自家资源不报', () => {
    const un = findUnpinnedRefs(scanAssetRefs(src));
    expect(un).toEqual([
      {
        uuid: 'INTERNAL-BTN@f9941',
        files: ['boot/LaunchOverlay.prefab', 'skins/default/mail/Mail.prefab', 'skins/vest/mail/Mail.prefab'],
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

describe('拓扑单调（代码边）', () => {
  let src: string;

  /** 造一个 bundle 目录 + 它的 meta。`name` 省略则用目录名。 */
  const bundleDir = (rel: string, priority: number, name?: string): void => {
    mkdirSync(join(src, rel), { recursive: true });
    writeFileSync(
      join(src, `${rel}.meta`),
      JSON.stringify({ userData: { isBundle: true, priority, ...(name ? { bundleName: name } : {}) } }),
    );
  };

  const ts = (rel: string, body: string): void => {
    mkdirSync(dirname(join(src, rel)), { recursive: true });
    writeFileSync(join(src, rel), body);
  };

  beforeAll(() => {
    src = mkdtempSync(join(tmpdir(), 'cck-graph-'));
    bundleDir('resources', 8);
    bundleDir('foundation', 6);
    bundleDir('modules/lobby', 3);
    bundleDir('modules/shop', 1);
    bundleDir('skins/default/foundation', 2, 'skin-default-foundation');
    bundleDir('skins/default/mail', 1, 'skin-default-mail');
    mkdirSync(join(src, 'skins/default'), { recursive: true }); // skins/ 与 skins/default/ 不是 bundle
    // 合法：模块(3/1) → 地基(6)
    ts(
      'modules/lobby/LobbyHost.ts',
      "import { cc } from 'cc';\nimport { MODULE_CATALOG } from '../../foundation/catalog';\nimport {\n  LOBBY_EVENTS,\n} from '../../foundation/events';\nimport './LobbyVM';\n",
    );
    // 合法：类型引用被擦除，不算运行时依赖
    ts('boot/foundation-api.ts', "import type { DemoFoundation } from '../foundation/Foundation';\n");
    ts('foundation/catalog.ts', "import { x } from './events';\n");
  });

  afterAll(() => rmSync(src, { recursive: true, force: true }));

  describe('readBundles', () => {
    it('永远含主包，按优先级从高到低排', () => {
      expect(readBundles(src).map((b) => `${b.name}:${b.priority}`)).toEqual([
        'resources:8',
        'main:7',
        'foundation:6',
        'lobby:3',
        'skin-default-foundation:2',
        'shop:1',
        'skin-default-mail:1',
      ]);
    });

    it('bundleName 覆盖目录名（皮包目录叫 mail、包名叫 skin-default-mail）', () => {
      expect(readBundles(src).find((b) => b.dir === 'skins/default/mail')?.name).toBe('skin-default-mail');
    });

    it('assets 目录不存在 → 只剩主包，不抛', () => {
      expect(readBundles(join(src, 'nope'))).toEqual([MAIN_BUNDLE]);
    });
  });

  describe('bundleOf', () => {
    const bundles = (): ReturnType<typeof readBundles> => readBundles(src);

    it('最长目录前缀说了算', () => {
      expect(bundleOf('skins/default/mail/Mail.prefab', bundles()).name).toBe('skin-default-mail');
    });

    it('没被任何 bundle 圈住的归主包', () => {
      expect(bundleOf('boot/Bootstrap.ts', bundles())).toEqual(MAIN_BUNDLE);
    });

    it('同名前缀不误伤（`foundation-x` 不算 `foundation` 里的）', () => {
      expect(bundleOf('foundation-x/a.ts', bundles())).toEqual(MAIN_BUNDLE);
    });
  });

  describe('scanCodeEdges', () => {
    it('只收跨包的相对 import；`cc` / 同包 / 类型 import 都不算边', () => {
      expect(scanCodeEdges(src)).toEqual([
        { from: 'lobby', to: 'foundation', file: 'modules/lobby/LobbyHost.ts', target: 'foundation/catalog' },
        { from: 'lobby', to: 'foundation', file: 'modules/lobby/LobbyHost.ts', target: 'foundation/events' },
      ]);
    });

    it('多行 import 也认（`[^;]*?` 跨行）', () => {
      expect(scanCodeEdges(src).some((e) => e.target === 'foundation/events')).toBe(true);
    });

    it('`import type` 不产生边 —— 主包拿地基的唯一合法缝', () => {
      expect(scanCodeEdges(src).some((e) => e.from === 'main')).toBe(false);
    });
  });

  describe('findEdgeViolations', () => {
    const bundles = [
      { name: 'resources', dir: 'resources', priority: 8 },
      MAIN_BUNDLE,
      { name: 'foundation', dir: 'foundation', priority: 6 },
      { name: 'lobby', dir: 'modules/lobby', priority: 3 },
      { name: 'shop', dir: 'modules/shop', priority: 1 },
      { name: 'mail', dir: 'modules/mail', priority: 1 },
    ];
    const edge = (from: string, to: string): { from: string; to: string; file: string; target: string } => ({
      from,
      to,
      file: `${from}/x.ts`,
      target: `${to}/y`,
    });

    it('指向更高优先级 = 合法（模块 → 地基）', () => {
      expect(findEdgeViolations([edge('shop', 'foundation')], bundles)).toEqual([]);
    });

    it('倒挂违规：主包 import 地基的值 → 地基被判进 AOT，热更当场失效', () => {
      expect(findEdgeViolations([edge('main', 'foundation')], bundles)).toEqual([
        { ...edge('main', 'foundation'), fromPriority: 7, toPriority: 6 },
      ]);
    });

    it('同级互引违规 —— 严格递增才保证无环', () => {
      expect(findEdgeViolations([edge('shop', 'mail'), edge('mail', 'shop')], bundles)).toHaveLength(2);
    });

    it('认不出的包按主包算，不默默放行', () => {
      expect(findEdgeViolations([edge('ghost', 'lobby')], bundles)).toHaveLength(1);
    });
  });

  it('toMermaid 画出节点与去重后的边', () => {
    const g = toMermaid(readBundles(src), scanCodeEdges(src));
    expect(g.startsWith('graph BT')).toBe(true);
    expect(g).toContain('foundation["foundation · 6"]');
    expect(g).toContain('skin_default_mail["skin-default-mail · 1"]');
    expect(g.match(/lobby --> foundation/g)).toHaveLength(1); // 两条 import 合成一条边
  });
});
