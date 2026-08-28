import { createToken, type Token } from '../di';

/**
 * 资源类型 token（core 零 cc）：engine 侧维护 token → cc Constructor<Asset> 映射。
 * 'asset' = 通配（走 assetManager.loadAny，不指定类型）。字符串联合带逃逸口，engine 可扩展。
 */
export type AssetTypeToken =
  | 'asset'
  | 'prefab'
  | 'scene'
  | 'spriteFrame'
  | 'spriteAtlas'
  | 'texture'
  | 'imageAsset'
  | 'audioClip'
  | 'json'
  | 'text'
  | 'material'
  | 'font'
  | 'animationClip'
  | (string & {});

/** 引擎侧加载单个/目录资源的选项。 */
export interface AssetSourceOptions {
  bundle?: string;
  type?: AssetTypeToken;
  onProgress?: (finished: number, total: number) => void;
}

/** loadDir 的一项：路径 + 资源值（core 需要各自 path 做引用计数键）。 */
export interface DirAssetItem<T = unknown> {
  path: string;
  asset: T;
}

/**
 * AssetLoader 的引擎 IO 接缝：只做原子「真加载一个 / 真加载目录 / 真加载远程 / 真释放一个」，零 cc。
 * engine 实现走 cc 的 bundle.load / bundle.loadDir / assetManager.loadRemote / addRef·decRef；
 * 测试注入内存 fake。account（引用计数/去重/group）全在 AssetLoader（core），本接缝不管账。
 */
export interface IAssetSource {
  loadOne<T = unknown>(path: string, opts?: AssetSourceOptions): Promise<T>;
  loadDir<T = unknown>(dir: string, opts?: AssetSourceOptions): Promise<DirAssetItem<T>[]>;
  loadRemote<T = unknown>(url: string, opts?: { type?: AssetTypeToken }): Promise<T>;
  releaseOne(path: string, opts?: { bundle?: string; type?: AssetTypeToken }): void;
  /**
   * 按**资源本身**释放（可选实现）。手里有资源时 AssetLoader 优先走这条。
   *
   * `releaseOne` 靠 `bundle` + `path` 反查资源，**bundle 已被卸载时反查不到 → 静默 no-op**；
   * 而「scope 在加载途中被关、bundle 随后被卸」这条路上迟到的那份资源正好落在这个窗口里。
   * 顺带也让 remote 资源（压根没有 bundle）能被精确释放。
   * engine 实现 = `assetManager.releaseAsset(asset)`，与 `bundle.release(path)` 同语义
   * （官方文档：`Bundle.release`「详细信息请参考 `AssetManager.releaseAsset`」）。
   */
  releaseValue?(asset: unknown): void;
}

/** DI token：engine 注册 cc 适配，createAssetLoader() 自动拾取。 */
export const ASSET_SOURCE: Token<IAssetSource> = createToken<IAssetSource>('cck.assetSource');

/**
 * 内存 fake（默认 / 测试）：按 path 返回预置资源，缺省合成一个稳定 stub（`{ __asset: path }`）。
 * releaseOne 无副作用（真释放交给引擎）。不含真 cc。
 */
export function createMemoryAssetSource(preset?: { assets?: Record<string, unknown> }): IAssetSource {
  const store = new Map<string, unknown>(Object.entries(preset?.assets ?? {}));
  const make = (path: string): unknown => (store.has(path) ? store.get(path) : { __asset: path });
  return {
    async loadOne<T>(path: string): Promise<T> {
      return make(path) as T;
    },
    async loadDir<T>(dir: string): Promise<DirAssetItem<T>[]> {
      const out: DirAssetItem<T>[] = [];
      for (const [k, v] of store) {
        if (k === dir || k.startsWith(`${dir}/`)) out.push({ path: k, asset: v as T });
      }
      return out;
    },
    async loadRemote<T>(url: string): Promise<T> {
      return make(url) as T;
    },
    releaseOne(): void {
      /* fake：无副作用 */
    },
  };
}
