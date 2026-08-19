---
状态: 已接受（决策 6 的「永不 reject」已被 docs/adr/0015-hotupdate-failure-aborts.md 取代）
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

## 补充（2026-08-17）：决策 1 的引导缺口 —— 从没随包发过的 bundle 用内存种子 manifest

决策 1 把 `<bundle>.manifest` 与 base 并列放在 `packageUrl` 根下，客户端侧则**从包内**取它当 local manifest。
这里有个当时没看见的缺口：**`<bundle>.manifest` 躺在构建产物 `data/` 根，而 manifest 只遍历 `src|assets|jsb-adapter`
三个目录** → 它自己不进任何 manifest 的 asset 表，**永远不会被热更下发**。于是一个「发版之后才新增」的
bundle（新马甲皮、新模块）：包内没有它的 manifest，base 热更也带不来 —— `AssetsManagerEx` 连去哪查更新
都不知道（`ERROR_NO_LOCAL_MANIFEST`），这个包永远下不到。触发路径很正常：base 热更把
`settings.cck.vest` 翻成新马甲 → 重启 → 启动预载列表里的 `skin-<新马甲>-foundation` 从没随包发过。

补一条引导路，**不改任何既有落盘约定**：

8. **包内查不到 `<bundle>.manifest` 时，运行时在内存里造一份种子 local manifest**，
   `packageUrl` **取 dispatcher 握手下发的 `cdn_url`**（没下发才回落 base local manifest 的
   `packageUrl`），`assets` 留空 → diff 出全量 → 整包下下来。**`version` 恒为 `0.0.0`**。

- **基址为什么是服务端下发的 `cdn_url` 而不是包里烘的**：内容托管在哪是**运营期决定**——换 CDN、
  灰度分流、把分包挪去另一个域名，都应该只改服务端配置。包里烘的 `packageUrl` 是出包那一刻的
  快照，内容真挪了地方就只能发新包，而这恰恰是热更要消灭的事。`cdn_url` 本来就是握手协议里
  为此留的字段（[[adr-0011]]：服务端不认识 Cocos 的 manifest 也不认识 Godot 的 pck，只发一个 URL，
  各客户端框架自己解释）。**回落 base 的 `packageUrl` 只是「服务端没配」时的兜底**，不是让配错也能跑——
  配错就 404 / 下到一坨 HTML，日志里那行 `种子 manifest 基址：… （服务端下发 / 回落）` 是唯一的判据。
  ⚠️ ~~**base 自己那条路仍用包里烘的 `packageUrl`**：它的 `AssetsManagerEx` 在 kit 装配期就建好了，
  那时握手还没跑（`dispatch` 步在 `hotupdate` 之前，但两者都晚于模块安装）——鸡生蛋，暂不动。~~
  **已被下节（2026-08-18）取代**：走 `loadRemoteManifest` 就没有鸡生蛋问题，base 与分包现已统一。
- **为什么不落盘**：`native.Manifest(content, manifestRoot)` 与 `am.loadLocalManifest(manifest, storagePath)`
  两个重载 SWIG 都绑了（`tools/swig-config/extension.i` 整头 `%include`，无 ignore），内存造完直接喂。
  配套要点：`AssetsManagerEx::init` 只在 `manifestUrl` 非空时才加载文件，故 `create('', storagePath)`
  跳过它、状态停在 `UNINITED`，正好过对象重载 `_updateState > UNINITED` 那道门。
- **`version` 恒 `0.0.0` 是硬约束，不是随手取的**：`loadLocalManifest` 拿 local 与
  `<storagePath>/project.manifest`（上次下载落的真 manifest）比版本，**local 更新时会
  `removeDirectory(_storagePath)` 整个清掉**。种子必须恒最旧，缓存那份才能接管 → 第二次起自动变增量。
  这条与决策 1/4 同级：它烧进已发布客户端，改大了等于让所有靠种子下下来的包每次启动重下一遍。
- **随包发过的 bundle 仍旧用包内那份**（增量基准），种子只是缺口的兜底 —— 别为省那几 KB 把 manifest
  排除出包，那会把所有包的首次更新都变成全量。

**实证 PASS**（2026-08-17，真 x86_64 模拟器，干净安装）：APK 里**不含** `skin-vest-*`（连目录带 manifest
都没有），CDN 上 base 1.0.1 只改了 `settings.json` 的 `cck.vest`。客户端 v1 起来 `skin='base'` → base 热更
→ restart → `skin='vest'` → `shared` 步 `load('skin-vest-foundation')` → 包内无 manifest → 种子 →
`3/3 文件`下载完成 → 继续启动。`force-stop` 冷启动只发了 4 个 `*.version.manifest` 版本探测请求、
**一个资源文件都没重下**（缓存 manifest 已接管）。该轮走的是**回落**那条路（当时尚未接 `cdn_url`）。

**`cdn_url` 那条路已接通但服务端配置未就位**（2026-08-18）：客户端侧实测日志
`种子 manifest 基址：http://172.25.50.135:8081/cdn/（服务端下发）` —— 消费链路通了；但 dispatcher
配的那个值不是可下载的基址：filebrowser 只在 `/api/public/dl/<hash>/` 下发文件，`/cdn/` 是它自己的
SPA 路由，**任何路径都回 200 + `text/html`**，于是「下载成功」拿到一坨 HTML，最终炸在
`readFile failed!`。**200 不等于拿到文件**，配 CDN 基址时要看 `Content-Type`。正确值是本机 filebrowser
的固定分享 `http://172.25.50.135:8081/api/public/dl/shCo8WNE/`（内容已上传，`project.manifest` /
`skin-vest-foundation.manifest` / `assets/skin-vest-foundation/index.js` 均 200 + `application/octet-stream`，
base 热更也已用这个基址跑通）。改 `dispatcher.json` 属 server-core-kit，本仓不动（跨仓库禁令）。

