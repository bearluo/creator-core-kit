---
状态: 已实施（2026-08-05，真机 e2e PASS；决策固化为 docs/adr/0013）
日期: 2026-08-05
摘要: native 热更从「一张全局 manifest 一次性全下」改为「一 bundle 一 manifest，加载前按需更新」
何时读: 要给 native 加分包热更、或想知道 per-bundle manifest 怎么切时
依赖: packages/core/docs/modules/hotupdate-service.md, packages/core/docs/modules/bundle-manager.md, docs/adr/0006-native-android-build-and-hotupdate-e2e.md
---

# 热更分包化（native per-bundle manifest）改造提案

## 动机

现在 native 只有**一张** `project.manifest`，覆盖 `src/` + `jsb-adapter/` + `assets/` 下**所有** bundle。实测那张表 47 条里，`lobby`/`shop`/`mini-clicker`/`mini-dodge`/`fixtures-bundle` 全挤在一起，同一个版本号。后果：

- **更新时机全在启动**：`update()` 一调就把所有变更文件下完，包括玩家这辈子都不会点开的子游戏。模块一多，首启等待时间线性增长。
- **粒度全在整体**：改一个子游戏的一行代码，版本号是全局的，所有客户端都要重新走一遍 check/download 会话。
- **和 web 不对称**：web 出包 `index.<md5>.js`，`loadBundle` 时才拉那一个 bundle，天然按需。native 这边框架层拿不到同等能力。

差量下载本身没问题（`native.AssetsManager` 按 md5 逐文件比对，实测 47 条里只下了变的那 1 个）。问题是**下载会话的粒度**，不是字节数。

框架要先行，所以现在就把接缝切出来，别等模块堆到首启等不起再回头改。

## 先行调研：`AssetsManagerEx` 自己就在动 `setSearchPaths`

动手前查了 `Creator/3.8.7/.../engine/native/extensions/assets-manager/{AssetsManagerEx,Manifest}.cpp`，结论直接改掉了两条原本的设计假设。

**C++ 在两个时机自行调用 `FileUtils::setSearchPaths`：**

| 时机 | 调用链 | 插入什么 |
|---|---|---|
| `AssetsManager.create()` | `loadLocalManifest` → `prepareLocalManifest` → `Manifest::prependSearchPaths` | `_manifestRoot`（有缓存时 = storagePath） |
| 下载完成、事件派发**之前** | `updateSucceed` 第 4–5 步：`_localManifest = _remoteManifest` → `setManifestRoot(_storagePath)` → `prepareLocalManifest()` | `_storagePath` |

`updateSucceed` 第 7 步才 `dispatchUpdateEvent(UPDATE_FINISHED)`，而那正是我们 `download()` 的 resolve 点 —— **promise 兑现时搜索路径早已生效**。

由此四条：

1. **现有 `apply()` 的 `unshift(...getLocalManifest().getSearchPaths())` 是重复劳动**，实测在设备上留下重复条目（`localStorage['HotUpdateSearchPaths']` 抓到 `["…/cck-remote-asset/","…/cck-remote-asset/","@assets/",…]`，每更新一轮多一条）。`apply()` 的真正职责只剩**持久化给冷启动用**，"生效"是 C++ 干的。
2. `Manifest::getSearchPaths()` 返回 `[_manifestRoot, ...]`，**不是** manifest JSON 里的 `searchPaths` 字段 —— 我们一直生成 `"searchPaths": []` 却照样能跑，就是这个原因。
3. **`MANIFEST_FILENAME` 硬编码为 `"project.manifest"`**（`_cacheManifestPath = _storagePath + MANIFEST_FILENAME`）→ 分包**必须**一 bundle 一 storagePath，否则各实例互相覆盖缓存 manifest。
4. `loadLocalManifest(manifestUrl)` 里那段「摘掉 cached manifest 的搜索路径 → 解析包内 manifest → 恢复」是**快照式**的，同步执行且恢复整个快照 → **多 AssetsManager 实例并存安全**，不会误删彼此的路径。

**`_fullPathCache` 与 `purgeCachedEntries`。** `FileUtils` 缓存「相对文件名 → 绝对路径」（`FileUtils.cpp:665`）。`purgeCachedEntries()` 在 C++ 有（`FileUtils.h:143`）但**没有 JS 绑定**；不必改引擎，因为 `setSearchPaths()` 的第一件事就是 `_fullPathCache.clear()`（`FileUtils.cpp:723`），JS 侧 `setSearchPaths(getSearchPaths())` 即其超集。

