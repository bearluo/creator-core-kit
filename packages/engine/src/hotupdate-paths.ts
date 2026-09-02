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

/**
 * 从一份 manifest JSON 文本里取 asset key 列表 —— 供 core 反推「该加载哪个 md5」
 * （`bundleVersionFromAssetKeys`）。
 *
 * 只能自己 parse：`native.Manifest` 的 JS 绑定没有 `getAssets()`（`cc.d.ts:34383-34408` 只暴露了
 * isLoaded / getPackageUrl / getVersion / getSearchPaths 那几个）。
 *
 * 不是合法 manifest → 空数组，**不抛**：版本取不到只是退回「按包内 `settings.bundleVers` 加载」，
 * 而热更本身的成败早在 check/update 判过了，不该在这里再制造一次失败。
 */
export function manifestAssetKeys(content: string): readonly string[] {
  try {
    const j = JSON.parse(content) as { assets?: Record<string, unknown> };
    const a = j.assets;
    return a && typeof a === 'object' && !Array.isArray(a) ? Object.keys(a) : [];
  } catch {
    return [];
  }
}

/**
 * 从一份 manifest JSON 文本里取 `version` —— 看门狗隔离时用它记下「哪一版起不来」
 * （{@link baseQuarantineVerdict} 拿这个号拦重下）。
 *
 * 读不出来 → `undefined`，**不抛**：拦不住只是退回「隔离 → 重下 → 又隔离」的振荡，
 * 而此刻正在做的是把玩家从黑屏里捞出来，不该在这里再失败一次。
 */
