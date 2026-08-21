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
  aotQuarantined,
  aotQuarantineVerdict,
  aotStamp,
  bundleManifestName,
  bundleStoragePath,
  bundleVersionName,
  manifestAssetKeys,
  manifestVersion,
  normalizeSearchPaths,
  packagedAotEntry,
  rebaseManifest,
  retiredBundleDirs,
  searchPathsWithout,
  seedBundleManifest,
} from './hotupdate-paths';

/**
 * AOT 启动看门狗的两个 localStorage 键 —— **与 `build-templates/native/index.ejs` 里的字面量
 * 逐字一致**，改一处必须改两处（`main.js` 跑在 SystemJS 之前，import 不到这里的常量）。
 *
 * - `AOT_TRY_KEY`：`main.js` 每次「决定用热更 AOT」就 +1，本文件的
 *   {@link resetCcHotUpdateOnAppChange} 跑到就清 0 —— 那是「这套 AOT 确实起得来」的握手。
 * - `AOT_BAD_KEY`：被隔离的那一版内容版本号，由 {@link resetCcHotUpdateOnAppChange} 在删缓存**之前**
 *   从那份缓存 manifest 里读出来写入（`main.js` 里做不了：storagePath 是可配项，那边只够得着硬编码键）。
 *   base 的 `check()` 见到同号直接当 up-to-date，否则「隔离 → 重下同一版 → 又隔离」会三步一轮地振荡；
 *   见到别的号说明发布方已翻篇，顺手清掉。**只对 base 生效**，判据是 `persistKey` 而不是 `seed` ——
 *   分包与 base 共用同一个版本号，拿它挡分包会误伤一批（见 {@link aotQuarantineVerdict}）。
 */
const AOT_TRY_KEY = 'cck.aotTry';
const AOT_BAD_KEY = 'cck.aotBadVersion';

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
   * 设置后 check() 发现新版本时拉取它，把 `coreApiHash`/`engineHash`/`minAppVersion` 并进 `UpdateInfo` → **激活版本闸**
   * （否则远端无这俩字段，闸单边缺失恒放行）。默认不拉。见 [[compat-stamp]] / hotupdate-service.md。
   */
  compatFilename?: string;
  /**
   * 内容 CDN 基址，**服务端下发**（dispatcher 握手的 `cdn_url`），**base 与分包共用**。
   * **惰性取**：握手之后才有值，而本模块在 kit 装配期就安装了；`check()` 跑在启动序列的
   * `hotupdate` 步（`dispatch` 之后），那时必然已经到手。
   *
   * 给了它，**内容托管在哪就完全由服务端说了算**：换 CDN、灰度分流、把内容挪去另一个域名，
   * 都只改服务端配置，不必发新包。做法是自取 remote manifest 再改基址灌回引擎，见 {@link startCheck}。
   *
   * 返回空 / 不给 / 拉不到 → 退回包内 manifest 里烘的地址（出包时 `cck-manifest --url` 写的那个）。
   * 退回只是兜底，**不是**「服务端配错了也能跑」——配错时日志里能看见走的是哪条路。
   */
  cdnUrl?: () => string | undefined;
}

/** GET 一段文本（XMLHttpRequest，native jsb / web 皆有）。非 2xx / 无 XHR / 网络错 / 超时 → reject。 */
function fetchText(url: string, what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new Error(`${what}: XMLHttpRequest 不可用`));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 5000;
    xhr.onload = (): void => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error(`${what} HTTP ${xhr.status}`));
    };
    xhr.onerror = (): void => reject(new Error(`${what} 网络错误`));
    xhr.ontimeout = (): void => reject(new Error(`${what} 超时`));
    xhr.send();
  });
}

/**
 * 拉更新戳 sidecar。非 2xx / 解析失败 / 无 XHR → reject，由调用方降级为「无兼容字段」
 * （闸放行，不因 sidecar 缺失阻断正常热更）。
 */
