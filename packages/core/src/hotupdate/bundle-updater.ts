import type { LaunchFailure } from '../app';
import { createToken, getRootContainer, type Token } from '../di';
import { getLogger, type ILogger } from '../logging';
import { bundleVersionFromAssetKeys } from './bundle-version';
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
   * 把该 bundle 更到最新。同名重复调用只跑一次（**失败的那次不留缓存**，重试能真的重跑）。
   *
   * **更新不成就 reject**，由 `BundleManager.load` 原样抛给上层：启动期 → 启动失败页可重试，
   * 运行期 → 打开模块失败。**不退回包内版本静默继续** —— 那会把「CDN 少传了一个文件」这类发布事故
   * 伪装成「玩家在玩旧版」，线上无人察觉；何况包内那份还可能压根不存在（从没随包发过的新模块 /
   * 新马甲皮走种子 manifest 全量下载），降级只是把失败推迟到 `loadBundle`、报错更难查。
   *
   * 版本闸拒绝会带 `needFullUpdate` 标记（结构标记，见 {@link LaunchFailure}）——那是「该发整包了」，
   * 跟网络错不是一回事，UI 得引导去商店而不是让玩家对着「重试」徒劳点。
   *
   * 唯一的 no-op 是**平台没注册热更后端**（web / 编辑器）：那不是失败，是这条路不存在。
   */
  ensureLatest(bundle: string): Promise<void>;
  /**
   * 该 bundle 更新完之后**该按哪个版本加载**（native 内容寻址产物 = `index.<md5>.js` 的 md5）。
   *
   * 只有 {@link ensureLatest} 成功跑完才有值；之前、失败后、以及后端不认 manifest（web / 空后端）
   * 一律 `undefined` —— 调用方回落到别的版本来源。同步取值，因为 `BundleManager` 正是在
   * `await ensureLatest(...)` 的下一行用它。
   *
   * 可选：项目可以 register 自己的 `BundleUpdater`（见 {@link BUNDLE_UPDATER}），别为这个
   * 后加的能力把它们全判成不合法——不实现就等于「我不知道版本」，调用方回落。
   */
  versionOf?(bundle: string): string | undefined;
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
  const versions = new Map<string, string>();

  async function run(bundle: string): Promise<void> {
    if (!factory) return; // 平台没有热更后端（web / 编辑器）——不是失败，是没这条路
    // 造后端就抛通常是配置错（native 侧 manifest 路径不对），与「更新失败」同罪，一样不许掩盖
    const backend = factory(bundle);
    // 无论走哪条分支返回，都把版本记下：内容寻址产物里「加载哪个 md5」只有 manifest 知道，
    // 而 up-to-date 那条路同样需要它——包内 settings.bundleVers 只在从没更新过时才碰巧对得上。
    const remember = (): void => {
      const v = backend.assetKeys ? bundleVersionFromAssetKeys(bundle, backend.assetKeys()) : undefined;
      if (v !== undefined) versions.set(bundle, v);
    };
    const hu = createHotUpdateService({
      backend,
      gate: opts?.gate,
      app: opts?.app,
      logger,
    });
    const checked = await hu.check();
    if (checked.kind === 'up-to-date') {
      remember();
      return;
    }
    if (checked.kind === 'error') throw checked.error;
    if (checked.kind === 'rejected') {
      // 结构标记而非 Error 子类：跨 bundle instanceof 不可靠（ADR-0001）。app 的 classify 只认这个字段。
      throw Object.assign(new Error(`bundle '${bundle}' 更新被版本闸拒绝：${checked.reason}`), {
        __cckLaunchFailure: { kind: 'needFullUpdate', reason: checked.reason } as LaunchFailure,
      });
    }
    const updated = await hu.update((p) => opts?.onProgress?.(bundle, p));
    if (updated.kind === 'failed') throw updated.error;
    if (updated.kind !== 'ready') throw new Error(`bundle '${bundle}' 更新未就绪（${updated.kind}）`);
    remember();
  }

  return {
    ensureLatest(bundle): Promise<void> {
      let p = done.get(bundle);
      if (!p) {
        done.set(bundle, (p = run(bundle)));
        // 失败的那次别留在表里：否则「重试」拿到的是同一个已 reject 的 promise，永远重试不动
        void p.catch(() => {
          done.delete(bundle);
          // 版本一并作废：留着会让重试后的 load 拿旧 md5 去取一个可能已被 genDiff 删掉的文件。
          versions.delete(bundle);
        });
      }
      return p;
    },

    versionOf(bundle): string | undefined {
      return versions.get(bundle);
    },
  };
}

/** DI token：项目可 register 自己的 BundleUpdater 覆盖默认；未注册则 BundleManager 不做加载前更新。 */
export const BUNDLE_UPDATER: Token<BundleUpdater> = createToken<BundleUpdater>('cck.bundleUpdater');