## 补充（2026-08-18）：内容基址一律听服务端 —— 自取 remote manifest 再改基址

上节把「基址听 `cdn_url`」只给了**没随包发过**的 bundle（种子那条路），并断言 base 做不到。那个断言
是**错的**，起因是只看了 `loadLocalManifest` 一条注入路。补齐后 base 与所有分包统一：

9. **`check()` 时自己把 remote manifest 拉下来、改掉三个地址字段、经 `loadRemoteManifest()` 灌回引擎**，
   而不是让引擎按 local manifest 里烘的地址去查。基址取握手下发的 `cdn_url`；**base 与分包共用同一个
   选项** `CcHotUpdateOptions.cdnUrl`（原 `bundleCdnUrl`，已改名——它不再只管分包）。
   任何一步不成（拉不到 / 不是 JSON / 引擎不收）都退回 `checkUpdate()` 老路，用包内烘的地址试一次。

- **为什么改 remote 而不是 local**：下载基址**只认 remote manifest** ——
  `AssetsManagerEx.cpp:738` `_remoteManifest->getPackageUrl()` 是全文件**唯一**一处 `getPackageUrl`；
  local 那份的 `packageUrl` 仅用于决定「去哪拉 remote manifest 本身」（`:580` / `:623`），而这一步
  我们已经自己做了。于是 **local 那条路一个字节都不用碰**：包内 / 缓存的 asset 表照常做 diff，
  版本比较照常跑。
- **改 local 走不通**（上节断言的由来，记在这里免得再试）：`loadLocalManifest(Manifest*, storagePath)`
  会拿注入的那份与 `<storagePath>/project.manifest`（缓存）比版本 —— 比输了当场被缓存整个顶掉
  （`:220` `CC_SAFE_RELEASE(_localManifest)`），改动作废；比赢了又 `removeDirectory(_storagePath)`
  清库，且 `checkUpdate` 的 `_localManifest->versionGreaterOrEquals(_remoteManifest)`（`:326`）
  立刻判「已是最新」再不更新。版本号既要高又要低，两头都是死的。`Manifest::_packageUrl` 是 private
  且只有 getter，也没法事后改。
- **`loadRemoteManifest` 的门与后续流程**（`:312`）：前置条件 `_inited && _updateState <= UNCHECKED`，
  正好是 `loadLocalManifest` 之后、`checkUpdate()` 之前。注入成功后它**自行派发**
  `NEW_VERSION_FOUND` / `ALREADY_UP_TO_DATE`，与 `checkUpdate()` 的产物等价 —— 所以事件处理那段
  两条路共用；`update()` 撞到 `NEED_UPDATE` 且 remote 已 loaded 时直接 `startUpdate()`，
  **不会回头再去拉 version/manifest**，`remoteVersionUrl` 实际上用不到（仍然改对，因为
  `updateSucceed()` 的 `_localManifest = _remoteManifest`（`:846`）会把它落盘成新的 local manifest）。
- **副作用是好的**：更新成功后我们注入的基址随之落盘，下次启动的缓存 manifest 自带新地址。
- **退回老路必须留日志**：两条路的产物一模一样，不打日志就无从判断「为什么走的是老地址」。

**实证 PASS**（2026-08-18，真 x86_64 模拟器，干净安装）。判据做成**二值**的：**APK 与 CDN 上所有
manifest 的 `packageUrl` 全烘成死地址 `http://127.0.0.1:9/dead/`**，全局唯一的活地址是 dispatcher
下发的 `cdn_url`。于是「下载成功」只可能来自运行时改写。

```
dispatcher 放行：cdn=http://172.25.50.135:8081/api/public/dl/shCo8WNE/
[cck] project.manifest 基址取服务端下发：…/shCo8WNE/     ← base 走注入路
hotupdate 37% → 100% → restart
马甲皮 → skin='vest'                                    ← 新 settings 接管
[cck] shared.manifest / skin-vest-foundation.manifest / foundation.manifest 基址取服务端下发：…
【force-stop 冷启动】skin='vest'，四个包全走注入路，零重下
```

对照组同样明确：**同一份死地址内容、改动前的 engine**，失败在
`热更检查失败: java.net.ConnectException: Failed to connect to /127.0.0.1:9`。

> 该轮 `cdn_url` 由本机假 dispatcher（scratchpad，验证用）下发 —— 真的那台配的值仍是错形态的
> `…:8081/cdn/`，已提 [server-core-kit#1](https://hlgit.5518game.com/luohao/server-core-kit/-/issues/1)。
> 改那个文件属别的仓，本仓不动。

**至此整条热更链路只剩一个烘死的地址：`dispatcherUrl`**（`boot/app-config.ts` 的打包期常量）。它救不了
也不该救 —— 它是链条起点，没人能告诉你「去哪问」。它配错 = 砖头包（见 `apps/demo/docs/build-plugin.md`）。
