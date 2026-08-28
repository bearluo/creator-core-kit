import {
  Asset,
  assetManager,
  resources,
  Prefab,
  SceneAsset,
  SpriteFrame,
  SpriteAtlas,
  Texture2D,
  ImageAsset,
  AudioClip,
  JsonAsset,
  TextAsset,
  Material,
  Font,
  AnimationClip,
} from 'cc';
import { ASSET_SOURCE } from '@cck/core';
import type {
  IAssetSource,
  AssetSourceOptions,
  AssetTypeToken,
  DirAssetItem,
  KitModule,
} from '@cck/core';

/**
 * IAssetSource 的 cc 实现 —— AssetManager 的「引擎半」薄壳：只做原子真加载/释放，零 account。
 * 引用计数 / 并发去重 / group 全在 core 的 AssetLoader（见 asset-loader.ts）。
 * cc 的加载是 callback 风格 `(err, asset)`，这里 promisify 成 core 接缝要的 Promise。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AssetCtor = new (...args: any[]) => import('cc').Asset;

/** AssetTypeToken → cc Asset 构造函数（'asset' / 未知 → undefined，走通配 load）。 */
const TYPE_MAP: Record<string, AssetCtor> = {
  prefab: Prefab,
  scene: SceneAsset,
  spriteFrame: SpriteFrame,
  spriteAtlas: SpriteAtlas,
  texture: Texture2D,
  imageAsset: ImageAsset,
  audioClip: AudioClip,
  json: JsonAsset,
  text: TextAsset,
  material: Material,
  font: Font,
  animationClip: AnimationClip,
};

function ctorOf(type?: AssetTypeToken): AssetCtor | undefined {
  if (!type || type === 'asset') return undefined;
  return TYPE_MAP[type];
}

/** 'resources'/缺省 → 内置 resources bundle；其余 → 已加载的具名 bundle（未加载返 null）。 */
function bundleOrNull(name?: string): import('cc').AssetManager.Bundle | null {
  if (!name || name === 'resources') return resources;
  return assetManager.getBundle(name);
}

function requireBundle(name?: string): import('cc').AssetManager.Bundle {
  const b = bundleOrNull(name);
  if (!b) throw new Error(`AssetSource: bundle '${name ?? ''}' 未加载（应先经 BundleManager 加载）`);
  return b;
}

/** 造走真 cc 的 IAssetSource（无状态；account 在 core）。 */
export function createCcAssetSource(): IAssetSource {
  return {
    loadOne<T = unknown>(path: string, opts?: AssetSourceOptions): Promise<T> {
      const bundle = requireBundle(opts?.bundle);
      const ctor = ctorOf(opts?.type);
      const onProgress = opts?.onProgress ?? null;
      return new Promise<T>((resolve, reject) => {
        const done = (err: Error | null, asset: import('cc').Asset): void => {
          if (err) reject(err);
          else resolve(asset as T);
        };
        if (ctor) bundle.load(path, ctor, onProgress, done);
        else bundle.load(path, onProgress, done);
      });
    },

    async loadDir<T = unknown>(dir: string, opts?: AssetSourceOptions): Promise<DirAssetItem<T>[]> {
      const bundle = requireBundle(opts?.bundle);
      const ctor = ctorOf(opts?.type);
      // core 需要每个子资源的 path 做引用计数键；cc loadDir 回调只给 asset[] 不给 path，
      // 故先 getDirWithPath 拿路径清单，再逐个 load 配对（path↔asset 明确）。
      // ponytail: 逐个 load 而非 cc 批量 loadDir——量大且需极致吞吐时再换批量+按序 zip。
      const infos = bundle.getDirWithPath(dir, ctor ?? null);
      return Promise.all(
        infos.map(
          (info) =>
            new Promise<DirAssetItem<T>>((resolve, reject) => {
              const done = (err: Error | null, asset: import('cc').Asset): void => {
                if (err) reject(err);
                else resolve({ path: info.path, asset: asset as T });
              };
              if (ctor) bundle.load(info.path, ctor, null, done);
              else bundle.load(info.path, null, done);
            }),
        ),
      );
    },

    loadRemote<T = unknown>(url: string): Promise<T> {
      // cc 靠 url 扩展名判类型；opts.type 首版忽略（需要时可加 options.ext）。省略未用参数，
      // IAssetSource.loadRemote 的可选 opts 由结构类型允许省略。
      return new Promise<T>((resolve, reject) => {
        assetManager.loadRemote<import('cc').Asset>(url, null, (err, asset) => {
          if (err) reject(err);
          else resolve(asset as T);
        });
      });
    },

    releaseOne(path: string, opts?: { bundle?: string; type?: AssetTypeToken }): void {
      const bundle = bundleOrNull(opts?.bundle);
      // remote（无 bundle）/ 已卸载的 bundle → 按 path 反查不到，no-op。
      // core 手里有资源本身时不会走到这里（走下面的 releaseValue）。
      if (!bundle) return;
      bundle.release(path, ctorOf(opts?.type));
    },

    releaseValue(asset: unknown): void {
      // 不查 bundle 表 —— `removeBundle` 之后 `getBundle(name)` 就是 null，而这条路上要还的
      // 恰恰是「bundle 已经卸了、资源才刚落地」的那一份。语义与 `bundle.release(path)` 等价
      // （官方文档：`Bundle.release`「详细信息请参考 `AssetManager.releaseAsset`」）。
      if (asset instanceof Asset) assetManager.releaseAsset(asset);
    },
  };
}

/** KitModule：注册 `ASSET_SOURCE → cc 实现`（本层未注册时）。放模块数组里，AssetLoader 自动拾取。 */
export function ccAssetModule(): KitModule {
  return {
    name: 'asset-source',
    install(ctx) {
      if (!ctx.container.hasLocal(ASSET_SOURCE)) {
        ctx.container.register(ASSET_SOURCE, { useValue: createCcAssetSource() });
      }
    },
  };
}