**这次清缓存是必要的，不是保险**：`prependSearchPaths` 只在 `needChangeSearchPaths` 为真时才调 `setSearchPaths`，同一 bundle 第二次更新时 storagePath 已在表里 → 不调 → 缓存不清。原地覆盖的文件没事（路径没变），但**新版本里被删除的文件**（`updateSucceed` 会 `removeFile`）会留下指向已删路径的缓存条目，既解析不到、也不回退包内那份。所以 D6 改写后 `apply()` **必须仍然调用一次 `setSearchPaths`**，不能退化成只写 localStorage。

其余缓存层与本改造的关系：SystemJS registry + script cache（键 = 模块 id，无自动失效，属 `IBundleReloader` 的领域）；`cc.assetManager.assets`（键 = uuid，`releaseAll`/`removeBundle` 管）；`cacheManager.cachedFiles`（`gamecaches/`，键 = **远程 URL**，只服务 `downloadFile`，热更走 AssetsManager 的 C++ downloader 不经它）；`downloading = new cc.AssetManager.Cache()`（**飞行中去重**，`onSuccess`/`onError` 即 `remove`，非持久）。

**最要紧的推论：模块 bundle 不需要 `main.js` 的启动还原。** 只要在 `loadBundle` 之前 `create` 该 bundle 的 AssetsManager，C++ 的 `prependSearchPaths` 就自动把它的 storagePath 前插了。启动还原只对 base/AOT 层必需——创建 AM 的代码自己就在 `assets/main/index.js` 里，鸡生蛋。于是分包更新**不用碰 `build-templates/native/index.ejs`**。

顺带一个边角：裸文件名 `manifestUrl`（ADR-0006 决策 4）在真·首次运行时 `_manifestRoot` 取不到（`parseFile` 只在 url 含 `/` 时赋值），会前插一个**空串**条目。`FileUtils::setSearchPaths` 把空串映射成默认资源根，功能无害，但会被我们持久化进 localStorage 并每次冷启动还原 —— 持久化时一并滤掉。

## 已否决方案：native 也开 md5（对齐 web）

web 靠文件名带 md5 天然避开所有「同名不同内容」的陈旧问题，native 能不能照搬？跑了一次 `md5Cache: true` 的 android 构建（`build/android-md5/`）实测：

- **不带 md5**：`main.js`、`jsb-adapter/{web,engine}-adapter.js` —— 恰好就是 C++ 硬编码的那几个（`BaseGame.cpp:93-94`）。`handleTemplateMd5Link: true` 改写的是**模板里的引用**，不是模板文件名。所以「main.js 也会带 md5」这个担心不成立。
- **带 md5**：`application.<md5>.js`、`src/system.bundle.<md5>.js`、`src/{import-map,settings}.<md5>.json`、`src/cocos-js/cc.<md5>.js`、`assets/<bundle>/index.<md5>.js`。

**真正的门槛是引用链**：

```
main.js                       ← L0，C++ 按固定名读包内那份，结构性不可热更
 └→ application.<md5>.js      ← md5 名硬写在 main.js 里
     └→ settings.<md5>.json   ← md5 名硬写在 application.js 里
         └→ bundleVers {"lobby":"c7870","shop":"e0dff",…}
```

改一个子游戏 → 它的 md5 变 → `settings` 内容变 → `settings` 的 md5 变 → `application.js` 变 → `main.js` 变 → **而 `main.js` 不可热更**。一条链把「改一个模块」传导成「必须发整包」。对照：不开 md5 时 `bundleVers` 是 `{}`，链根本不存在。

绕开并非不可能（`md5CacheOptions.excludes: ['src/**']` 让 `settings` 不带 md5，运行时不吃 `bundleVers` 而由各 bundle 自己的 manifest 供版本、走已有的 `BundleManager.setVersions` 显式传），但那是独立的一次改造，且要处理 storagePath 里旧 md5 版本的堆积。

**本次不开 md5**：`_fullPathCache` 的陈旧一行 `setSearchPaths` 就够（见上文），script cache 那层归 `IBundleReloader`。md5 留作后续可选增强，不进本提案范围。

## 变更总览

