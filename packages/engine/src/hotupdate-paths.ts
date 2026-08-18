/**
 * 热更搜索路径 / 分包路径的纯计算（零 cc，可 node 直测）。
 * 从 hotupdate-backend 拆出来，是因为 `native.AssetsManager` 这类需要真实引擎行为的 API
 * 按 ADR-0002 不许进 cc mock，那边的逻辑只能靠真机验——能算清的部分先挪到这里测掉。
 */

/**
 * 归一化搜索路径：去重 + 滤掉空串。
 *
 * - **去重**：`AssetsManagerEx` 在 `create()` 与 `updateSucceed()` 里都会自行 `prependSearchPaths`，
 *   分包后每个 bundle 一个实例、每轮更新各插一次，不去重会无界增长，而搜索路径是每次文件查找都要扫的。
 * - **滤空**：manifestUrl 传裸文件名时 `Manifest::parseFile` 取不到 `_manifestRoot`（只在 url 含 `/` 时赋值），
 *   会前插一个空串。它被 `FileUtils::setSearchPaths` 映射成默认资源根，功能无害，但会被持久化进
 *   localStorage 并每次冷启动还原。
 *
 * ⚠️ 用 `Array.from(new Set(...))` 而非 `[...set]`——Cocos 构建会把后者降级成 `[].concat(set)`，
 * 整个集合被塞成单元素（预览测不出、只在构建产物炸；见根 eslint 硬规则）。
 */
export function normalizeSearchPaths(paths: readonly string[]): string[] {
  return Array.from(new Set(paths)).filter((p) => p !== '');
}

/** 保证末尾恰好一个 `/`（空串原样返回，交给调用方兜底）。 */
function withSlash(path: string): string {
  return path === '' || path.endsWith('/') ? path : `${path}/`;
}

/**
 * 模块 bundle 的独立存储目录。**必须一 bundle 一个**：`AssetsManagerEx` 的缓存 manifest 路径写死成
 * `<storagePath>/project.manifest`（`MANIFEST_FILENAME` 是宏），共用目录会让各 bundle 互相覆盖。
 *
 * 与 base 的 storagePath **并列而非嵌套**：`loadLocalManifest` 在「包内 manifest 比缓存新」时会
 * `removeDirectory(_storagePath)` 整个清掉，嵌套会让 base 发新版顺手抹掉所有模块的下载。
 */
export function bundleStoragePath(root: string, bundle: string): string {
  return `${withSlash(root)}${bundle}/`;
}

/** 模块 bundle 的 manifest 文件名，对齐 tools 的 `cck-manifest --split` 产物。 */
export function bundleManifestName(bundle: string): string {
  return `${bundle}.manifest`;
}

/** 模块 bundle 的精简版本清单文件名（同上，`--split` 每个包出一对）。 */
export function bundleVersionName(bundle: string): string {
  return `${bundle}.version.manifest`;
}

/**
 * 造一份**内存里的种子 local manifest**（JSON 字符串），给「包内查不到 `<bundle>.manifest`」的 bundle 用。
 *
 * ## 为什么需要它
 *
 * `AssetsManagerEx` 手上有两份 manifest：**remote**（从 CDN 下的那份）与 **local**（引导用的那份）。
 * local 提供 `remoteManifestUrl`（去哪查更新）与本地资源表（拿什么做 diff）——**没有 local 连去哪查
 * 都不知道**（`ERROR_NO_LOCAL_MANIFEST`）。而 `<bundle>.manifest` 躺在构建产物 `data/` 根，不在
 * `src|assets|jsb-adapter` 这三个被遍历的目录里 → **它自己不进任何 manifest 的 asset 表、永远不会
 * 被热更下发**。于是一个从没随包发过的 bundle（热更新增的马甲皮 / 新模块），包内没有它的 manifest，
 * base 热更也带不来 —— 没有种子就永远下不到。
 *
 * 种子把这一步接上：`packageUrl` 用 dispatcher 握手下发的 `cdnUrl`，`assets` 留空 → diff 出全量 →
 * 整包下下来。代价是**首次全量**，所以随包发过的 bundle 仍旧用包内那份（增量，见调用方）。
 *
 * ⚠️ `version` 必须留 `0.0.0`：`loadLocalManifest` 会把种子与 `<storagePath>/project.manifest`
 * （上次下载落的**真** manifest）比版本，local 更新时 `removeDirectory(storagePath)` 整个清掉重下。
 * 种子恒最旧，缓存那份才能接管 → 第二次起自动变增量。
 */
