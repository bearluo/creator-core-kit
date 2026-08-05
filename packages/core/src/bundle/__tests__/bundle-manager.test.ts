import { afterEach, describe, expect, it } from 'vitest';
import {
  createBundleManager,
  getBundleManager,
  BUNDLE_MANAGER,
} from '../bundle-manager';
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

  it('updater 违约抛异常 → 记日志、照常加载，不带崩', async () => {
    const t = makeTraced(() => Promise.reject(new Error('更新炸了')));
    const { logger, warns } = fakeLogger();
    const bm = createBundleManager({ source: t.source, updater: t.updater, logger });
    await expect(bm.load('shop')).resolves.toMatchObject({ name: 'shop' });
    expect(t.trace).toEqual(['update:shop', 'load:shop']);
    expect(warns.length).toBeGreaterThan(0);
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
