---
状态: 已接受
日期: 2026-08-05
依赖: packages/core/docs/modules/hotupdate-service.md, packages/core/docs/modules/bundle-manager.md, packages/tools/docs/modules/hot-update-manifest.md, docs/adr/0006-native-android-build-and-hotupdate-e2e.md, docs/adr/0010-no-restart-bundle-code-swap.md, docs/design/2026-08-05-hotupdate-per-bundle-proposal.md
---

# ADR-0013：native 分包热更的落盘布局 —— 一 bundle 一 manifest 一 storagePath

## 背景

此前 native 只有**一张** `project.manifest`，覆盖 `src/` + `jsb-adapter/` + `assets/` 下所有 bundle（demo 实测 47 条里 6 个模块包全挤在一起、共用一个版本号）。差量下载本身没问题——`AssetsManagerEx` 按 md5 逐文件比对——问题是**下载会话的粒度**：`update()` 一调就把所有变更文件在启动期下完，包括玩家永远不会点开的子游戏；改一个子游戏也要所有客户端走一遍全局版本升级。web 那边 `loadBundle` 时才拉那一个 bundle，天然按需，native 拿不到同等能力。

本条固化分包后的**落盘布局**。之所以要一条 ADR：这些路径与文件名会烧进已发布客户端，改了就是让线上已下载内容全部失效。

## 决策

1. **一 bundle 一份 manifest**，文件名 `<bundle>.manifest` / `<bundle>.version.manifest`，与 base 的 `project.manifest` / `version.manifest` 并列在同一 `packageUrl` 根下。由 `cck-manifest --split` 产出。
2. **所有 manifest 的 asset key 一律相对 data 根**（`assets/shop/index.js`），bundle manifest 只是全表的一个子集，不是「相对 bundle 目录」的独立表。
3. **base 的边界 = AOT bundle 名单**：`src/` + `jsb-adapter/` + `assets/{main,internal,resources}` 归 base，其余 `assets/<name>/` 各自成包。名单可经 `--aot-bundles` 覆盖。
4. **一 bundle 一 storagePath**：`<writablePath>cck-bundle-asset/<bundle>/`，与 base 的 `<writablePath>cck-remote-asset/` **并列而非嵌套**。
5. **模块 bundle 的 `apply()` 不写 localStorage**；只有 base 写（键 `HotUpdateSearchPaths`，供 `build-templates/native/index.ejs` 冷启动还原）。
6. **更新挂在 `BundleManager.load` 之前**，经 core 的 `BundleUpdater` 接缝（`ensureLatest(bundle)`，永不 reject）。
7. **`apply()` 只做「归一化 + setSearchPaths + （base）持久化」，不再 unshift**。

## 理由

- **决策 2**：下载落盘后相对 storagePath 的目录结构必须与包内一致，搜索路径前缀一挂才解析得到。key 若相对 bundle 目录（`index.js`），引擎按 `assets/shop/index.js` 查会直接 miss。
- **决策 3**：Creator native 产物里 main/internal/resources 是主包与内置包，和 `src/` 同属「换了要重启」层（见 hotupdate-service.md 的 L0/L1/L2 三层边界），本就该跟 base 同批。
- **决策 4 不是取舍，是硬约束**：`AssetsManagerEx.cpp` 的 `_cacheManifestPath = _storagePath + MANIFEST_FILENAME`，而 `MANIFEST_FILENAME` 是**宏、硬编码为 `"project.manifest"`**——共用目录 = 各 bundle 的缓存 manifest 互相覆盖。真机实证：`cck-bundle-asset/shop/` 里那份缓存文件名确实叫 `project.manifest`，尽管远端叫 `shop.manifest`。**并列而非嵌套**是另一条：`loadLocalManifest` 在「包内 manifest 比缓存新」时会 `removeDirectory(_storagePath)` 整个清掉，嵌套会让 base 发新版顺手抹掉所有模块的下载。
- **决策 5**：`AssetsManagerEx` 在 `create()`（`prepareLocalManifest → Manifest::prependSearchPaths`）与 `updateSucceed()` 第 4–5 步都会**自行** `prependSearchPaths`，而模块 bundle 在 `create()` 时尚未加载 → 冷启动只要在 `loadBundle` 前造一次 AssetsManager 即可，无须 localStorage 还原。base 则必须还原：造 AssetsManager 的代码自己就在 `assets/main/index.js` 里，鸡生蛋。少存也少扫——搜索路径是每次文件查找都要线性扫的。
- **决策 6**：与 `BundleManager.setVersions` 同一条理由——UIManager 打开界面时也会 load 它所属的 bundle，挂上层 App 必漏那条路径。「永不 reject」是因为离线 / CDN 挂 / 版本闸拒时退回包内版本仍能玩，热更失败让玩家进不去游戏严重得多。
- **决策 7**：`updateSucceed` 第 7 步才 `dispatchUpdateEvent(UPDATE_FINISHED)`，而那正是 `download()` 的 resolve 点——**promise 兑现时搜索路径早已生效**，再 unshift 就是重复。旧实现的重复条目在真机 localStorage 里抓到过（同一路径两份，每更新一轮多一条）。保留 `setSearchPaths` 调用是必要的：它顺带 `_fullPathCache.clear()`，而 `prependSearchPaths` 在路径已存在时不会调它——同一 bundle 第二次更新若删掉了某文件，旧解析结果会一直缓存着。（C++ 有 `purgeCachedEntries()` 但**没有 JS 绑定**；`setSearchPaths` 是它的超集，不必改引擎。）

## 后果

- **正面**：模块更新按需、免重启、互不牵连；base 与模块各自独立的版本节奏成为可能；`apply()` 的重复条目 bug 一并修掉。
- **实证 PASS**（2026-08-05，真 x86_64 模拟器，干净安装）：base `check() = up-to-date`（不重启，`BUILD_TAG` 全程 v1）→ `load('shop')` 前自动更新，**只下 271 字节**那一个变更文件 → `SHOP_TAG = v2`；`am force-stop` 冷启动仍 v2；**断开托管**冷启动仍 v2（localStorage 里确无 `HotUpdateSearchPaths`，只可能来自 `create()` 时的 `prependSearchPaths`）。全程无 FATAL / native signal。
- **代价 / 约束**：
  - 决策 1/4 的路径与文件名**烧进已发布客户端**，改动等于让线上已下载内容失效。
  - `cck-manifest --split --version <v>` 目前给 base 和所有 bundle 写**同一个版本号**：只发 shop 时 lobby 的远端版本也涨 → lobby 报 `NEW_VERSION_FOUND`、下载 0 文件后 `UPDATE_FINISHED`。不算坏（md5 全一致），但每包每次发版多一次往返。逐包版本或内容派生版本留作后续（见提案 Open Questions）。
  - bundle 彻底下线时它在 `cck-bundle-asset/` 下的目录没人回收，需要一个按当前 manifest 列表对账的清理入口。
  - 决策 6 只覆盖**首次 load 之前**；给内存里跑着的 bundle 换代码仍走 [[adr-0010]] 的 `IBundleReloader`。
- **未采纳**：native 也开 md5（对齐 web）。实测 `main.js` 本身不带 md5（C++ 硬编码的那几个恰好都在排除名单里），但引用链 `main.js → application.<md5>.js → settings.<md5>.json → bundleVers` 会把「改一个模块」传导成「必须发整包」，因为 `main.js` 属 L0。详见提案「已否决方案」。