function fetchCompat(url: string): Promise<{ minAppVersion?: string; coreApiHash?: string; engineHash?: string }> {
  return fetchText(url, 'compat sidecar').then(
    (t) => JSON.parse(t) as { minAppVersion?: string; coreApiHash?: string; engineHash?: string },
  );
}

/** 自取 remote manifest 所需的三件套；不给就走引擎自己那套（用 local manifest 里烘的地址查更新）。 */
interface RemoteSource {
  /** 内容基址，**服务端下发**（惰性取——握手比装配晚）。返回空 → 退回引擎默认路径。 */
  cdnUrl: () => string | undefined;
  manifestName: string;
  versionName: string;
}

/**
 * 发起一次检查。有服务端下发的基址就**自己把 remote manifest 拉下来、改掉基址、灌回引擎**；
 * 否则退回 `checkUpdate()`（引擎按 local manifest 里烘的地址自己去查）。
 *
 * 灌 remote 而非 local，是因为下载基址只认 remote（`AssetsManagerEx.cpp:738`，全文件唯一一处
 * `getPackageUrl`）；local 那份只负责提供 diff 用的 asset 表，一个字节都不用动。见
 * {@link rebaseManifest}。`loadRemoteManifest` 成功后会自行派发
 * `NEW_VERSION_FOUND` / `ALREADY_UP_TO_DATE`，与 `checkUpdate()` 的产物等价 —— 所以事件处理那段
 * 两条路共用，`update()` 也一步不用改（`NEED_UPDATE` 且 remote 已 loaded → 直接 `startUpdate`）。
 *
 * **任何一步不成都退回老路**：拉不到（CDN 挂了）、拉回来不是 JSON（**路由错时会回 200 + 一坨
 * SPA HTML**，见 ADR-0006 修正）、引擎不收（状态不对）。退回意味着用包内烘的地址试一次，
 * 比直接判失败强；日志留一行，否则「为什么走的是老地址」无从查起。
 */
function startCheck(
  am: native.AssetsManager,
  remote: RemoteSource | undefined,
  storagePath: string,
): void {
  const cdn = remote?.cdnUrl();
  if (!remote || !cdn) {
    am.checkUpdate();
    return;
  }
  const url = cdn + remote.manifestName;
  fetchText(url, `remote manifest ${url}`)
    .then((text) => {
      const content = rebaseManifest(text, cdn, remote.manifestName, remote.versionName);
      if (!am.loadRemoteManifest(new native.Manifest(content, storagePath))) {
        throw new Error('loadRemoteManifest 拒收（状态已越过 UNCHECKED？）');
      }
      console.log(`[cck] ${remote.manifestName} 基址取服务端下发：${cdn}`);
    })
    .catch((e: unknown) => {
      console.warn(`[cck] 自取 ${url} 失败，退回包内烘的基址：${(e as Error).message}`);
      am.checkUpdate();
    });
}

/**
 * 本地 manifest 的 asset key 列表 —— 缓存那份（`AssetsManagerEx` 更新成功后落的
 * `<storagePath>/project.manifest`，`MANIFEST_FILENAME` 是宏，base 与每个 bundle 都叫这个名）
 * 优先，没有就读包内那份。供 core 反推「该加载哪个 md5」（`bundleVersionFromAssetKeys`）。
 *
 * 读不到 / 不是 JSON → 返回空数组，由 core 回落到别的版本来源（解析那半在
 * {@link manifestAssetKeys}，按 ADR-0002「能算清的先挪到纯函数里测掉」）。
 */
function readAssetKeys(storagePath: string, packagedName: string): readonly string[] {
  const cached = `${storagePath}project.manifest`;
  // 裸文件名走 fileUtils 搜索路径 → 命中包内那份（缓存那份在 storagePath 下叫 project.manifest，
  // 名字不同，不会被裸名误命中）。
  const file = native.fileUtils.isFileExist(cached) ? cached : packagedName;
  if (!native.fileUtils.isFileExist(file)) return [];
  const keys = manifestAssetKeys(native.fileUtils.getStringFromFile(file));
  if (keys.length === 0) console.warn(`[cck] ${file} 里没读到 assets，版本回落包内 bundleVers`);
  return keys;
}

