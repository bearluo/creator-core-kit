import { afterEach, describe, expect, it } from 'vitest';
import {
  createAssetLoader,
  getAssetLoader,
  ASSET_LOADER,
} from '../asset-loader';
import {
  createMemoryAssetSource,
  ASSET_SOURCE,
  type DirAssetItem,
  type IAssetSource,
} from '../asset-source';
import { getRootContainer } from '../../di';
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

const val = (path: string): { id: string } => ({ id: path });

/** 可控 spy IAssetSource：记录调用；auto=false 时 loadOne 挂起，由 flush/failAll 结算。 */
function makeSource() {
  const loadOneCalls: string[] = [];
  const loadDirCalls: string[] = [];
  const loadRemoteCalls: string[] = [];
  const releaseOneCalls: Array<{ path: string; bundle?: string; type?: string }> = [];
  const pending: Array<{ path: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
  let auto = true;
  const source: IAssetSource = {
    loadOne<T>(path: string): Promise<T> {
      loadOneCalls.push(path);
      if (auto) return Promise.resolve(val(path) as T);
      return new Promise<T>((resolve, reject) => {
        pending.push({ path, resolve: (v) => resolve(v as T), reject });
      });
    },
    async loadDir<T>(dir: string): Promise<DirAssetItem<T>[]> {
      loadDirCalls.push(dir);
      return [
        { path: `${dir}/a`, asset: val(`${dir}/a`) as T },
        { path: `${dir}/b`, asset: val(`${dir}/b`) as T },
      ];
    },
    async loadRemote<T>(url: string): Promise<T> {
      loadRemoteCalls.push(url);
      return val(url) as T;
    },
    releaseOne(path: string, opts?: { bundle?: string; type?: string }): void {
      releaseOneCalls.push({ path, bundle: opts?.bundle, type: opts?.type });
    },
  };
  return {
    source,
    loadOneCalls,
    loadDirCalls,
    loadRemoteCalls,
    releaseOneCalls,
    setAuto: (v: boolean) => {
      auto = v;
    },
    flush: () => {
      pending.forEach((p) => p.resolve(val(p.path)));
      pending.length = 0;
    },
    failAll: (e: unknown) => {
      pending.forEach((p) => p.reject(e));
      pending.length = 0;
    },
  };
}

describe('AssetLoader', () => {
  afterEach(() => {
    const root = getRootContainer();
    root.unregister(ASSET_SOURCE);
    root.unregister(ASSET_LOADER);
  });

  it('1. load 新资源 → source 一次、返回值、get 命中', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    expect(await al.load('p')).toEqual({ id: 'p' });
    expect(s.loadOneCalls).toEqual(['p']);
    expect(al.get('p')).toEqual({ id: 'p' });
  });

  it('2. 同键重复 load → source 只调一次、值一致', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    const a = await al.load('p');
    const b = await al.load('p');
    expect(s.loadOneCalls).toEqual(['p']);
    expect(a).toBe(b);
  });

  it('3. 并发 load 同键 → 共享 inflight、source 一次、都 resolve；加载中 get=undefined', async () => {
    const s = makeSource();
    s.setAuto(false);
    const al = createAssetLoader({ source: s.source });
    const p1 = al.load('p');
    const p2 = al.load('p');
    expect(s.loadOneCalls).toEqual(['p']);
    expect(al.get('p')).toBeUndefined();
    s.flush();
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toEqual({ id: 'p' });
    expect(b).toEqual({ id: 'p' });
    expect(al.get('p')).toEqual({ id: 'p' });
  });

  it('4. 引用计数：load 两次、release 一次仍在，二次归零才真释放', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    await al.load('p');
    await al.load('p');
    al.release('p');
    expect(s.releaseOneCalls).toEqual([]);
    expect(al.get('p')).toEqual({ id: 'p' });
    al.release('p');
    expect(s.releaseOneCalls).toEqual([{ path: 'p', bundle: 'resources', type: 'asset' }]);
    expect(al.get('p')).toBeUndefined();
  });

  it('5. release 多于 load → 释放一次后告警 no-op', async () => {
    const s = makeSource();
    const { logger, warns } = fakeLogger();
    const al = createAssetLoader({ source: s.source, logger });
    await al.load('p');
    al.release('p'); // 归零释放
    al.release('p'); // 已删 → 告警
    expect(s.releaseOneCalls.length).toBe(1);
    expect(warns.length).toBe(1);
  });

  it('6. release 未加载键 → 告警 no-op', () => {
    const s = makeSource();
    const { logger, warns } = fakeLogger();
    const al = createAssetLoader({ source: s.source, logger });
    al.release('nope');
    expect(warns.length).toBe(1);
    expect(s.releaseOneCalls).toEqual([]);
  });

  it('7. load 失败 → reject、回滚不留缓存、可重试', async () => {
    const s = makeSource();
    s.setAuto(false);
    const al = createAssetLoader({ source: s.source });
    const p = al.load('p');
    s.failAll(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(al.get('p')).toBeUndefined();
    s.setAuto(true);
    expect(await al.load('p')).toEqual({ id: 'p' });
    expect(s.loadOneCalls).toEqual(['p', 'p']);
  });

  it('7b. 并发 load 失败 → 两者都 reject、可重试', async () => {
    const s = makeSource();
    s.setAuto(false);
    const al = createAssetLoader({ source: s.source });
    const p1 = al.load('p');
    const p2 = al.load('p');
    s.failAll(new Error('x'));
    await expect(p1).rejects.toThrow('x');
    await expect(p2).rejects.toThrow('x');
    expect(s.loadOneCalls).toEqual(['p']);
  });

  it('8. group：整组 releaseGroup 强制释放全部', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    await al.load('a', { group: 'ui' });
    await al.load('b', { group: 'ui' });
    al.releaseGroup('ui');
    expect(s.releaseOneCalls.map((c) => c.path).sort()).toEqual(['a', 'b']);
    expect(al.get('a')).toBeUndefined();
    expect(al.get('b')).toBeUndefined();
  });

  it('9. group 强制拆除忽略 refCount（load 两次同键仍一次清掉）', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    await al.load('a', { group: 'ui' });
    await al.load('a'); // refCount=2
    al.releaseGroup('ui');
    expect(s.releaseOneCalls.map((c) => c.path)).toEqual(['a']);
    expect(al.get('a')).toBeUndefined();
  });

  it('10. 一键属两组：releaseGroup 一组即拆除、另一组随之空', async () => {
    const s = makeSource();
    const { logger, warns } = fakeLogger();
    const al = createAssetLoader({ source: s.source, logger });
    await al.load('a', { group: 'g1' });
    await al.load('a', { group: 'g2' });
    al.releaseGroup('g1');
    expect(al.get('a')).toBeUndefined();
    al.releaseGroup('g2'); // g2 已随 finalize 清空 → 告警
    expect(warns.length).toBe(1);
  });

  it('11. releaseGroup 不存在的组 → 告警 no-op', () => {
    const s = makeSource();
    const { logger, warns } = fakeLogger();
    const al = createAssetLoader({ source: s.source, logger });
    al.releaseGroup('none');
    expect(warns.length).toBe(1);
    expect(s.releaseOneCalls).toEqual([]);
  });

  it('12. 不同 bundle/type 同 path → 不同键、独立加载与释放', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    await al.load('p', { bundle: 'A' });
    await al.load('p', { bundle: 'B' });
    await al.load('p', { type: 'prefab' }); // resources bundle, prefab 类型
    expect(s.loadOneCalls).toEqual(['p', 'p', 'p']); // 三个不同键各一次
    al.release('p', { bundle: 'A' });
    expect(s.releaseOneCalls).toEqual([{ path: 'p', bundle: 'A', type: 'asset' }]);
    expect(al.get('p', { bundle: 'B' })).toEqual({ id: 'p' });
    expect(al.get('p', { type: 'prefab' })).toEqual({ id: 'p' });
  });

  it('13. preload 弱缓存：不计业务引用；随后 load 命中不重复加载', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    await al.preload('p');
    expect(s.loadOneCalls).toEqual(['p']);
    expect(al.get('p')).toEqual({ id: 'p' }); // 已在缓存
    const v = await al.load('p'); // 命中缓存转正
    expect(s.loadOneCalls).toEqual(['p']); // 未重复加载
    expect(v).toEqual({ id: 'p' });
    al.release('p'); // 计数 1→0 真释放
    expect(s.releaseOneCalls.length).toBe(1);
    expect(al.get('p')).toBeUndefined();
  });

  it('13b. preload 带 bundle/type/onProgress → 键含 bundle+type', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    let progressed = false;
    await al.preload('p', { bundle: 'A', type: 'prefab', onProgress: () => (progressed = true) });
    expect(al.get('p', { bundle: 'A', type: 'prefab' })).toEqual({ id: 'p' });
    expect(al.get('p')).toBeUndefined(); // 默认键未加载
    expect(progressed).toBe(false); // fake 不回调进度，仅覆盖参数透传分支
  });

  it('14. preload 并发被 load 复用 inflight', async () => {
    const s = makeSource();
    s.setAuto(false);
    const al = createAssetLoader({ source: s.source });
    const pp = al.preload('p');
    const lp = al.load('p');
    expect(s.loadOneCalls).toEqual(['p']); // 只发起一次
    s.flush();
    await Promise.all([pp, lp]);
    expect(al.get('p')).toEqual({ id: 'p' });
  });

  it('15. loadRemote → 走 source.loadRemote、可 group 回收', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    const v = await al.loadRemote('https://cdn/x.png', { group: 'remote' });
    expect(v).toEqual({ id: 'https://cdn/x.png' });
    expect(s.loadRemoteCalls).toEqual(['https://cdn/x.png']);
    al.releaseGroup('remote');
    expect(s.releaseOneCalls[0].path).toBe('https://cdn/x.png');
  });

  it('16. loadDir → 每个子资源建键计数、返回资源数组；可 group 整批回收', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    const arr = await al.loadDir('items', { group: 'lvl' });
    expect(arr).toEqual([{ id: 'items/a' }, { id: 'items/b' }]);
    expect(s.loadDirCalls).toEqual(['items']);
    expect(al.get('items/a')).toEqual({ id: 'items/a' });
    al.releaseGroup('lvl');
    expect(s.releaseOneCalls.map((c) => c.path).sort()).toEqual(['items/a', 'items/b']);
  });

  it('17. loadDir 二次 → 已加载条目再计数（不覆盖 value）', async () => {
    const s = makeSource();
    const al = createAssetLoader({ source: s.source });
    await al.loadDir('items');
    await al.loadDir('items'); // refCount 各+1 → 2
    al.release('items/a');
    expect(s.releaseOneCalls).toEqual([]); // 仍 refCount=1
    al.release('items/a');
    expect(s.releaseOneCalls.map((c) => c.path)).toEqual(['items/a']);
  });

  it('18. loadDir 补齐 pending load 的空缓存（value===undefined 分支）', async () => {
    const s = makeSource();
    s.setAuto(false);
    const al = createAssetLoader({ source: s.source });
    const lp = al.load('items/a'); // 建条目、inflight、value=undefined
    await al.loadDir('items'); // 命中该条目、补 value、refCount++
    expect(al.get('items/a')).toEqual({ id: 'items/a' });
    s.flush();
    await lp;
    expect(al.get('items/a')).toEqual({ id: 'items/a' });
  });

  it('19. 默认 source：DI ASSET_SOURCE 优先', async () => {
    const s = makeSource();
    getRootContainer().register(ASSET_SOURCE, { useValue: s.source });
    const al = createAssetLoader();
    await al.load('p');
    expect(s.loadOneCalls).toEqual(['p']);
  });

  it('20. 未注册 source → 退内存 fake（不抛）', async () => {
    const al = createAssetLoader();
    expect(await al.load('p')).toEqual({ __asset: 'p' });
  });

  it('21. getAssetLoader：token 优先 / 回退非空', () => {
    const s = makeSource();
    const custom = createAssetLoader({ source: s.source });
    getRootContainer().register(ASSET_LOADER, { useValue: custom });
    expect(getAssetLoader()).toBe(custom);
    getRootContainer().unregister(ASSET_LOADER);
    expect(getAssetLoader()).toBeTruthy();
  });
});

describe('createMemoryAssetSource', () => {
  it('loadOne 预置/合成；loadDir 按前缀；loadRemote；releaseOne no-op', async () => {
    const src = createMemoryAssetSource({ assets: { 'a/x': { v: 1 }, 'a/y': { v: 2 }, b: { v: 3 } } });
    expect(await src.loadOne('a/x')).toEqual({ v: 1 });
    expect(await src.loadOne('missing')).toEqual({ __asset: 'missing' });
    const dir = await src.loadDir('a');
    expect(dir.map((d) => d.path).sort()).toEqual(['a/x', 'a/y']);
    expect(await src.loadRemote('http://u')).toEqual({ __asset: 'http://u' });
    expect(() => src.releaseOne('a/x')).not.toThrow();
  });
});
