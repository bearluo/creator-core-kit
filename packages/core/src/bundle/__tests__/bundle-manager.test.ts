import { afterEach, describe, expect, it } from 'vitest';
import {
  createBundleManager,
  getBundleManager,
  BUNDLE_MANAGER,
} from '../bundle-manager';
import { createBundleGraph, type BundleGraph } from '../bundle-graph';
import {
  createMemoryBundleSource,
  BUNDLE_SOURCE,
  type BundleLoadOptions,
  type IBundleSource,
} from '../bundle-source';
import { getRootContainer } from '../../di';
import { BUNDLE_UPDATER, type BundleUpdater } from '../../hotupdate';
import { LogLevel, type ILogger } from '../../logging';

function fakeLogger(): { logger: ILogger; warns: unknown[][] } {
  const warns: unknown[][] = [];
  const logger: ILogger = {
    level: LogLevel.Debug,
    setLevel: () => {},
    debug: () => {},
    info: () => {},
    warn: (...a: unknown[]) => void warns.push(a),
    error: () => {},
    child: () => logger,
  };
  return { logger, warns };
}

/** 可控 spy IBundleSource：记录 load/release 调用；auto=false 时加载挂起，由 flush/failAll 手动结算。 */
function makeSource() {
  const ready = new Set<string>();
  const loadCalls: string[] = [];
  const loadOptions: Array<(BundleLoadOptions & { url?: string }) | undefined> = [];
  const releaseCalls: string[] = [];
  const pending: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  let auto = true;
  const source: IBundleSource = {
    loadBundle(name: string, opts?: BundleLoadOptions & { url?: string }): Promise<void> {
      loadCalls.push(name);
      loadOptions.push(opts);
      if (auto) {
        ready.add(name);
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        pending.push({
          resolve: () => {
            ready.add(name);
            resolve();
          },
          reject,
        });
      });
    },
    releaseBundle(name: string): void {
      releaseCalls.push(name);
      ready.delete(name);
    },
    hasBundle(name: string): boolean {
      return ready.has(name);
    },
  };
  return {
    source,
    loadCalls,
    loadOptions,
    releaseCalls,
    setAuto: (v: boolean) => {
      auto = v;
    },
    flush: () => {
      pending.forEach((p) => p.resolve());
      pending.length = 0;
    },
    failAll: (e: unknown) => {
      pending.forEach((p) => p.reject(e));
      pending.length = 0;
    },
  };
}