/** 一个更新目标（base 或某个 bundle）的全部装配参数。 */
interface BackendSpec {
  /** 本地 manifest 路径；`seed` 给了则忽略。 */
  manifestUrl: string;
  storagePath: string;
  /** 给了才在 apply 后写 localStorage 供冷启动还原（仅 base）。 */
  persistKey?: string;
  compatFilename?: string;
  /** 内存 local manifest；见 {@link seedBundleManifest}。 */
  seed?: string;
  /** 自取 remote manifest 的来源；不给则由引擎按 local manifest 里的地址自己查。 */
  remote?: RemoteSource;
}

/**
 * 造一个更新目标的后端。`persistKey` 不给时 apply 不写 localStorage——
 * 模块 bundle 不需要冷启动还原（`AssetsManagerEx` 在 `create()` 时就会 `prependSearchPaths`，
 * 而模块此刻尚未加载），没必要让每次冷启动都还原一堆玩家从没打开过的模块路径。
 *
 * `seed` 给了就走**内存 local manifest**（`manifestUrl` 忽略）：`AssetsManagerEx::init` 只在
 * manifestUrl 非空时才去加载文件，传空串跳过它、状态停在 `UNINITED`，正好过 `loadLocalManifest`
 * 对象重载那道 `_updateState > UNINITED` 的门。见 {@link seedBundleManifest}。
 */
