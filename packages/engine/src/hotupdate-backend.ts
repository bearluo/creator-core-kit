import { game, native, sys } from 'cc';
import { HOTUPDATE_BACKEND, HOTUPDATE_BACKEND_FACTORY } from '@cck/core';
import type {
  CheckResult,
  HotUpdateBackendFactory,
  HotUpdateProgress,
  IHotUpdateBackend,
  KitModule,
  UpdateInfo,
} from '@cck/core';
import {
  bundleManifestName,
  bundleStoragePath,
  normalizeSearchPaths,
  retiredBundleDirs,
} from './hotupdate-paths';

/**
 * IHotUpdateBackend 的 native 实现 —— HotUpdateService 的「引擎半」薄壳：包 `native.AssetsManager`
 * （原 `jsb.AssetsManager`，Cocos 3.x 迁入 `native` 命名空间）的 checkUpdate/update/setSearchPaths/restart。
 * core 的状态机 / 版本闸 / 进度存储在 HotUpdateService，本壳只做原子的原生 IO + 事件桥接。
 *
 * **仅原生平台可用**：web / 编辑器预览下 `native.AssetsManager` 为 undefined，故 `ccHotUpdateModule` 用
 * `sys.isNative` 守门——非原生不注册，core 回退空后端（恒 up-to-date）。
 *
 * 两个更新目标：**base**（AOT 层整包，`HOTUPDATE_BACKEND`，换了要重启）与**模块 bundle**
 * （`HOTUPDATE_BACKEND_FACTORY`，一 bundle 一 manifest 一 storagePath，加载前更新、免重启）。
 *
 * ⚠️ 集成前提（本 npm 包管不到、须在消费方工程侧做）：**base** 的 apply() 会把搜索路径写入
 * localStorage[searchPathsKey]，而**引擎启动前的还原**要放消费方的 `build-templates/native/index.ejs`
 * （渲染成 data/main.js 顶部，先于任何 require 读同一 key → setSearchPaths）。别改构建产物 main.js
 * ——每次构建重新渲染必被覆盖。冷启动（进程被杀）才靠这段，game.restart() 同进程重启不还原也能跑，
 * 所以漏了很难当场发现。样例 apps/demo/build-templates/native/index.ejs；见模块文档「native 集成步骤」。
 * **模块 bundle 不需要这段**：`AssetsManagerEx` 在 `create()` 里就会 `prependSearchPaths`，而模块此刻尚未加载。
 */
export interface CcHotUpdateOptions {
  /** 本地 project.manifest 路径（如 `${getWritablePath()}project.manifest` 或随包 url）。 */
  manifestUrl: string;
  /** base（AOT 层）下载资源的可写存储路径。默认 `${native.fileUtils.getWritablePath()}cck-remote-asset/`。 */
  storagePath?: string;
  /**
   * 模块 bundle 存储根，每个 bundle 在其下占一个子目录。
   * 默认 `${native.fileUtils.getWritablePath()}cck-bundle-asset/` —— 与 base 的 storagePath **并列而非嵌套**，
   * 否则 base 发新版时 `AssetsManagerEx` 的 `removeDirectory(_storagePath)` 会顺手抹掉所有模块的下载。
   */
  bundleStorageRoot?: string;
  /** apply 后持久化搜索路径的 localStorage 键；原生 main.js 启动还原须读同一键。默认 `'HotUpdateSearchPaths'`（对齐官方模板）。 */
  searchPathsKey?: string;
  /**
   * 更新戳 sidecar 文件名（相对远程 packageUrl，由 tools 的 `cck-manifest stamp` 产出）。
   * 设置后 check() 发现新版本时拉取它，把 `coreApiHash`/`minAppVersion` 并进 `UpdateInfo` → **激活版本闸**
   * （否则远端无这俩字段，闸单边缺失恒放行）。默认不拉。见 [[compat-stamp]] / hotupdate-service.md。
   */
  compatFilename?: string;
}

/**
 * 拉更新戳 sidecar（XMLHttpRequest，native jsb / web 皆有）。非 2xx / 解析失败 / 无 XHR → reject，
 * 由调用方降级为「无兼容字段」（闸放行，不因 sidecar 缺失阻断正常热更）。
 */