describe('BundleManager', () => {
  afterEach(() => {
    const root = getRootContainer();
    root.unregister(BUNDLE_SOURCE);
    root.unregister(BUNDLE_MANAGER);
  });

  it('1. load 新 bundle → 真调 source 一次、就绪、返回句柄', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    const h = await bm.load('featureA');
    expect(h).toEqual({ name: 'featureA', version: undefined });
    expect(s.loadCalls).toEqual(['featureA']);
    expect(bm.isLoaded('featureA')).toBe(true);
  });

  it('2. 同名重复 load → source 只调一次、refCount=2', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    await bm.load('a');
    await bm.load('a');
    expect(s.loadCalls).toEqual(['a']);
    expect(bm.list()).toEqual([{ name: 'a', version: undefined, refCount: 2 }]);
  });

  it('3. 并发 load 同名 → 共享 inflight、source 只调一次、都 resolve', async () => {
    const s = makeSource();
    s.setAuto(false);
    const bm = createBundleManager({ source: s.source });
    const p1 = bm.load('a');
    const p2 = bm.load('a');
    expect(s.loadCalls).toEqual(['a']); // 只发起一次
    expect(bm.isLoaded('a')).toBe(false); // 加载中未就绪
    s.flush();
    const [h1, h2] = await Promise.all([p1, p2]);
    expect(h1).toEqual({ name: 'a', version: undefined });
    expect(h2).toEqual({ name: 'a', version: undefined });
    expect(bm.isLoaded('a')).toBe(true);
    expect(bm.list()[0].refCount).toBe(2);
  });

  it('4. 引用计数：release 到归零才真释放', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    await bm.load('a');
    await bm.load('a'); // refCount=2
    bm.release('a'); // →1，不释放
    expect(s.releaseCalls).toEqual([]);
    expect(bm.isLoaded('a')).toBe(true);
    bm.release('a'); // →0，真释放
    expect(s.releaseCalls).toEqual(['a']);
    expect(bm.isLoaded('a')).toBe(false);
    expect(bm.get('a')).toBeUndefined();
    expect(bm.list()).toEqual([]);
  });

  it('5. release 多于 load → 计数夹 0、不负、真释放一次', async () => {
    const s = makeSource();
    const { logger, warns } = fakeLogger();
    const bm = createBundleManager({ source: s.source, logger });
    await bm.load('a'); // refCount=1
    bm.release('a'); // →0 释放、删表
    bm.release('a'); // 已删 → 告警 no-op
    expect(s.releaseCalls).toEqual(['a']);
    expect(warns.length).toBe(1);
  });

  it('6. release 未加载名 → 告警 no-op', () => {
    const s = makeSource();
    const { logger, warns } = fakeLogger();
    const bm = createBundleManager({ source: s.source, logger });
    bm.release('nope');
    expect(warns.length).toBe(1);
    expect(s.releaseCalls).toEqual([]);
  });

  it('7. load 失败 → reject、不留条目/计数、可重试', async () => {
    const s = makeSource();
    s.setAuto(false);
    const bm = createBundleManager({ source: s.source });
    const p = bm.load('a');
    s.failAll(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(bm.isLoaded('a')).toBe(false);
    expect(bm.get('a')).toBeUndefined();
    expect(bm.list()).toEqual([]);
    // 重试
    s.setAuto(true);
    const h = await bm.load('a');
    expect(h.name).toBe('a');
    expect(s.loadCalls).toEqual(['a', 'a']);
  });

  it('7b. 并发 load 失败 → 两者都 reject、表清空、可重试', async () => {
    const s = makeSource();
    s.setAuto(false);
    const bm = createBundleManager({ source: s.source });
    const p1 = bm.load('a');
    const p2 = bm.load('a');
    s.failAll(new Error('x'));
    await expect(p1).rejects.toThrow('x');
    await expect(p2).rejects.toThrow('x');
    expect(bm.list()).toEqual([]);
    expect(s.loadCalls).toEqual(['a']);
  });

  it('8. 远程 url + opts.name + version → 以 name 注册、句柄带 version', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    const h = await bm.load('https://cdn/x/featureB', { name: 'featureB', version: 'v3' });
    expect(h).toEqual({ name: 'featureB', version: 'v3' });
    expect(s.loadCalls).toEqual(['featureB']); // 按 name 注册，非 url
    expect(bm.isLoaded('featureB')).toBe(true);
  });

  it('9. list 升序 + refCount 快照', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    await bm.load('c');
    await bm.load('a');
    await bm.load('a');
    await bm.load('b', { name: undefined, version: 'v1' });
    expect(bm.list()).toEqual([
      { name: 'a', version: undefined, refCount: 2 },
      { name: 'b', version: 'v1', refCount: 1 },
      { name: 'c', version: undefined, refCount: 1 },
    ]);
  });

  it('10. get / isLoaded 在加载中为 undefined/false，就绪后有值/true', async () => {
    const s = makeSource();
    s.setAuto(false);
    const bm = createBundleManager({ source: s.source });
    const p = bm.load('a');
    expect(bm.get('a')).toBeUndefined();
    expect(bm.isLoaded('a')).toBe(false);
    s.flush();
    await p;
    expect(bm.get('a')).toEqual({ name: 'a', version: undefined });
    expect(bm.isLoaded('a')).toBe(true);
  });

  it('11. 默认 source 解析：DI BUNDLE_SOURCE 优先', async () => {
    const s = makeSource();
    getRootContainer().register(BUNDLE_SOURCE, { useValue: s.source });
    const bm = createBundleManager(); // 不传 source
    await bm.load('a');
    expect(s.loadCalls).toEqual(['a']);
  });

  it('12. 未注册 source → 退内存 fake（不抛）', async () => {
    const bm = createBundleManager(); // 无 DI、无 opts
    const h = await bm.load('a');
    expect(h.name).toBe('a');
    expect(bm.isLoaded('a')).toBe(true);
  });

  it('13. getBundleManager：token 优先 / 回退非空', () => {
    const s = makeSource();
    const custom = createBundleManager({ source: s.source });
    getRootContainer().register(BUNDLE_MANAGER, { useValue: custom });
    expect(getBundleManager()).toBe(custom);
    getRootContainer().unregister(BUNDLE_MANAGER);
    expect(getBundleManager()).toBeTruthy(); // 回退进程默认
  });

  it('14. setVersions 后 load 自动带上表里的 version', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setVersions({ shop: 'abc123', lobby: 'def456' });
    const h = await bm.load('shop');
    expect(h.version).toBe('abc123');
    expect(s.loadOptions[0]?.version).toBe('abc123');
  });

  it('15. opts.version 显式传入时优先于版本表', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setVersions({ shop: 'abc123' });
    const h = await bm.load('shop', { version: 'override' });
    expect(h.version).toBe('override');
    expect(s.loadOptions[0]?.version).toBe('override');
  });

  it('16. setVersions 覆盖式替换：不在新表里的名字无版本', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setVersions({ shop: 'v1' });
    bm.setVersions({ lobby: 'v2' }); // 整体替换，shop 的条目没了
    const h = await bm.load('shop');
    expect(h.version).toBeUndefined();
    expect(s.loadOptions[0]?.version).toBeUndefined();
  });
});