function createBackend(spec: BackendSpec): IHotUpdateBackend {
  const { manifestUrl, storagePath, persistKey, compatFilename, seed, remote } = spec;
  const am = native.AssetsManager.create(seed === undefined ? manifestUrl : '', storagePath);
  // ⚠️ **别注入 `setVersionCompareHandle`**（比如「不等即更新」，为了让回滚——版本号回退——
  // 能触发下载）。同一个 handle 还服务另一处完全不同的语义：`loadLocalManifest` 用
  // `versionGreater(cached, handle) > 0` 判断「包内 manifest 比缓存新 → `removeDirectory`
  // 清掉旧热更缓存」（`AssetsManagerEx.cpp:213/287`）。一个恒不返回正数的 handle 会让
  // **新装的 APK 永远被上一版的热更缓存盖住**，比它要修的回滚问题严重得多。
  // 回滚的正解是发布侧约定「版本号只增」：把旧 manifest 的 version 改成一个更大的号再发
  // （内容仍指向旧 md5 文件，内容寻址下它们还躺在 CDN 上）。见 tools 的 `rollback` 子命令。
  if (seed !== undefined) am.loadLocalManifest(new native.Manifest(seed, storagePath), storagePath);

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
              const version = am.getRemoteManifest().getVersion();
              // 被看门狗隔离过的那一版：**不再下载**。判「是不是 base」只能看 `persistKey`——
              // 随包发的分包也没有 `seed`，拿它当判据会把分包一起拦死。见 aotQuarantineVerdict。
              const verdict = aotQuarantineVerdict(
                persistKey !== undefined,
                version,
                sys.localStorage.getItem(AOT_BAD_KEY),
              );
              if (verdict === 'skip') {
                console.warn(`[cck] ${version} 起不来被隔离过 → 跳过这一版，等发布方发新号`);
                resolve({ status: 'up-to-date' });
                break;
              }
              // 发布方已经翻篇了 → 隔离结论作废，别让这个标记留一辈子。
              if (verdict === 'clear') sys.localStorage.removeItem(AOT_BAD_KEY);
              const info: UpdateInfo = {
                version,
                totalBytes: am.getTotalBytes(),
              };
              // 有 compatFilename → 拉更新戳 sidecar 把 coreApiHash/engineHash/minAppVersion 并进 info（激活闸）；
              // 拉不到就用裸 info（闸放行），不因兼容戳缺失阻断正常热更。
              if (compatFilename) {
                const url = am.getRemoteManifest().getPackageUrl() + compatFilename;
                fetchCompat(url).then(
                  (c) =>
                    resolve({
                      status: 'new-version',
                      info: {
                        ...info,
                        minAppVersion: c.minAppVersion,
                        coreApiHash: c.coreApiHash,
                        engineHash: c.engineHash,
                      },
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
        startCheck(am, remote, storagePath);
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

    assetKeys: () => readAssetKeys(storagePath, manifestUrl),
  };
}

/** base（AOT 层）后端：整包 `project.manifest`，apply 持久化搜索路径供冷启动还原。 */
export function createCcHotUpdateBackend(opts: CcHotUpdateOptions): IHotUpdateBackend {
  return createBackend({
    manifestUrl: opts.manifestUrl,
    storagePath: opts.storagePath ?? `${native.fileUtils.getWritablePath()}cck-remote-asset/`,
    persistKey: opts.searchPathsKey ?? 'HotUpdateSearchPaths',
    compatFilename: opts.compatFilename,
    remote: opts.cdnUrl && {
      cdnUrl: opts.cdnUrl,
      // base 那对固定名（`cck-manifest --split` 的默认产物名，与分包的 `<name>.manifest` 并列同根）
      manifestName: 'project.manifest',
      versionName: 'version.manifest',
    },
  });
}

/** 模块 bundle 存储根：显式给了用给的，否则默认与 base 的 storagePath 并列。 */
function bundleRoot(opts: Pick<CcHotUpdateOptions, 'bundleStorageRoot'>): string {
  return opts.bundleStorageRoot ?? `${native.fileUtils.getWritablePath()}cck-bundle-asset/`;
}

/**
 * base manifest 的 `packageUrl` —— 服务端没下发 `cdn_url` 时的兜底基址。
 *
 * `cck-manifest --split` 一次出 base + 所有分包、一个 outDir 一个 packageUrl，分包 manifest 本来就
 * 与 `project.manifest` 躺在同一个根下，所以这个地址对得上。base 更新过之后，裸文件名会沿搜索路径
 * 命中 `<baseStorage>/project.manifest`（`AssetsManagerEx` 落的缓存），拿到的是**最新**基址。
 *
 * 但它是**出包时烘进去的**：内容真挪了地方，只有服务端下发能救，靠它就得发新包。所以是兜底不是首选。
 */
function basePackageUrl(manifestUrl: string): string {
  const m = new native.Manifest(manifestUrl);
  return m.isLoaded() ? m.getPackageUrl() : '';
}

/**
 * 分包后端工厂：按 bundle 名解析 `<bundle>.manifest`（tools `cck-manifest --split` 的产物）
 * 与独立 storagePath。模块 bundle 加载前更新，**免重启也免启动还原**。
 *
 * 两条引导路，差别只在 local manifest 从哪来：
 *
 * - **包内有** `<bundle>.manifest`（随包发过的 bundle）→ 用包内那份。它的 asset 表就是 diff 基准，
 *   更新只下真变了的文件。**这是常态，别为省那几 KB 把 manifest 排除出包**。
 * - **包内没有**（热更新增的马甲皮 / 新模块，从没随包发过）→ 现造种子（空 asset 表 → 首次全量下），
 *   基址**优先用服务端下发的 `cdnUrl`**，没下发才回落 base 的 `packageUrl`。两者都拿不到
 *   就抛，由 `BundleUpdater` 记日志降级成「不更新」。
 */
export function createCcBundleBackendFactory(opts: CcHotUpdateOptions): HotUpdateBackendFactory {
  const root = bundleRoot(opts);
  let seedBase: string | undefined; // 惰性 + 记忆：只有走种子那条路才需要读 base manifest
  return (bundle) => {
    const name = bundleManifestName(bundle);
    const storagePath = bundleStoragePath(root, bundle);
    const remote = opts.cdnUrl && {
      cdnUrl: opts.cdnUrl,
      manifestName: name,
      versionName: bundleVersionName(bundle),
    };
    // 裸文件名走 fileUtils 搜索路径 → 命中的是包内那份（`<bundle>.manifest` 躺在构建产物 data/ 根、
    // 不在 src|assets|jsb-adapter 里，所以它不进任何 manifest 的 asset 表，热更也带不来它）。
    if (native.fileUtils.isFileExist(name)) {
      return createBackend({ manifestUrl: name, storagePath, compatFilename: opts.compatFilename, remote });
    }
    if (seedBase === undefined) {
      const sent = opts.cdnUrl?.();
      seedBase = sent || basePackageUrl(opts.manifestUrl);
      // 配错时下载会 404，这行是唯一能看出「用的是哪个基址」的地方 —— 别去掉。
      console.log(`[cck] 种子 manifest 基址：${seedBase || '(空)'}（${sent ? '服务端下发' : '回落 base packageUrl'}）`);
    }
    if (!seedBase) throw new Error(`bundle '${bundle}' 包内无 ${name}，且取不到基址造种子 manifest`);
    return createBackend({
      manifestUrl: name,
      storagePath,
      compatFilename: opts.compatFilename,
      seed: seedBundleManifest(seedBase, bundle),
      remote,
    });
  };
}

/**
 * **包内 AOT 与缓存对不上就把热更缓存整个作废**，返回删掉的目录（不需要作废 / 非原生 → 空数组）。
 * 两种触发：**APK 换了**（见下）与 **AOT 被启动看门狗隔离**（{@link aotQuarantined}，见文末）。
 *
 * 顺带无条件做一件事：**清掉看门狗计数**。跑到这个函数 = 这套 AOT 加载成功、cc 初始化完、
 * 场景在跑 —— 那正是「起得来」的握手，与作废不作废无关。
 *
 * ## 为什么需要它
 *
 * 覆盖安装、降级安装、换渠道包之后，设备上还躺着上一版 APK 攒下的热更内容。引擎自己有一道
 * 防线——`loadLocalManifest` 用 `versionGreater(cached)` 比「包内 manifest」与「缓存 manifest」，
 * 包内更新就 `removeDirectory(storagePath)`。但它**只在版本号纪律成立时有效**：
 *
 * - 用户装了**更旧**的包（应用商店回滚、手动装历史 apk）→ 包内版本号更小 → **缓存接管** →
 *   旧 AOT 配着为新 AOT 编译的模块代码跑；
 * - `--prev` 指错目录、或出包时压根没跑 `--manifest` → 包内号可能低于线上。
 *
 * 而 `coreApiHash` 闸救不了这一场：缓存接管后 `check()` 判 `ALREADY_UP_TO_DATE`（缓存 = 远端），
 * 根本不会去拉更新戳 sidecar，闸不跑。表现就是「装完新包启动报错」，且清数据才好得了。
 *
 * ## 判据与时机
 *
 * 判据是**包内 AOT 入口的 md5**（见 {@link aotStamp}）。**必须在 kit 装配之前调**——`AssetsManagerEx`
 * 在 `create()` 里就会 `prependSearchPaths`，晚了就是在删一个已经挂进搜索链的目录。
 *
 * ⚠️ 判据取的是 `main.js` 烘进来的那个名字，**不是**运行时的 `settings.bundleVers` —— AOT 现在
 * 可热更，后者每更新一次就翻一次，会把刚下好的缓存当成「上一版 APK 的」删掉，死循环。
 *
 * ⚠️ 产物没开 `md5Cache` 时入口就叫 `application.js`、抠不出 md5 → 判不了 → **原样不动**
 * （不是「当作换了」，那会让每次冷启动都全量重下）。
 *
 * ## 第二种触发：AOT 被看门狗隔离
 *
 * 隔离态下 `main.js` 已经不还原搜索路径、直接跑包内 AOT 了，但缓存目录还躺在磁盘上 ——
 * 而 `AssetsManagerEx.create()` 会把 storagePath 重新前插回搜索链。所以这里必须**真删**，
 * 否则就是包内 AOT 配着缓存里的新模块跑，正是本函数要消灭的那种组合。
 *
 * 删之前先把那份缓存 manifest 的 `version` 记进 `cck.aotBadVersion`：下一轮 base check() 见到同号
 * 就不再下，否则「隔离 → 重下同一版 → 又隔离」三步一轮地振荡。APK 换了则相反 —— 一整套新东西，
 * 旧的隔离结论跟着作废，清掉标记。见 ADR-0018。
 */
export function resetCcHotUpdateOnAppChange(
  opts?: Pick<CcHotUpdateOptions, 'storagePath' | 'bundleStorageRoot' | 'searchPathsKey'> & {
    /** 记上一次 AOT 指纹的 localStorage 键。默认 `'cck.aotStamp'`。 */
    stampKey?: string;
  },
): string[] {
  if (!sys.isNative) return [];
  // **跑到这一行 = 这套 AOT 确实起得来**（加载成功、cc 初始化完、场景在跑）—— 看门狗要的握手
  // 就是这个，所以无条件清计数，与下面作废不作废无关。
  sys.localStorage.removeItem(AOT_TRY_KEY);
  const key = opts?.stampKey ?? 'cck.aotStamp';
  const stamp = aotStamp(packagedAotEntry());
  // `stamp === undefined` = 判不了（没开 md5Cache / 老模板）→ 不算「换了」，否则每次冷启动全量重下。
  const appChanged = stamp !== undefined && sys.localStorage.getItem(key) !== stamp;
  // 隔离态下 `main.js` 已经不还原搜索路径了，但缓存目录还躺在磁盘上 —— 而 `AssetsManagerEx.create()`
  // 会把 storagePath 重新前插回去。所以这里必须真删，否则包内 AOT 配着缓存里的新模块跑。
  const quarantined = aotQuarantined();
  if (!appChanged && !quarantined) return [];

  const base = opts?.storagePath ?? `${native.fileUtils.getWritablePath()}cck-remote-asset/`;
  const root = bundleRoot(opts ?? {});
  const removed: string[] = [];
  // 记下「哪一版起不来」**必须赶在删目录之前**：版本号就写在那份缓存 manifest 里。
  // 这一步放这儿而不是 main.js 里，是因为 storagePath 是可配项（`CcHotUpdateOptions.storagePath`），
  // 而 main.js 只够得着硬编码的键；配了别的路径就会读空 → 拦不住重下 → 三步一轮振荡。
  if (quarantined) {
    const bad = manifestVersion(native.fileUtils.getStringFromFile(`${base}project.manifest`));
    if (bad) sys.localStorage.setItem(AOT_BAD_KEY, bad);
    else console.warn('[cck] 隔离时读不出缓存 manifest 的版本号 → 拦不住重下，可能反复隔离');
  }
  // `<dir>_temp` 是 AssetsManagerEx 的断点续传目录，与 storagePath **平级**（不在它下面），
  // 所以要单独删——留着会让下一轮更新从一个属于旧 APK 的半成品接着续。
  for (const d of [base, root, `${base.replace(/\/$/, '')}_temp/`]) {
    if (native.fileUtils.isDirectoryExist(d) && native.fileUtils.removeDirectory(d)) removed.push(d);
  }
  native.fileUtils.setSearchPaths(searchPathsWithout(native.fileUtils.getSearchPaths(), [base, root]));
  sys.localStorage.removeItem(opts?.searchPathsKey ?? 'HotUpdateSearchPaths');
  if (stamp !== undefined) sys.localStorage.setItem(key, stamp);
  // 换了 APK = 换了一整套，上一版的隔离结论跟着作废（新包也许正好修好了那一版起不来的原因）。
  if (appChanged) sys.localStorage.removeItem(AOT_BAD_KEY);
  const why = appChanged ? `APK 换了（AOT ${stamp}）` : 'AOT 被看门狗隔离';
  console.log(`[cck] ${why} → 热更缓存作废：${removed.join(' ') || '(本来就没有)'}`);
  return removed;
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
