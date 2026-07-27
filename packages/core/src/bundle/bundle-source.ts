import { createToken, type Token } from '../di';

/**
 * BundleManager 的引擎 IO 接缝：只做「真加载 / 真释放 / 是否就绪」三原子操作，零 cc。
 * engine 实现走 cc.assetManager（loadBundle/getBundle/removeBundle）；测试注入内存 fake。
 * 名义（name）由 BundleManager 统一决定并传入；url 仅远程加载时作 fetch 提示。
 */
export interface BundleLoadOptions {
  /** 远程 bundle 版本（md5 前缀等）。 */
  version?: string;
  /** 加载进度回调（finished/total）。 */
  onProgress?: (finished: number, total: number) => void;
}

export interface IBundleSource {
  /** 真加载一个 bundle 到就绪。name=注册名；opts.url 存在则从该远程 url 取，否则按本地 name 取。 */
  loadBundle(name: string, opts?: BundleLoadOptions & { url?: string }): Promise<void>;
  /** 真释放整个 bundle。 */
  releaseBundle(name: string): void;
  /** 引擎侧该 bundle 是否已就绪。 */
  hasBundle(name: string): boolean;
}

/** DI token：engine 注册 cc.assetManager 适配，createBundleManager() 自动拾取。 */
export const BUNDLE_SOURCE: Token<IBundleSource> = createToken<IBundleSource>('cck.bundleSource');

/**
 * 内存 fake（默认 / 测试）：把「加载」建模为把 name 加入就绪集，「释放」移除。
 * preset.present 里的名字视为一开始就已就绪（免加载）。不含真 cc。
 */
export function createMemoryBundleSource(preset?: { present?: string[] }): IBundleSource {
  const ready = new Set<string>(preset?.present ?? []);
  return {
    async loadBundle(name: string): Promise<void> {
      ready.add(name);
    },
    releaseBundle(name: string): void {
      ready.delete(name);
    },
    hasBundle(name: string): boolean {
      return ready.has(name);
    },
  };
}