| 层 | 现在 | 改后 |
|---|---|---|
| tools | 一张 `project.manifest` 覆盖全部 | `--split`：base 一张 + 每个模块 bundle 一张 `<bundle>.manifest` |
| engine | `ccHotUpdateModule` 注册**一个** `IHotUpdateBackend` | 保留它（= base 目标），另注册**按名造后端的工厂** |
| core | 一个 `HotUpdateService` | 不变；另加 `BundleUpdater`（按名缓存 service），挂进 `BundleManager.load` 前 |
| 启动流程 | 启动期一次性下全部 | 启动期只下 base（AOT，要重启），模块在 `load(name)` 前才下（免重启） |

## 目标 API

```ts
// tools —— 出包期切分
export interface SplitManifestOptions extends ManifestOptions {
  /** 归入 base（随 src/ 一起属「要重启」层）的 assets 子目录名。默认 ['main','internal','resources']。 */
  aotBundles?: readonly string[];
}
export function buildSplitManifests(opts: SplitManifestOptions): { base: Manifest; bundles: Record<string, Manifest> };
export function writeSplitManifests(opts: SplitManifestOptions & { outDir?: string }): SplitWriteResult;
// CLI: cck-manifest --root <dir> --url <u> --version <v> --split [--aot-bundles main,internal,resources]

// core —— 按名取后端的工厂接缝（engine 实现）
export type HotUpdateBackendFactory = (bundle: string) => IHotUpdateBackend;
export const HOTUPDATE_BACKEND_FACTORY: Token<HotUpdateBackendFactory>;

// core —— 加载前确保最新
export interface BundleUpdater {
  /** 加载前把该 bundle 更到最新。**永不 reject**：更新不了就退回包内版本，不许挡住加载。 */
  ensureLatest(bundle: string): Promise<void>;
}
export function createBundleUpdater(opts?: BundleUpdaterOptions): BundleUpdater;
export const BUNDLE_UPDATER: Token<BundleUpdater>;

// core —— BundleManager 多一个可选接缝
interface BundleManagerOptions { updater?: BundleUpdater; /* 默认 tryResolve(BUNDLE_UPDATER)，未注册则 no-op */ }
```

## 决策

| # | 决策 | 理由 / 否掉了什么 |
|---|---|---|
| D1 | **所有 manifest 的 asset key 一律相对 data 根**（`assets/shop/index.js`），bundle manifest 只是这张全表的子集 | 下载落盘后相对 storagePath 的目录结构必须和包内一致，搜索路径前缀一挂才解析得到。key 若相对 bundle 目录（`index.js`），引擎按 `assets/shop/index.js` 找，直接 miss |
| D2 | 切分边界 = **AOT bundle 名单**：base = `src/` + `jsb-adapter/` + `assets/{main,internal,resources}`，其余 `assets/<name>/` 各一份 | Cocos native 产物里 main/internal/resources 是主包与内置包，和 `src/` 同属 L1（换了要重启），本就该同批更新。名单可配，别写死 |
| D3 | **一 bundle 一 storagePath**（`<writable>/cck-remote-asset/<bundle>/`） | 不是取舍，是硬约束：`_cacheManifestPath = _storagePath + MANIFEST_FILENAME` 而 `MANIFEST_FILENAME` **硬编码** `"project.manifest"`，共用目录 = 各 bundle 的缓存 manifest 互相覆盖 |
| D4 | core **不给 check/update 加 bundle 参数**，改成**一 bundle 一 `HotUpdateService` 实例** | 状态机 / 版本闸 / 进度存储全复用，公开签名一个字不改，base 目标零迁移。加参数则每个方法都要处理「哪个目标的状态」，state 字段还得变成表 |
| D5 | 更新挂在 **`BundleManager.load` 之前** | 和 `setVersions` 同一条理由（见 bundle-manager.ts 的注释）：UIManager 打开界面时也会 load 它所属的 bundle，挂上层 App 必漏这条路径。所有调用点在这里汇合 |
| D6 | **`apply()` 不再 unshift，改为「读当前路径 → 去重滤空 → `setSearchPaths` → 持久化」** | C++ 已在 `updateSucceed` 里前插过（见上文调研），再插一遍就是设备上抓到的那条重复。去重用 `Array.from(new Set(...))`——**不用 `[...set]`**，Cocos 构建会把它降级成 `[].concat(set)` 塞成单元素（见 lint 硬规则）。**那次 `setSearchPaths` 不能省**：它顺带清 `_fullPathCache`，是「新版本删了某文件、旧解析结果还缓存着」的唯一解 |
| D7 | **只有 base backend 持久化搜索路径，模块 backend 不写 localStorage** | 模块靠 `create()` 时 C++ 自动前插即可（见上文推论），不必让冷启动去还原一堆玩家从没打开过的模块路径。搜索路径是每次文件查找都要线性扫的，能不进就不进 |
| D8 | `ensureLatest` **永不 reject** | 离线、CDN 挂了、版本闸拒（该发整包了）——三种情况都退回包内版本继续加载。热更失败让玩家进不去游戏，比不热更严重得多 |
| D9 | **已加载的 bundle 不在本次范围** | `ensureLatest` 只在首次 load 前跑；要给内存里跑着的 bundle 换代码得走 `IBundleReloader`（release → update → invalidate → reload），是另一条路径 |