describe('BundleManager × BundleUpdater（加载前分包热更）', () => {
  afterEach(() => {
    const root = getRootContainer();
    root.unregister(BUNDLE_SOURCE);
    root.unregister(BUNDLE_UPDATER);
  });

  /** 记录调用时序：更新与加载各往同一条轨迹里写。 */
  function makeTraced(updaterImpl?: (bundle: string) => Promise<void>) {
    const trace: string[] = [];
    const s = makeSource();
    const source: IBundleSource = {
      ...s.source,
      loadBundle: (name, opts) => {
        trace.push(`load:${name}`);
        return s.source.loadBundle(name, opts);
      },
    };
    const updater: BundleUpdater = {
      ensureLatest: async (bundle) => {
        trace.push(`update:${bundle}`);
        await updaterImpl?.(bundle);
      },
    };
    return { trace, source, updater };
  }

  it('ensureLatest 在 source.loadBundle 之前跑', async () => {
    const t = makeTraced();
    const bm = createBundleManager({ source: t.source, updater: t.updater });
    await bm.load('shop');
    expect(t.trace).toEqual(['update:shop', 'load:shop']);
  });

  it('已加载的 bundle 再 load 不重复更新', async () => {
    const t = makeTraced();
    const bm = createBundleManager({ source: t.source, updater: t.updater });
    await bm.load('shop');
    await bm.load('shop');
    expect(t.trace).toEqual(['update:shop', 'load:shop']); // 第二次只加计数
  });

  it('updater 更新失败 → load 一起失败，绝不静默用包内版本', async () => {
    const t = makeTraced(() => Promise.reject(new Error('更新炸了')));
    const bm = createBundleManager({ source: t.source, updater: t.updater });
    await expect(bm.load('shop')).rejects.toThrow('更新炸了');
    expect(t.trace).toEqual(['update:shop']); // 没走到 loadBundle
    expect(bm.isLoaded('shop')).toBe(false); // 失败条目已回滚，重试能重来
  });

  it('远程 url 加载跳过 manifest 热更', async () => {
    const t = makeTraced();
    const bm = createBundleManager({ source: t.source, updater: t.updater });
    await bm.load('http://cdn/shop', { name: 'shop' });
    expect(t.trace).toEqual(['load:shop']);
  });

  it('BUNDLE_UPDATER 晚于 BundleManager 注册也生效（app 戳是启动后才读到的）', async () => {
    const t = makeTraced();
    getRootContainer().register(BUNDLE_SOURCE, { useValue: t.source });
    const bm = createBundleManager(); // 此刻 BUNDLE_UPDATER 尚未注册
    getRootContainer().register(BUNDLE_UPDATER, { useValue: t.updater });
    await bm.load('shop');
    expect(t.trace).toEqual(['update:shop', 'load:shop']);
  });

  it('updater 默认从 DI 的 BUNDLE_UPDATER 拾取；未注册则不更新', async () => {
    const t = makeTraced();
    getRootContainer().register(BUNDLE_SOURCE, { useValue: t.source });
    await createBundleManager().load('a');
    expect(t.trace).toEqual(['load:a']);

    getRootContainer().register(BUNDLE_UPDATER, { useValue: t.updater });
    await createBundleManager().load('b');
    expect(t.trace).toEqual(['load:a', 'update:b', 'load:b']);
  });
});