function fetchCompat(url: string): Promise<{ minAppVersion?: string; coreApiHash?: string }> {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new Error('XMLHttpRequest 不可用'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 5000;
    xhr.onload = (): void => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(e as Error);
        }
      } else {
        reject(new Error(`compat sidecar HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = (): void => reject(new Error('compat sidecar 网络错误'));
    xhr.ontimeout = (): void => reject(new Error('compat sidecar 超时'));
    xhr.send();
  });
}

/**
 * 造一个更新目标的后端。`persistKey` 为 undefined 时 apply 不写 localStorage——
 * 模块 bundle 不需要冷启动还原（`AssetsManagerEx` 在 `create()` 时就会 `prependSearchPaths`，
 * 而模块此刻尚未加载），没必要让每次冷启动都还原一堆玩家从没打开过的模块路径。
 */
function createBackend(
  manifestUrl: string,
  storagePath: string,
  persistKey: string | undefined,
  compatFilename: string | undefined,
): IHotUpdateBackend {
  const am = native.AssetsManager.create(manifestUrl, storagePath);

  // AssetsManager 只有单个事件回调；check 与 download 各自把当前分派器挂到 handler，用完即卸。
  let handler: ((ev: native.EventAssetsManager) => void) | undefined;
  am.setEventCallback((ev) => handler?.(ev));

  return {
    check(): Promise<CheckResult> {
      const E = native.EventAssetsManager;
      return new Promise<CheckResult>((resolve, reject) => {
        handler = (ev): void => {
          switch (ev.getEventCode()) {
            case E.ALREADY_UP_TO_DATE:
              handler = undefined;
              resolve({ status: 'up-to-date' });
              break;
            case E.NEW_VERSION_FOUND: {
              handler = undefined;
              const info: UpdateInfo = {
                version: am.getRemoteManifest().getVersion(),
                totalBytes: am.getTotalBytes(),
              };
              // 有 compatFilename → 拉更新戳 sidecar 把 coreApiHash/minAppVersion 并进 info（激活闸）；
              // 拉不到就用裸 info（闸放行），不因兼容戳缺失阻断正常热更。
              if (compatFilename) {
                const url = am.getRemoteManifest().getPackageUrl() + compatFilename;
                fetchCompat(url).then(
                  (c) =>
                    resolve({
                      status: 'new-version',
                      info: { ...info, minAppVersion: c.minAppVersion, coreApiHash: c.coreApiHash },
                    }),
                  () => resolve({ status: 'new-version', info }),
                );
              } else {
                resolve({ status: 'new-version', info });
              }
              break;
            }
            case E.ERROR_NO_LOCAL_MANIFEST:
            case E.ERROR_DOWNLOAD_MANIFEST:
            case E.ERROR_PARSE_MANIFEST:
              handler = undefined;
              reject(new Error(`热更检查失败: ${ev.getMessage()}`));
              break;
            // 其余事件（进度等）check 阶段无意义，忽略
          }
        };
        am.checkUpdate();
      });
    },

    download(onProgress: (p: HotUpdateProgress) => void): Promise<void> {
      const E = native.EventAssetsManager;
      return new Promise<void>((resolve, reject) => {
        handler = (ev): void => {
          switch (ev.getEventCode()) {
            case E.UPDATE_PROGRESSION:
              onProgress({
                bytesDone: ev.getDownloadedBytes(),
                bytesTotal: ev.getTotalBytes(),
                filesDone: ev.getDownloadedFiles(),
                filesTotal: ev.getTotalFiles(),
              });
              break;
            case E.UPDATE_FINISHED:
              handler = undefined;
              resolve();
              break;
            case E.UPDATE_FAILED:
            case E.ERROR_UPDATING:
            case E.ERROR_DECOMPRESS:
              handler = undefined;
              reject(new Error(`热更下载失败: ${ev.getMessage()}`));
              break;
          }
        };
        am.update();
      });
    },

    apply(): Promise<void> {
      // **新路径此刻已经生效了**——`AssetsManagerEx::updateSucceed()` 在派发 UPDATE_FINISHED 之前
      // 就 `setManifestRoot(_storagePath) → prepareLocalManifest() → prependSearchPaths()` 前插过了。
      // 这里只做两件事：
      //   1. 归一化。曾经这里再 unshift 一次，真机 localStorage 里因此留下重复条目（同一路径两份）。
      //   2. 持久化（仅 base）。冷启动时 main.js 先于引擎读同一 key 还原，模块不需要（见 createBackend 注释）。
      // `setSearchPaths` 不能省：它顺带清 FileUtils 的 fullPath 缓存，而 `prependSearchPaths` 在路径
      // 已存在时不会调它 —— 同一 bundle 第二次更新若删掉了某文件，旧解析结果就会一直缓存着。
      const searchPaths = normalizeSearchPaths(native.fileUtils.getSearchPaths());
      native.fileUtils.setSearchPaths(searchPaths);
      if (persistKey) sys.localStorage.setItem(persistKey, JSON.stringify(searchPaths));
      return Promise.resolve();
    },

    restart(): void {
      void game.restart();
    },
  };
}

/** base（AOT 层）后端：整包 `project.manifest`，apply 持久化搜索路径供冷启动还原。 */
export function createCcHotUpdateBackend(opts: CcHotUpdateOptions): IHotUpdateBackend {
  return createBackend(
    opts.manifestUrl,
    opts.storagePath ?? `${native.fileUtils.getWritablePath()}cck-remote-asset/`,
    opts.searchPathsKey ?? 'HotUpdateSearchPaths',
    opts.compatFilename,
  );
}

/** 模块 bundle 存储根：显式给了用给的，否则默认与 base 的 storagePath 并列。 */
function bundleRoot(opts: Pick<CcHotUpdateOptions, 'bundleStorageRoot'>): string {
  return opts.bundleStorageRoot ?? `${native.fileUtils.getWritablePath()}cck-bundle-asset/`;
}

/**
 * 分包后端工厂：按 bundle 名解析 `<bundle>.manifest`（tools `cck-manifest --split` 的产物）
 * 与独立 storagePath。模块 bundle 加载前更新，**免重启也免启动还原**。
 */
export function createCcBundleBackendFactory(opts: CcHotUpdateOptions): HotUpdateBackendFactory {
  const root = bundleRoot(opts);
  return (bundle) =>
    createBackend(bundleManifestName(bundle), bundleStoragePath(root, bundle), undefined, opts.compatFilename);
}

/**
 * 回收已下线 bundle 的下载目录，返回实际删掉的路径。**启动时调一次即可**（在任何
 * `bundleMgr.load()` 之前）。非原生 / 存储根还不存在 → 返回空数组。
 *
 * `keep` = 当前版本还在发的 bundle 名单，由 app 给——native 这边没有权威来源可查：包内
 * `assets/` 下有哪些目录跟「远端还发不发」是两回事，删错了下次 load 只能退回包内旧版本。
 * 单个 bundle 的旧文件不用管，`AssetsManagerEx::updateSucceed` 按 diff 删；这里只管整包下线。
 */
export function pruneCcBundleStorage(
  keep: readonly string[],
  opts?: Pick<CcHotUpdateOptions, 'bundleStorageRoot'>,
): string[] {
  if (!sys.isNative) return [];
  const root = bundleRoot(opts ?? {});
  if (!native.fileUtils.isDirectoryExist(root)) return [];
  const removed: string[] = [];
  for (const dir of retiredBundleDirs(native.fileUtils.listFiles(root), keep)) {
    if (native.fileUtils.removeDirectory(dir)) removed.push(dir);
  }
  return removed;
}

/**
 * KitModule：仅原生平台注册 `HOTUPDATE_BACKEND`（base 整包）+ `HOTUPDATE_BACKEND_FACTORY`（分包）。
 * web / 预览下 `sys.isNative === false` → no-op，core 回退空后端（恒 up-to-date）、BundleUpdater 恒 no-op，
 * 保证预览不崩。
 */
export function ccHotUpdateModule(opts: CcHotUpdateOptions): KitModule {
  return {
    name: 'hotupdate-backend',
    install(ctx) {
      if (!sys.isNative) return;
      if (!ctx.container.hasLocal(HOTUPDATE_BACKEND)) {
        ctx.container.register(HOTUPDATE_BACKEND, { useValue: createCcHotUpdateBackend(opts) });
      }
      if (!ctx.container.hasLocal(HOTUPDATE_BACKEND_FACTORY)) {
        ctx.container.register(HOTUPDATE_BACKEND_FACTORY, { useValue: createCcBundleBackendFactory(opts) });
      }
    },
  };
}
