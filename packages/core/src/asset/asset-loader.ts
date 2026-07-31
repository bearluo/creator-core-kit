import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import {
  ASSET_SOURCE,
  createMemoryAssetSource,
  type AssetTypeToken,
  type IAssetSource,
} from './asset-source';

/**
 * AssetLoader（IAssetLoader）—— 资源粒度加载/释放。引用计数 + 并发去重 + group 批量释放，
 * account 全在 core（纯逻辑可测），经异步 IAssetSource 接缝落到引擎。设计见 docs/modules/asset-manager.md。
 */

export interface AssetLoadOptions {
  /** bundle name，缺省 'resources'（内置 bundle）。 */
  bundle?: string;
  /** 资源类型 token，缺省 'asset'（loadAny）。 */
  type?: AssetTypeToken;
  /** 归组，供 releaseGroup 批量回收（scope 语义：整组强制拆除）。 */
  group?: string;
  onProgress?: (finished: number, total: number) => void;
}

export interface IAssetLoader {
  /** 加载/引用一个资源；计数+1。已加载→命中缓存+计数；并发同键→共享 inflight；失败→reject（回滚）。 */
  load<T = unknown>(path: string, opts?: AssetLoadOptions): Promise<T>;
  /** 加载一个目录下资源（每个子资源各自建条目、计数、并组）。 */
  loadDir<T = unknown>(dir: string, opts?: AssetLoadOptions): Promise<T[]>;
  /** 预热（加载进缓存但不计业务引用，弱缓存）；后续 load 命中即转正、不重复加载。忽略 group。 */
  preload(path: string, opts?: AssetLoadOptions): Promise<void>;
  /** 远程散图/音/文本（不走 bundle）。 */
  loadRemote<T = unknown>(url: string, opts?: Omit<AssetLoadOptions, 'bundle'>): Promise<T>;
  /** 解引用；计数归零→真释放并从所有 group 移除。未加载键→告警 no-op。 */
  release(path: string, opts?: { bundle?: string; type?: AssetTypeToken }): void;
  /** 批量释放：把该组内全部资源强制拆除（scope 语义，忽略各自 refCount）。 */
  releaseGroup(group: string): void;
  /** 取已加载缓存（未加载/加载中→undefined）。 */
  get<T = unknown>(path: string, opts?: { bundle?: string; type?: AssetTypeToken }): T | undefined;
}

interface Entry {
  key: string;
  path: string;
  bundle: string;
  type: AssetTypeToken;
  refCount: number;
  value?: unknown;
  inflight?: Promise<unknown>;
  groups: Set<string>;
}

const DEFAULT_BUNDLE = 'resources';
const DEFAULT_TYPE: AssetTypeToken = 'asset';
const REMOTE_BUNDLE = '__remote';

const keyOf = (bundle: string, path: string, type: AssetTypeToken): string => `${bundle}::${path}::${type}`;