describe('BundleManager 版本来源优先级（显式 > updater 反推 > 版本表）', () => {
  /** 记下真正传给 source.loadBundle 的 version —— 这才是引擎拼 `index.<v>.js` 用的那个。 */
  function makeEnv(versionOf?: string) {
    const seen: (string | undefined)[] = [];
    const source: IBundleSource = {
      ...createMemoryBundleSource(),
      loadBundle: (name, opts?: BundleLoadOptions) => {
        seen.push(opts?.version);
        return Promise.resolve();
      },
    };
    const updater: BundleUpdater = {
      ensureLatest: () => Promise.resolve(),
      versionOf: () => versionOf,
    };
    return { seen, source, updater };
  }

  it('native：updater 反推的版本压过版本表 —— 更新刚落盘的那份才是对的', async () => {
    const e = makeEnv('a1b2c');
    const bm = createBundleManager({ source: e.source, updater: e.updater });
    bm.setVersions({ shop: '旧表里的值' });
    await bm.load('shop');
    expect(e.seen).toEqual(['a1b2c']);
    expect(bm.get('shop')?.version).toBe('a1b2c');
  });

  it('调用方显式指定最高（逃生口）', async () => {
    const e = makeEnv('a1b2c');
    const bm = createBundleManager({ source: e.source, updater: e.updater });
    await bm.load('shop', { version: '手动指定' });
    expect(e.seen).toEqual(['手动指定']);
  });

  it('web：updater 答不上来 → 回落版本表', async () => {
    const e = makeEnv(undefined);
    const bm = createBundleManager({ source: e.source, updater: e.updater });
    bm.setVersions({ shop: 'webmd5' });
    await bm.load('shop');
    expect(e.seen).toEqual(['webmd5']);
  });

  it('都没有 → undefined（引擎按不带版本的名字取，即没开 md5Cache 的形态）', async () => {
    const e = makeEnv(undefined);
    await createBundleManager({ source: e.source, updater: e.updater }).load('shop');
    expect(e.seen).toEqual([undefined]);
  });

  it('远程 url 加载不问 updater —— 那条路没有 manifest', async () => {
    const e = makeEnv('a1b2c');
    const bm = createBundleManager({ source: e.source, updater: e.updater });
    bm.setVersions({ shop: 'webmd5' });
    await bm.load('http://cdn/shop', { name: 'shop' });
    expect(e.seen).toEqual(['webmd5']);
  });
});

describe('createMemoryBundleSource', () => {
  it('loadBundle→hasBundle true；releaseBundle→false', async () => {
    const src = createMemoryBundleSource();
    expect(src.hasBundle('a')).toBe(false);
    await src.loadBundle('a');
    expect(src.hasBundle('a')).toBe(true);
    src.releaseBundle('a');
    expect(src.hasBundle('a')).toBe(false);
  });

  it('preset.present 里的名字一开始即就绪', () => {
    const src = createMemoryBundleSource({ present: ['builtin'] });
    expect(src.hasBundle('builtin')).toBe(true);
    expect(src.hasBundle('other')).toBe(false);
  });
});

