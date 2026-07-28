import { game, native, sys } from 'cc';
import { HOTUPDATE_BACKEND } from '@cck/core';
import type { CheckResult, HotUpdateProgress, IHotUpdateBackend, KitModule } from '@cck/core';

/**
 * IHotUpdateBackend 的 native 实现 —— HotUpdateService 的「引擎半」薄壳：包 `native.AssetsManager`
 * （原 `jsb.AssetsManager`，Cocos 3.x 迁入 `native` 命名空间）的 checkUpdate/update/setSearchPaths/restart。
 * core 的状态机 / 版本闸 / 进度存储在 HotUpdateService，本壳只做原子的原生 IO + 事件桥接。
 *
 * **仅原生平台可用**：web / 编辑器预览下 `native.AssetsManager` 为 undefined，故 `ccHotUpdateModule` 用
 * `sys.isNative` 守门——非原生不注册，core 回退空后端（恒 up-to-date）。
 *
 * ⚠️ 集成前提（本 npm 包管不到、须在原生工程侧做）：apply() 会把新资源搜索路径写入 localStorage[searchPathsKey]，
 * 但**引擎启动前的还原**必须在原生工程的 `main.js` 里手动加（读同一 key → setSearchPaths），否则重启不生效。
 * 见模块文档「native 集成步骤」。
 */
export interface CcHotUpdateOptions {
  /** 本地 project.manifest 路径（如 `${getWritablePath()}project.manifest` 或随包 url）。 */
  manifestUrl: string;
  /** 下载资源的可写存储路径。默认 `${native.fileUtils.getWritablePath()}cck-remote-asset/`。 */
  storagePath?: string;
  /** apply 后持久化搜索路径的 localStorage 键；原生 main.js 启动还原须读同一键。默认 `'HotUpdateSearchPaths'`（对齐官方模板）。 */
  searchPathsKey?: string;
}

export function createCcHotUpdateBackend(opts: CcHotUpdateOptions): IHotUpdateBackend {
  const storagePath = opts.storagePath ?? `${native.fileUtils.getWritablePath()}cck-remote-asset/`;
  const searchPathsKey = opts.searchPathsKey ?? 'HotUpdateSearchPaths';
  const am = native.AssetsManager.create(opts.manifestUrl, storagePath);

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
            case E.NEW_VERSION_FOUND:
              handler = undefined;
              resolve({
                status: 'new-version',
                info: { version: am.getRemoteManifest().getVersion(), totalBytes: am.getTotalBytes() },
              });
              break;
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
      // 新资源搜索路径置顶 + 持久化；引擎起前的还原须由原生 main.js 读同一 key 完成（见文档）。
      const searchPaths = native.fileUtils.getSearchPaths();
      searchPaths.unshift(...am.getLocalManifest().getSearchPaths());
      sys.localStorage.setItem(searchPathsKey, JSON.stringify(searchPaths));
      native.fileUtils.setSearchPaths(searchPaths);
      return Promise.resolve();
    },

    restart(): void {
      void game.restart();
    },
  };
}

/**
 * KitModule：仅原生平台注册 `HOTUPDATE_BACKEND → native.AssetsManager 后端`。
 * web / 预览下 `sys.isNative === false` → no-op，core 回退空后端（恒 up-to-date），保证预览不崩。
 */
export function ccHotUpdateModule(opts: CcHotUpdateOptions): KitModule {
  return {
    name: 'hotupdate-backend',
    install(ctx) {
      if (!sys.isNative) return;
      if (!ctx.container.hasLocal(HOTUPDATE_BACKEND)) {
        ctx.container.register(HOTUPDATE_BACKEND, { useValue: createCcHotUpdateBackend(opts) });
      }
    },
  };
}
