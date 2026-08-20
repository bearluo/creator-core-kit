import { createToken, type Token } from '../di';
import type { UpdateInfo } from './version-gate';

/** check 结果：已最新 / 发现新版本（带远程信息）。 */
export type CheckResult =
  | { status: 'up-to-date' }
  | { status: 'new-version'; info: UpdateInfo };

/** 下载进度（core 只转发/存储，不解释）。 */
export interface HotUpdateProgress {
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
}

/**
 * 热更后端接缝：core 只认本接口（守零 cc 铁律）。engine 按平台实现——
 * native 包 jsb.AssetsManager（checkUpdate/update 事件 + setSearchPaths + game.restart）；
 * Web/小游戏 包远程 Asset Bundle 版本化加载（assetManager.loadBundle({version})）。
 */
export interface IHotUpdateBackend {
  /** 拉远程 version 头、比版本（不下载资源）。 */
  check(): Promise<CheckResult>;
  /** 下载差量到本地（native：AssetsManager.update；web：loadBundle 到缓存）。 */
  download(onProgress: (p: HotUpdateProgress) => void): Promise<void>;
  /** 生效（native：setSearchPaths 置顶；web：激活新 bundle）。不含 restart。 */
  apply(): Promise<void>;
  /** 重启生效（native：game.restart；web：location.reload）。 */
  restart(): void;
  /**
   * 本地 manifest（更新成功后 = 远端那份）的 asset key 列表，供反推该 bundle 的内容版本
   * （见 {@link bundleVersionFromAssetKeys}）。**只在 check/download 跑完后调用才有意义**。
   *
   * 可选：没有 manifest 概念的后端（web / 空后端）不实现，`BundleUpdater.versionOf` 随之恒
   * `undefined`，版本回落到别的来源。
   */
  assetKeys?(): readonly string[];
}

/** DI token：engine Bootstrap register 平台适配；未注册时 HotUpdateService 回退空后端（恒 up-to-date）。 */
export const HOTUPDATE_BACKEND: Token<IHotUpdateBackend> =
  createToken<IHotUpdateBackend>('cck.hotUpdateBackend');

/**
 * 按 bundle 名造后端 —— 分包热更的接缝（一 bundle 一份 manifest、一个独立更新目标）。
 * native 实现给每个 bundle 一份独立 storagePath：`AssetsManagerEx` 的缓存 manifest 路径写死成
 * `<storagePath>/project.manifest`，共用目录会让各 bundle 互相覆盖。
 */
export type HotUpdateBackendFactory = (bundle: string) => IHotUpdateBackend;

/** DI token：engine 仅 native 注册；未注册 → BundleUpdater 恒 no-op（bundle 用包内版本）。 */
export const HOTUPDATE_BACKEND_FACTORY: Token<HotUpdateBackendFactory> =
  createToken<HotUpdateBackendFactory>('cck.hotUpdateBackendFactory');

/**
 * 空后端（null object）：恒报「已最新」、下载/应用/重启皆 no-op。
 * 默认实现（非 native 或未接热更时）+ 可预置 check 结果供测试。
 */
export function createMemoryHotUpdateBackend(preset?: { check?: CheckResult }): IHotUpdateBackend {
  return {
    check: () => Promise.resolve(preset?.check ?? { status: 'up-to-date' }),
    download: () => Promise.resolve(),
    apply: () => Promise.resolve(),
    restart: () => {},
  };
}