describe('BundleManager × 依赖表', () => {
  afterEach(() => {
    const root = getRootContainer();
    root.unregister(BUNDLE_SOURCE);
    root.unregister(BUNDLE_MANAGER);
  });

  /** foundation ← mail、foundation ← lobby，mail 另带一个皮包。 */
  const graph = (): BundleGraph =>
    createBundleGraph([
      { name: 'foundation' },
      { name: 'skin-mail' },
      { name: 'mail', needs: ['foundation', () => 'skin-mail'] },
      { name: 'lobby', needs: ['foundation'] },
    ]);

  const refOf = (bm: ReturnType<typeof createBundleManager>, name: string): number | undefined =>
    bm.list().find((b) => b.name === name)?.refCount;

  it('load 先按拓扑序装依赖，自己最后 —— 依赖不用调用点复述', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setGraph(graph());
    await bm.load('mail');
    expect(s.loadCalls).toEqual(['foundation', 'skin-mail', 'mail']);
  });

  it('装卸对称：一次 load 给每个依赖加一次引用，一次 release 各减一次', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setGraph(graph());
    await bm.load('mail');
    expect(refOf(bm, 'foundation')).toBe(1);
    bm.release('mail');
    expect(s.releaseCalls.sort()).toEqual(['foundation', 'mail', 'skin-mail']);
    expect(bm.list()).toEqual([]);
  });

  it('load 两次 → 依赖也是 2；release 两次才真卸（引用计数是唯一的生命周期）', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setGraph(graph());
    await bm.load('mail');
    await bm.load('mail');
    expect(refOf(bm, 'foundation')).toBe(2);
    bm.release('mail');
    expect(bm.isLoaded('foundation')).toBe(true);
    bm.release('mail');
    expect(bm.isLoaded('foundation')).toBe(false);
  });

  it('共享依赖不被误卸：关了 mail，lobby 还在用 foundation', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setGraph(graph());
    await bm.load('lobby');
    await bm.load('mail');
    expect(refOf(bm, 'foundation')).toBe(2);
    bm.release('mail');
    expect(s.releaseCalls).not.toContain('foundation');
    expect(bm.isLoaded('foundation')).toBe(true);
  });

  it('依赖装失败 → 自己不装，已装的依赖原样松开（不留半截状态）', async () => {
    const failing: IBundleSource = {
      loadBundle: (name: string) =>
        name === 'skin-mail' ? Promise.reject(new Error('皮包 404')) : Promise.resolve(),
      releaseBundle: () => {},
      hasBundle: () => true,
    };
    const bm = createBundleManager({ source: failing });
    bm.setGraph(graph());
    await expect(bm.load('mail')).rejects.toThrow('皮包 404');
    expect(bm.list()).toEqual([]);
  });

  it('自己装失败 → 依赖也一并松开', async () => {
    const failing: IBundleSource = {
      loadBundle: (name: string) =>
        name === 'mail' ? Promise.reject(new Error('模块 404')) : Promise.resolve(),
      releaseBundle: () => {},
      hasBundle: () => true,
    };
    const bm = createBundleManager({ source: failing });
    bm.setGraph(graph());
    await expect(bm.load('mail')).rejects.toThrow('模块 404');
    expect(bm.list()).toEqual([]);
  });

  it('表外的包：strict（默认）直接抛 —— 开发期漏登记当场炸', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setGraph(graph());
    await expect(bm.load('ghost')).rejects.toThrow(/没登记在依赖表里/);
    expect(s.loadCalls).toEqual([]);
  });

  it('表外的包：strict=false 降级成告警并照常装 —— 上线不为一条漏声明白屏', async () => {
    const s = makeSource();
    const { logger, warns } = fakeLogger();
    const bm = createBundleManager({ source: s.source, logger });
    bm.setGraph(graph(), { strict: false });
    await bm.load('ghost');
    expect(s.loadCalls).toEqual(['ghost']);
    expect(warns).toHaveLength(1);
  });

  it('远程 url 加载不受表管（表描述的是本工程的包）', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setGraph(graph());
    await bm.load('https://cdn/x', { name: 'remote' });
    expect(s.loadCalls).toEqual(['remote']);
  });

  it('没设表 → 行为一个字不变（接入方不用表也能跑）', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    await bm.load('mail');
    expect(s.loadCalls).toEqual(['mail']);
    bm.release('mail');
    expect(s.releaseCalls).toEqual(['mail']);
  });

  it('release 表外的包 → 只松开自己，不去查依赖', async () => {
    const s = makeSource();
    const bm = createBundleManager({ source: s.source });
    bm.setGraph(graph(), { strict: false });
    await bm.load('ghost');
    bm.release('ghost');
    expect(s.releaseCalls).toEqual(['ghost']);
  });
});
