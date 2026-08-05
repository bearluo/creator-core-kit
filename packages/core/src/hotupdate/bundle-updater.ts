import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import {
  HOTUPDATE_BACKEND_FACTORY,
  type HotUpdateBackendFactory,
  type HotUpdateProgress,
} from './hotupdate-backend';
import { createHotUpdateService } from './hotupdate-service';
import type { AppInfo, VersionGate } from './version-gate';

/**
 * BundleUpdater —— 「加载前把这个 bundle 更到最新」。分包热更的编排半，纯逻辑、零 cc。
 *
 * 每个 bundle 一个 {@link createHotUpdateService} 实例（状态机 / 版本闸 / 进度全复用），后端由
 * {@link HotUpdateBackendFactory} 按名产出。挂在 `BundleManager.load` 之前——UIManager 打开界面时
 * 也会 load 它所属的 bundle，挂上层 App 必漏那条路径。
 *
 * native 上模块 bundle 更新**不需要重启也不需要启动还原**：`AssetsManagerEx` 在 `create()` 与
 * `updateSucceed()` 里都会自行 `prependSearchPaths`，而模块 bundle 此刻尚未加载。
 */
export interface BundleUpdater {
  /**
   * 把该 bundle 更到最新。同名重复调用只跑一次，并发共享同一次。
   *
   * **永不 reject**：离线 / CDN 挂 / 版本闸拒（该发整包了）一律记日志后正常返回，退回包内版本继续加载。
   * 热更失败让玩家进不去游戏，比不热更严重得多。
   */
  ensureLatest(bundle: string): Promise<void>;
}

export interface BundleUpdaterOptions {
  /** 按名造后端。默认 DI {@link HOTUPDATE_BACKEND_FACTORY}；未注册 → 恒 no-op。 */
  factory?: HotUpdateBackendFactory;
  /** 版本闸，透传给每个 bundle 的 HotUpdateService。 */
  gate?: VersionGate;
  /** 本地客户端信息（版本 / coreApiHash），透传给闸。 */
  app?: AppInfo;
  /** 下载进度，带上是哪个 bundle。 */
  onProgress?: (bundle: string, p: HotUpdateProgress) => void;
  logger?: ILogger;
}

/** 造 BundleUpdater（纯逻辑、零 cc；平台 IO 经 HotUpdateBackendFactory 注入）。 */
export function createBundleUpdater(opts?: BundleUpdaterOptions): BundleUpdater {
  const factory = opts?.factory ?? getRootContainer().tryResolve(HOTUPDATE_BACKEND_FACTORY);
  const logger = opts?.logger ?? getLogger('BundleUpdater');
  // 一 bundle 一次；存 promise 而非布尔，并发天然共享、跑完也不再重来。
  const done = new Map<string, Promise<void>>();

  async function run(bundle: string): Promise<void> {
    if (!factory) return;
    let hu;
    try {
      // 造后端本身也可能抛（如 native 侧 manifest 路径不对），别让它变成加载失败。
      hu = createHotUpdateService({ backend: factory(bundle), gate: opts?.gate, app: opts?.app, logger });
    } catch (e) {
      logger.warn(`bundle '${bundle}' 热更后端创建失败，用包内版本`, e);
      return;
    }
    const checked = await hu.check();
    if (checked.kind === 'up-to-date') return;
    if (checked.kind === 'error') {
      logger.warn(`bundle '${bundle}' 检查更新失败，用包内版本`, checked.error);
      return;
    }
    if (checked.kind === 'rejected') {
      logger.warn(`bundle '${bundle}' 更新被版本闸拒绝（${checked.reason}），用包内版本`);
      return;
    }
    const updated = await hu.update((p) => opts?.onProgress?.(bundle, p));
    if (updated.kind !== 'ready') {
      logger.warn(`bundle '${bundle}' 更新未就绪（${updated.kind}），用包内版本`);
    }
  }

  return {
    ensureLatest(bundle): Promise<void> {
      let p = done.get(bundle);
      if (!p) done.set(bundle, (p = run(bundle)));
      return p;
    },
  };
}

/** DI token：项目可 register 自己的 BundleUpdater 覆盖默认；未注册则 BundleManager 不做加载前更新。 */
export const BUNDLE_UPDATER: Token<BundleUpdater> = createToken<BundleUpdater>('cck.bundleUpdater');
