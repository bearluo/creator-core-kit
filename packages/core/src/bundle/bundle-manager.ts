import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import {
  BUNDLE_SOURCE,
  createMemoryBundleSource,
  type BundleLoadOptions,
  type IBundleSource,
} from './bundle-source';

/**
 * BundleManager —— 按需分包（bundle 粒度）。引用计数 + 并发去重 + 版本/远程入口，
 * 经异步 IBundleSource 接缝落到引擎。纯逻辑、零 cc。设计见 docs/modules/bundle-manager.md。
 */

/** 不透明句柄：core 不持真 cc.Bundle，只带 name/version 只读元信息；engine 按 name 反解。 */
export type BundleHandle = { readonly name: string; readonly version?: string };

/** 已加载 bundle 的快照信息。 */
export interface BundleInfo {
  readonly name: string;
  readonly version?: string;
  readonly refCount: number;
}

export interface BundleManagerOptions {
  /** 引擎 IO 后端。默认：DI BUNDLE_SOURCE，未注册则内存 fake。 */
  source?: IBundleSource;
  logger?: ILogger;
}

export interface BundleManager {
  /**
   * 加载 / 引用一个 bundle。
   * - nameOrUrl：不带 opts.name 时是本地 bundle 名；带 opts.name 时 nameOrUrl 视为远程 url、以 name 注册。
   * - 已加载 → 计数+1 立即返回；并发同名 → 共享 inflight；失败 → reject（回滚、不留计数）。
   */
  load(nameOrUrl: string, opts?: BundleLoadOptions & { name?: string }): Promise<BundleHandle>;
  /** 释放 / 解引用。计数−1，归零 → source.releaseBundle。未加载名 → 告警 no-op。 */
  release(name: string): void;
  /** 计数>0、非加载中、且引擎侧就绪。 */
  isLoaded(name: string): boolean;
  /** 取已就绪句柄（加载中或未加载 → undefined）。 */
  get(name: string): BundleHandle | undefined;
  /** 已跟踪 bundle 快照（name 升序）。 */
  list(): BundleInfo[];
}

interface Entry {
  version?: string;
  refCount: number;
  inflight?: Promise<void>;
}

/** 造 BundleManager（纯逻辑、零 cc；引擎 IO 经接缝注入）。 */
export function createBundleManager(opts?: BundleManagerOptions): BundleManager {
  const source = opts?.source ?? getRootContainer().tryResolve(BUNDLE_SOURCE) ?? createMemoryBundleSource();
  const logger = opts?.logger ?? getLogger('BundleManager');
  const table = new Map<string, Entry>();

  const handleOf = (name: string, e: Entry): BundleHandle => ({ name, version: e.version });

  return {
    async load(nameOrUrl, loadOpts): Promise<BundleHandle> {
      const name = loadOpts?.name ?? nameOrUrl;
      const url = loadOpts?.name !== undefined ? nameOrUrl : undefined;

      const existing = table.get(name);
      if (existing) {
        existing.refCount++;
        // 加载中→等同一 inflight（失败则抛，本次计数随首个加载者回滚的废弃条目一并丢弃）。
        if (existing.inflight) await existing.inflight;
        return handleOf(name, existing);
      }

      const entry: Entry = { version: loadOpts?.version, refCount: 1 };
      const p = source.loadBundle(name, {
        version: loadOpts?.version,
        onProgress: loadOpts?.onProgress,
        url,
      });
      entry.inflight = p;
      table.set(name, entry);
      try {
        await p;
        entry.inflight = undefined;
        return handleOf(name, entry);
      } catch (e) {
        table.delete(name);
        throw e;
      }
    },

    release(name): void {
      const e = table.get(name);
      if (!e) {
        logger.warn(`release: bundle '${name}' 未加载，忽略`);
        return;
      }
      e.refCount--;
      if (e.refCount <= 0) {
        table.delete(name);
        source.releaseBundle(name);
      }
    },

    isLoaded(name): boolean {
      const e = table.get(name);
      return !!e && !e.inflight && source.hasBundle(name);
    },

    get(name): BundleHandle | undefined {
      const e = table.get(name);
      return e && !e.inflight ? handleOf(name, e) : undefined;
    },

    list(): BundleInfo[] {
      return [...table.entries()]
        .map(([name, e]) => ({ name, version: e.version, refCount: e.refCount }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

/** DI token：项目可 register 自己的 BundleManager 覆盖默认。 */
export const BUNDLE_MANAGER: Token<BundleManager> = createToken<BundleManager>('cck.bundleManager');

let _default: BundleManager | undefined;

/** 便捷取用：优先 tryResolve(BUNDLE_MANAGER)；未注册则进程级默认（BUNDLE_SOURCE/内存背书）。 */
export function getBundleManager(): BundleManager {
  return getRootContainer().tryResolve(BUNDLE_MANAGER) ?? (_default ??= createBundleManager());
}
