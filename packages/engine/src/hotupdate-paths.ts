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