/** 造 AssetLoader（纯逻辑、零 cc；引擎 IO 经接缝注入）。 */
export function createAssetLoader(opts?: { source?: IAssetSource; logger?: ILogger }): IAssetLoader {
  const source = opts?.source ?? getRootContainer().tryResolve(ASSET_SOURCE) ?? createMemoryAssetSource();
  const logger = opts?.logger ?? getLogger('AssetLoader');
  const table = new Map<string, Entry>();
  const groups = new Map<string, Set<string>>(); // group → set of keys

  function addToGroup(e: Entry, group: string): void {
    e.groups.add(group);
    let s = groups.get(group);
    if (!s) {
      s = new Set();
      groups.set(group, s);
    }
    s.add(e.key);
  }

  /** 真释放一个条目：从所有 group 摘除、删表、调 source.releaseOne。 */
  function finalize(e: Entry): void {
    for (const g of e.groups) {
      const s = groups.get(g);
      if (s) {
        s.delete(e.key);
        if (s.size === 0) groups.delete(g);
      }
    }
    table.delete(e.key);
    source.releaseOne(e.path, { bundle: e.bundle, type: e.type });
  }

  /** 统一加载：命中缓存/inflight 去重；新建则 loader() 真加载。countRef=false 为弱缓存（preload）。 */
  async function acquire(
    key: string,
    path: string,
    bundle: string,
    type: AssetTypeToken,
    group: string | undefined,
    countRef: boolean,
    loader: () => Promise<unknown>,
  ): Promise<unknown> {
    const existing = table.get(key);
    if (existing) {
      if (existing.inflight) await existing.inflight; // 失败则抛，本次不计账
      if (countRef) existing.refCount++;
      if (group) addToGroup(existing, group);
      return existing.value;
    }
    const e: Entry = { key, path, bundle, type, refCount: 0, value: undefined, groups: new Set() };
    table.set(key, e);
    const p = loader();
    e.inflight = p;
    let val: unknown;
    try {
      val = await p;
    } catch (err) {
      table.delete(key); // 回滚新建条目
      throw err;
    }
    e.inflight = undefined;
    e.value = val;
    if (countRef) e.refCount++;
    if (group) addToGroup(e, group);
    return val;
  }

  return {
    load<T>(path: string, o?: AssetLoadOptions): Promise<T> {
      const bundle = o?.bundle ?? DEFAULT_BUNDLE;
      const type = o?.type ?? DEFAULT_TYPE;
      return acquire(keyOf(bundle, path, type), path, bundle, type, o?.group, true, () =>
        source.loadOne(path, { bundle, type, onProgress: o?.onProgress }),
      ) as Promise<T>;
    },

    preload(path: string, o?: AssetLoadOptions): Promise<void> {
      const bundle = o?.bundle ?? DEFAULT_BUNDLE;
      const type = o?.type ?? DEFAULT_TYPE;
      return acquire(keyOf(bundle, path, type), path, bundle, type, undefined, false, () =>
        source.loadOne(path, { bundle, type, onProgress: o?.onProgress }),
      ).then(() => undefined);
    },

    loadRemote<T>(url: string, o?: Omit<AssetLoadOptions, 'bundle'>): Promise<T> {
      const type = o?.type ?? DEFAULT_TYPE;
      return acquire(keyOf(REMOTE_BUNDLE, url, type), url, REMOTE_BUNDLE, type, o?.group, true, () =>
        source.loadRemote(url, { type }),
      ) as Promise<T>;
    },

    async loadDir<T>(dir: string, o?: AssetLoadOptions): Promise<T[]> {
      const bundle = o?.bundle ?? DEFAULT_BUNDLE;
      const type = o?.type ?? DEFAULT_TYPE;
      const items = await source.loadDir(dir, { bundle, type, onProgress: o?.onProgress });
      const out: T[] = [];
      for (const { path, asset } of items) {
        const key = keyOf(bundle, path, type);
        let e = table.get(key);
        if (!e) {
          e = { key, path, bundle, type, refCount: 0, value: asset, groups: new Set() };
          table.set(key, e);
        } else if (e.value === undefined) {
          e.value = asset;
          e.inflight = undefined;
        }
        e.refCount++;
        if (o?.group) addToGroup(e, o.group);
        out.push(e.value as T);
      }
      return out;
    },

    release(path: string, o?: { bundle?: string; type?: AssetTypeToken }): void {
      const bundle = o?.bundle ?? DEFAULT_BUNDLE;
      const type = o?.type ?? DEFAULT_TYPE;
      const e = table.get(keyOf(bundle, path, type));
      if (!e) {
        logger.warn(`release: 资源 '${bundle}::${path}::${type}' 未加载，忽略`);
        return;
      }
      e.refCount--;
      if (e.refCount <= 0) finalize(e);
    },

    releaseGroup(group: string): void {
      const s = groups.get(group);
      if (!s) {
        logger.warn(`releaseGroup: 组 '${group}' 不存在，忽略`);
        return;
      }
      for (const key of Array.from(s)) {
        const e = table.get(key);
        if (e) finalize(e); // scope 强制拆除，忽略 refCount
      }
      groups.delete(group);
    },

    get<T>(path: string, o?: { bundle?: string; type?: AssetTypeToken }): T | undefined {
      const bundle = o?.bundle ?? DEFAULT_BUNDLE;
      const type = o?.type ?? DEFAULT_TYPE;
      const e = table.get(keyOf(bundle, path, type));
      return e && !e.inflight ? (e.value as T) : undefined;
    },
  };
}

/** DI token：项目可 register 自己的 AssetLoader 覆盖默认。 */
export const ASSET_LOADER: Token<IAssetLoader> = createToken<IAssetLoader>('cck.assetLoader');

let _default: IAssetLoader | undefined;

/** 便捷取用：优先 tryResolve(ASSET_LOADER)；未注册则进程级默认（ASSET_SOURCE/内存背书）。 */
export function getAssetLoader(): IAssetLoader {
  return getRootContainer().tryResolve(ASSET_LOADER) ?? (_default ??= createAssetLoader());
}