export function manifestVersion(content: string): string | undefined {
  try {
    const v = (JSON.parse(content) as { version?: unknown }).version;
    return typeof v === 'string' && v !== '' ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 远端发现的这一版，要不要因为「被看门狗隔离过」而跳过。
 *
 * - `skip` —— 正是起不来的那一版，别再下了；等发布方发个新号即自动恢复。
 * - `clear` —— 发布方已经翻篇了，隔离结论作废，把标记清掉。
 * - `proceed` —— 没有隔离标记，或者根本不是 base。
 *
 * ⚠️ `isBase` 判据是 **backend 有没有 `persistKey`**（只有 base 要把搜索路径写进 localStorage 供
 * 冷启动还原），**不是**「有没有 seed」—— 随包发的分包也没有 seed。这条要是搞错，隔离的那个
 * 版本号会把**分包**一起拦住：base 与分包共用同一个 `--version`（`buildSplitManifests`），
 * 内容没变的分包在 `--prev` 下还会沿用旧号，于是一次 base 隔离能把一批分包永久钉死在包内版本。
 * 分包与包内 base 兼不兼容自有 `coreApiHash` 闸管，那正是它的活。
 */
export function baseQuarantineVerdict(
  isBase: boolean,
  version: string,
  bad: string | null | undefined,
): 'skip' | 'clear' | 'proceed' {
  if (!isBase || !bad) return 'proceed';
  return version === bad ? 'skip' : 'clear';
}

/**
 * `main.js` 启动时挂上来的**包内 base 入口名**（`build-templates/native/index.ejs` 里那句
 * `window.__cckBaseEntry = '<%= applicationJs %>'`）—— 构建期插值，**热更改不了**。
 *
 * 它与运行时真正加载的入口不是一回事：base 热更之后 `main.js` 会改从 `src/cck-base.json` 指针
 * 解析出新入口，而这个全局仍是出包那天烘进去的那个名字。正因如此它才等于「这个 APK 的身份」。
 */
export function packagedBaseEntry(): string | undefined {
  const v = (globalThis as { __cckBaseEntry?: unknown }).__cckBaseEntry;
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * 本次启动是不是被 **base 启动看门狗**隔离了 —— `main.js` 判定后挂上来的
 * （`build-templates/native/index.ejs` 里那句 `window.__cckAotQuarantined = ...`）。
 *
 * 隔离态 =「连续 N 次用热更 base 都没跑到 Bootstrap」→ 这一次跑**包内** base，连搜索路径都不还原。
 * 它兜的是 base 解锁带来的唯一一种**玩家自己救不回来**的失败：下发的 base 起不来，而作废缓存的
 * 代码在 Bootstrap 里、永远轮不到 —— 实测重启与覆盖装 APK 都无效，只有清应用数据。见 ADR-0018。
 *
 * 老模板没挂这个全局 → 恒 `false`（看门狗休眠，行为与 base 解锁前一致）。
 */
export function baseQuarantined(): boolean {
  return (globalThis as { __cckAotQuarantined?: unknown }).__cckAotQuarantined === true;
}

/**
 * APK 换了没有 —— 判据是**包内 base 入口的 md5**：`./application.56453.js` → `56453`，
 * 取自 {@link packagedBaseEntry}。
 *
 * 返回 `undefined` 表示「判不了」（产物没开 `md5Cache`，入口就叫 `application.js`；或老模板没挂
 * 这个全局）：调用方应当**什么也不做**，别把「判不了」当成「换了」而去清缓存——那会让每次冷启动
 * 都全量重下。
 *
 * ## 为什么必须取包内那份，不能取运行时的 `settings.bundleVers.main`
 *
 * base 解锁之前 `bundleVers` 是安全的：`settings` 只随 APK 换，所以它答的就是「APK 换没换」。
 * 解锁之后 `settings.<md5>.json` 本身也随热更走了，于是 `bundleVers` 答的变成「**跑的是哪一版
 * base**」——每成功热更一次 base，它就与上一轮存下的指纹不同，缓存被判成「上一版 APK 攒的」而
 * **整个删掉**，下一轮冷启动重下、再删，死循环。而 `main.js` 换不了（它自己就是那段搜索路径还原），
 * 热更够不着，烘在里面的入口名因此是唯一不可伪造的 APK 身份。
 *
 * ## 为什么不是 app 戳的 `coreApiHash`
 *
 * - **拿得到**。这一步必须跑在 kit 装配之前（`AssetsManagerEx` 一 `create` 就前插搜索路径了），
 *   而 app 戳在 `resources` bundle 里、要异步 load，那时还没到；全局是同步可取的。
 * - **口径更保守且正确**。`coreApiHash` 只描述 core 的 API 面，base 业务代码改了它不变；而热更
 *   下来的模块代码是对着**整个 base** 编译的，base 的字节变了就该重新拉一遍。
 * - 入口名随 `settings` md5 走，而 `settings` 含全部 `bundleVers` → 任何内容变动都会翻它。
 *   代价是「新出的 APK 只改了个日志文案也重下」，换来的是不会出现「新 base 配旧模块」。
 */
export function baseStamp(packagedEntry: string | null | undefined): string | undefined {
  if (typeof packagedEntry !== 'string') return undefined;
  const file = packagedEntry.split('?')[0].split('/').pop() ?? '';
  if (!file.startsWith('application.') || !file.endsWith('.js')) return undefined;
  const v = file.slice('application.'.length, -'.js'.length);
  // `application.js`（没开 md5）切出空串；多段的不是 Creator 的产物形态，一并不认。
  return v !== '' && !v.includes('.') ? v : undefined;
}

/**
 * 该清掉哪些搜索路径 —— 热更缓存目录被删之后，指向它们的搜索路径条目也必须摘掉。
 * 留着不会崩（`FileUtils` 找不到就跳过），但它们会被 `apply()` 重新持久化进 localStorage，
 * 一轮轮攒下去；而且冷启动还原时会把已删目录重新前插到搜索链最前面。
 */
export function searchPathsWithout(paths: readonly string[], prefixes: readonly string[]): string[] {
  return normalizeSearchPaths(paths).filter((p) => !prefixes.some((pre) => p.startsWith(pre)));
}

/**
 * 从 `cc` 模块的解析 URL 抠**引擎内容指纹**：`src/cocos-js/cc.25e81.js` → `25e81`。
 * 没开 `md5Cache`（名字就是 `cc.js`）或形状不认识 → `undefined`。
 */
export function engineHashFromUrl(url: string | null | undefined): string | undefined {
  if (typeof url !== 'string') return undefined;
  const file = url.split('?')[0].split('#')[0].split('/').pop() ?? '';
  if (!file.startsWith('cc.') || !file.endsWith('.js')) return undefined;
  const v = file.slice('cc.'.length, -'.js'.length);
  // `cc.js`（没开 md5）切出空串；`cc.a.b.js` 这种多段的不是 Creator 的产物形态，一并不认。
  return v !== '' && !v.includes('.') ? v : undefined;
}

/**
 * 当前**引擎内容指纹** —— 喂 core 版本闸的 `AppInfo.engineHash`，判不了返回 `undefined`（闸休眠）。
 *
 * ## 为什么是 `cc.<md5>.js` 而不是 `.so` 的 hash
 *
 * 热更只下发 JS 和资源，要挡的是「热更来的 JS 用了这个引擎没有的 API」—— 对应的正是 `cc.js`
 * 的接口面。`.so` 只在与 `cc.js` 不同步时出问题，而这两者是同一次引擎构建的两半、永远一起变
 * （实测：`cc.25e81.js` 与 `libcocos.so` 生成时间相差 5 分钟，其后三次业务重建 md5 纹丝不动）。
 * 反过来 hash `.so` 既要挑 ABI 又要区分 debug/release，还读不出「JS API 面变没变」。
 * 唯一漏网的是只改 `native/engine/` 的 C++ 而不动 JS —— 那种改动本来也只能发包。
 *
 * ## 为什么不用 `baseStamp` / `coreApiHash`
 *
 * 三个指纹管三件事，别混用：`baseStamp`（包内 base 入口 md5）答「APK 换没换」，业务代码一改就翻，
 * 敏感是它的特性；`coreApiHash` 答「core 的 API 面变没变」，换引擎时一动不动；本函数答
 * 「引擎换没换」，只在换 Creator 版本或改引擎模块勾选时变 —— 那时 `.so` 必须重编。
 *
 * ## 取值路径
 *
 * 走 SystemJS 的 import map（`main.js` `System.warmup` 时注册的那份，内容就一行
 * `"cc": "./cocos-js/cc.<md5>.js"`），不碰文件系统 —— 那份 map 属于结构性不可热更的一层，
 * 所以读到的恒是**这个包**的引擎身份，热更改不动它。
 */
export function engineHash(): string | undefined {
  const sys = (globalThis as { System?: { resolve?: (id: string) => string } }).System;
  try {
    return engineHashFromUrl(sys?.resolve?.('cc'));
  } catch {
    return undefined; // resolve 抛（没 warmup / 没这个模块）等同判不了
  }
}