export function seedBundleManifest(cdnUrl: string, bundle: string): string {
  const base = withSlash(cdnUrl);
  return JSON.stringify({
    packageUrl: base,
    remoteManifestUrl: base + bundleManifestName(bundle),
    remoteVersionUrl: base + bundleVersionName(bundle),
    version: '0.0.0',
    assets: {},
    searchPaths: [],
  });
}

/**
 * 把一份**远端** manifest 的三个地址字段改写到 `cdnUrl`，其余字段（`version` / `assets` /
 * `searchPaths`）原样保留。传进来的 `content` 必须是合法 manifest JSON，否则抛。
 *
 * ## 为什么改的是「远端」那份
 *
 * `AssetsManagerEx` 下载资源时的基址**只取 remote manifest**（`AssetsManagerEx.cpp:738`
 * `_remoteManifest->getPackageUrl()` —— 全文件唯一一处），local 那份的 `packageUrl` 仅用于
 * 决定去哪拉 remote manifest 本身。所以只要我们自己把 remote manifest 拉下来、改掉基址、经
 * `loadRemoteManifest()` 灌回去，**内容托管在哪就完全由服务端说了算**，与出包时烘进去的地址无关。
 *
 * 反过来改 local 那份走不通：`loadLocalManifest(Manifest*, storagePath)` 会拿它跟
 * `<storagePath>/project.manifest`（缓存）比版本，比输了当场被缓存整个顶掉、改动作废；比赢了又会
 * `removeDirectory(storagePath)` 清库，且 `checkUpdate` 立刻判定「已是最新」再不更新。两头都是死的。
 *
 * ⚠️ **`assets` 一个字节都不能动** —— 它是 `genDiff` 的一半输入，动了就是把增量下载变成全量。
 */
export function rebaseManifest(
  content: string,
  cdnUrl: string,
  manifestName: string,
  versionName: string,
): string {
  const m = JSON.parse(content) as Record<string, unknown>;
  const base = withSlash(cdnUrl);
  return JSON.stringify({
    ...m,
    packageUrl: base,
    remoteManifestUrl: base + manifestName,
    remoteVersionUrl: base + versionName,
  });
}

/**
 * 从 `FileUtils::listFiles(bundleStorageRoot)` 的原始输出里，挑出**已下线 bundle** 的目录（返回完整路径）。
 *
 * `listFiles` 返回的是**完整路径**、目录带尾 `/`、且含 tinydir 给的 `.` 与 `..`——这两个必须滤掉，
 * 否则会把存储根自己和它的父目录整个删了。文件（无尾 `/`）也一并跳过：只回收目录。
 *
 * `<bundle>_temp/` 归 `<bundle>` 管：`AssetsManagerEx` 在存储根**平级**建断点续传目录
 * （`_tempStoragePath` = storagePath 去尾斜杠 + `TEMP_PACKAGE_SUFFIX`），真机上确实与 `shop/` 并排躺着。
 * 不认这条就会把在用 bundle 的续传状态一起删掉，下次断点续传退化成从头下。
 *
 * `keep` = 当前这个包**还在发的** bundle 名单，由调用方给（app 自己知道有哪些模块）。
 * 空名单会清光整个根，所以调用方拿不准时别调。
 */
export function retiredBundleDirs(entries: readonly string[], keep: readonly string[]): string[] {
  const alive = new Set(keep);
  const kept = (name: string): boolean =>
    alive.has(name) || (name.endsWith('_temp') && alive.has(name.slice(0, -'_temp'.length)));
  return entries.filter((e) => {
    if (!e.endsWith('/')) return false;
    const name = e.slice(0, -1).split('/').pop() ?? '';
    if (name === '' || name === '.' || name === '..') return false;
    return !kept(name);
  });
}