## 测试计划

- **tools**（node 直跑，临时目录造假产物）：切分完备性（base ∪ bundles = 不切时的全表，无重叠无遗漏）/ key 相对根不变 / AOT 名单可配 / `remoteManifestUrl` 各指各的文件 / 空 bundle 目录不产空 manifest。
- **core `BundleUpdater`**（fake 工厂）：首次 load 触发 check+update / 同名并发只跑一次 / 已更新过不重复跑 / check 失败不抛且 load 继续 / `rejected` 不抛 / 无工厂注册时 no-op。
- **core `BundleManager`**：`updater.ensureLatest` 在 `source.loadBundle` **之前**被调（顺序断言）/ 已加载 bundle 再 load 不重复更新 / updater 抛异常不带崩 load。
- **engine**（cc mock）：工厂按名产出的 backend 用对了 manifestUrl/storagePath / base 的 apply 去重滤空且写 localStorage / 模块的 apply 不写 localStorage。
- **真机**：APK 冷启动 e2e 加一段——只改某个模块 bundle 的代码 → base manifest 版本不动 → 启动不下任何东西 → 点进那个模块时才下、**免重启**看到新代码；再冷启动确认仍是新代码（此时靠的是 `create()` 时 C++ 的 `prependSearchPaths`，不是 localStorage 还原）。另需回归一次 base 层热更，确认 D6 改动没打断 ADR-0006 那条已验证链路，且持久化数组里不再有重复条目。

## Open Questions

- ~~**各 bundle 的版本节奏**~~ **已实施**（2026-08-05）：走 ②「版本由内容决定」，形态是 `cck-manifest --split --prev <上次发布目录>`——逐份与上一版比对，内容全等就沿用旧 `version`，只有真改了的包才用新号。
  调研结论修正了原方案：**不能直接拿内容 hash 当版本号**。`Manifest::versionGreater` 无自定义 handle 时走 `cmpVersion`（`Manifest.cpp:57`），它先 `sscanf("%d.%d.%d.%d")`，**任一侧解析不出数字才退化成 `strcmp`**。纯 hash 若以数字开头（`03cb…`）会被吃成 `3`、与 `03aa…` 判等 → 永不更新；即便加前缀强制走 `strcmp`，字典序也不单调，而 `loadRemoteManifest` 是 `local >= remote → UP_TO_DATE`，约一半发版会被静默判成已最新。沿用旧号则版本仍单调递增，不碰这颗雷。
- ~~**模块 bundle 的旧版本清理**~~ **已实施**（2026-08-05）：`pruneCcBundleStorage(keep)`（engine），启动时对账一次删掉不在名单里的目录。名单由 app 给：native 侧查不到「远端还发不发」，包内 `assets/` 有哪些目录跟这是两回事，删错了下次 `load` 只能退回包内旧版本。真机上还发现存储根里并排躺着 `<bundle>_temp/`（`AssetsManagerEx` 的断点续传目录），归对应 bundle 管、不能单独删。

## 实施步骤

1. tools 切分（含测试）→ 产物形状先定死，后面两层照着接。
2. core：`HOTUPDATE_BACKEND_FACTORY` token + `BundleUpdater` + `BundleManager` 接缝（含测试）。
3. engine：工厂实现 + `apply()` 去重（含 cc mock 测试）。
4. demo 接线 + 真机 e2e。
5. 收尾：`hotupdate-service.md` / `bundle-manager.md` 改写为新现状，本提案标「已实施」封存，`progress.md` 更新。
6. 补两个 Open Question（见上，同日实施）：tools `--prev` 逐包版本节奏 + engine `pruneCcBundleStorage` 下线目录回收，各带单测与真机 e2e。
