---
状态: 已实施（2026-08-20，真机 e2e 三条全过：冷启动 / 只传 CDN 换代码 / 回滚）
日期: 2026-08-20
摘要: native 热更改内容寻址（`md5Cache: true`），bundle 版本从它自己的 manifest 反推 —— CDN 可 immutable 缓存、多版本共存、回滚不必重新出包
何时读: 要给 native 热更提高 CDN 命中率、或要支持「把上一版 manifest 放回去」式回滚时
依赖: docs/design/2026-08-05-hotupdate-per-bundle-proposal.md, packages/core/docs/modules/hotupdate-service.md, packages/core/docs/modules/bundle-manager.md
---

# native 内容寻址热更（md5）改造提案

## 动机

native 现在**不开** `md5Cache`，所有文件同名不同内容：`assets/shop/index.js` 这一个 URL，
第 3 版和第 7 版是两坨不同的字节。由此三个问题，都不是理论推演：

1. **CDN 必须 no-store。** 同名不同内容意味着任何缓存都可能发错版本。热更内容因此每次都回源，
   命中率结构性为 0 —— 而热更恰好是「同一批文件被大量设备同时拉」的场景，最该被缓存的就是它。
2. **回滚要重新出包。** `build.mjs` 的 native 分支是 `rmSync(cdnDir)` + `cpSync`（覆盖式发布），
   上一版的字节在 CDN 上已经不存在了。要退回去只能把旧代码重新构建一遍再传一次。
3. **回滚即使传上去也不生效。** `Manifest::versionGreaterOrEquals` 默认走 `cmpVersion`，
   远端版本号数值上更小 → 判定「本地已是最新」→ **静默跳过**，不报错、不下载。
   （解法不是去改比较规则，是发布侧守「版本号只增」，见下。）

web 侧没有这三个问题，因为 web 天然内容寻址（`index.<md5>.js`）。本提案把这套搬到 native。

## 已验证事实（2026-08-20，Android 模拟器 + 引擎源码）

动手前跑了两轮受控构建 + 一次真机启动，下面每条都有实测或源码依据，**不是推断**：

| # | 结论 | 依据 |
|---|---|---|
| 1 | md5 版 native 包能正常启动 | 真机跑到 `LoginView`、长连接通 |
| 2 | bundle manifest 的 key 完全内容寻址（连 `import/` 下的资源都带 md5） | `build/android-md5/` 产物实读 |
| 3 | `index.<md5>.js` 与 `cc.config.<md5>.json` 用**同一个** md5，等于 `settings.bundleVers[name]` | 产物：`assets/foundation/{index,cc.config}.d6501.*` |
| 4 | base manifest 天然不含 `main.js` / `application.<md5>.js`（它们在产物根，manifest 只遍历 src、assets、jsb-adapter） | `hot-update-manifest.ts:37` + 产物实读 |
| 5 | **不改客户端就静默失效** | 真机活样本，见下 |
| 6 | `options.version` 优先于 `downloader.bundleVers[name]`，native 与 web 同构 | `cc.25e81.js:32301` + `jsb-adapter/engine-adapter.js` |
| 7 | 下载落盘路径 = `storagePath + manifest key` | `AssetsManagerEx.cpp:748` / `:814` |
| 8 | 旧文件被物理删除（`genDiff` 的 DELETED → `removeFile`）→ 不用写 GC，但**回滚要重下** | `AssetsManagerEx.cpp:789` |
| 9 | 版本比较可注入，但**注入是陷阱**（同一 handle 还管「新 APK 清旧缓存」）→ 回滚的解法是发布侧「版本号只增」 | `AssetsManagerEx.cpp:213/287` 的 `versionGreater` vs `:326/607/650` 的 `versionGreaterOrEquals` |
| 10 | `md5CacheOptions.excludes` 对 `src/` **半生效**（挡住引用重写、挡不住改名）→ 产出静默坏包 | 两次构建对比 |
| 11 | `native.Manifest` 的 JS 绑定**没有** `getAssets()` | `cc.d.ts:34383-34408` |

> 第 10 条同时纠正了 `2026-08-05-hotupdate-per-bundle-proposal.md` 里写的绕开办法 ——
> 那条路走不通，别再按它试。

### 第 5 条的活样本（这次改造为什么必须一次做完）

真机日志报 `bundle 'foundation' 更新 2/2 文件`，设备上确实躺着 54526 字节的真代码，
**但那 54KB 从头到尾没被执行过**：

```
APK 内 settings.bundleVers.foundation = "d6501"
  → 引擎请求 assets/foundation/index.d6501.js
设备下载落盘        = assets/foundation/index.js      ← 名字对不上
  → 静默回落包内那份，不报错
```

（这一次名字对不上，源于 dispatcher 下发的 CDN 覆盖了烘进包里的 `packageUrl`、指向了非 md5 内容；
但**名字对不上就静默回落**这个机制与来源无关。）

结论：只开 `md5Cache`、不改客户端，会得到一个「热更报成功、代码不生效、不报错」的系统——
比现在更糟。**两件事必须一次做完。**

## 目标设计

### 版本从 bundle 自己的 manifest 反推（不引入第二张表）

web 靠一张 `cck-versions.json` 把 bundle→md5 告诉客户端。native **不需要**这张表——
`<bundle>.manifest` 的 asset key 里已经写着答案：

```jsonc
// foundation.manifest
{ "assets": {
    "assets/foundation/index.d6501.js":       { },
    "assets/foundation/cc.config.d6501.json": { } } }
```

`AssetsManagerEx` 更新成功后 `_localManifest = _remoteManifest`，缓存 manifest 落在
`<storagePath>/project.manifest`。所以**更新刚跑完，manifest 就是这个 bundle 内容的权威描述**——
从它反推的 version 与刚落盘的字节严格同步，不存在「表和内容不同步」这个失配面。

由此 native 侧不需要：配 `versionUrl`、拿 dispatcher 的 `cdnUrl` 拼版本表地址、
防版本表被 `cacheManager` 缓存、维护表与 manifest 两套真相。

反推是纯字符串处理，落在 core（零 cc、可单测）：

```ts
/** 从 asset key 列表里认出该 bundle 的内容版本（`assets/<bundle>/index.<v>.js` 的 `<v>`）。 */
export function bundleVersionFromAssetKeys(
  bundle: string,
  keys: readonly string[],
): string | undefined;
```

engine 侧只负责把 key 列表拿出来。因为 `native.Manifest` 没有 `getAssets()` 绑定（事实 11），
读文件自己 parse：缓存 manifest 优先，没有就读包内 `<bundle>.manifest`。

### 版本解析顺序挪到 `ensureLatest` 之后

`BundleManager.load` 现在在 `ensureLatest` **之前**就定死了 version。改后：

```ts
const version = loadOpts?.version ?? updater.versionOf(name) ?? versions[name];
//              ↑ 调用方显式指定最高      ↑ native：刚更新完的 manifest   ↑ web：版本表
```

三个来源互不重叠：web 上 `versionOf` 恒 `undefined`（没注册热更后端），native 上 `versions` 恒空表。
一行覆盖两个平台。

### base manifest 丢掉内容寻址的引导链

开 md5 后 base manifest 里这些条目**下发也没人读**：

| 文件 | 谁按硬编码名引用它 | 引用者可否热更 |
|---|---|---|
| `src/settings.<md5>.json` | `application.<md5>.js` | ✗ 在产物根，不进 manifest |
| `src/import-map.<md5>.json`、`src/system.bundle.<md5>.js` | `main.js`（ejs 模板渲染） | ✗ 同上 |
| `src/cocos-js/cc.<md5>.js` | `import-map.<md5>.json` | 链的上游已断 |
| `assets/{main,internal,resources}/*.<md5>.*` | `settings.bundleVers`（在 `src/`，同断） | 同上 |

客户端手上的 `main.js` / `application.js` / `settings.json` 永远是包内那套，请求的永远是旧 md5 名。
新 md5 文件下下来后**无人问津**，第二次发布时又被 `genDiff` 判 DELETED 删掉。净效果是：

- 白下几 MB（`src/cocos-js/cc.<md5>.js` 一个就好几 MB）；
- **每次发布 base 版本号必涨**（`src/` 里任何 md5 变了，`sameContent` 就判不同）→ 每次启动都跑一轮
  全量 base 更新，下完还不生效。

所以 md5 模式下 base manifest 的 asset 表**恒空**。`jsb-adapter/` 是唯一读得到的一类（`main.js` 里是裸名），
但它与 `libcocos.so` 里的 C++ 绑定层同源，换它不换 `.so` 崩在绑定层 —— 一并排除（2026-08-20 收尾时补）。

### CDN 从「覆盖式」改「叠加式」，并归档每版 manifest

文件名带 md5 之后新旧天然共存，于是 native 可以照 web 的做法（`build.mjs` 那段注释已经写明了理由）
**只叠加、绝不清空**。加一步归档：

```
<cdnDir>/
  project.manifest  foundation.manifest  shop.manifest  …   ← 当前在发的那一版
  assets/foundation/index.d6501.js                          ← 历史各版本的字节都还在
  assets/foundation/index.a91f2.js
  releases/1.0.4/{project,foundation,shop,…}.manifest       ← 每版归档一份
  releases/1.0.5/…
```

**回滚 = 把 `releases/<旧版>/` 的 manifest 拷回根，涨一个版本号，完。** 不重新出包、不重传内容。

### 回滚要能真的落地：版本号只增，别去注入版本比较

上一步单独做不成事——引擎默认 `cmpVersion` 会把「远端版本号更小」判成本地已最新（事实 3 的机制）。

**看起来的解法是注入 `setVersionCompareHandle((a, b) => (a === b ? 0 : -1))`（不等即更新）。
这是陷阱，实施中查 C++ 时才发现**：同一个 handle 还服务另一处完全不同的语义——
`loadLocalManifest` 用 `versionGreater(cached, handle) > 0` 判断「包内 manifest 比缓存新 →
`removeDirectory` 清掉旧热更缓存」（`AssetsManagerEx.cpp:213/287`）。一个恒不返回正数的 handle
会让**新装的 APK 永远被上一版的热更缓存盖住**，比它要修的回滚问题严重得多。

所以回滚表达成**「发一版号更大、内容是旧的」**，发布侧守「版本号只增」：

```bash
cck-manifest rollback --cdn <CDN根> --release 1.0.0 --version 1.0.2
```

它读 `releases/1.0.0/` 的 manifest、配上 `1.0.2` 这个更大的号发回 CDN 根。内容文件一个都不用重传
（内容寻址 + 叠加式发布，旧 md5 的字节还在）。

**⚠️ 只能动内容真的变了的包** —— 这一条是真机上崩出来的，不是设计时想到的。归档目录里躺着**全部**
manifest，而一次回滚通常只想退掉一两个包。第一版实现给 28 份全涨了号，结果客户端对那些内容没变的包
判 NEW_VERSION_FOUND、`genDiff` 却算出空表 → `prepareUpdateAsync` 在 **worker 线程**里就地
`updateSucceed()` → `UPDATE_FINISHED` 在非主线程进 JS VM → **SIGSEGV**（栈：`AsyncTaskPool::ThreadTasks`
→ `updateSucceed` → `dispatchUpdateEvent` → JS）。

这与 `--prev` 是同一条不变式：**「版本号变了」必须蕴含「内容真变了」**。所以 `rollbackManifests`
逐份与当前在发的那版比资产表（复用 `sameContent`），一致就原样不动；`*.version.manifest` 没有资产表，
跟随它对应的主 manifest 的决定。

### APK 覆盖安装：旧热更缓存必须作废

这条与 md5 正交（不开 md5 也在），但内容寻址让它更值得治，所以一并做了。

**引擎自带一道防线，但它只在版本号纪律成立时有效。** `loadLocalManifest` 用
`versionGreater(cachedManifest)` 比「包内 manifest」与「缓存 manifest」，包内更新就
`removeDirectory(storagePath)` 清缓存（`AssetsManagerEx.cpp:213/287`）。漏掉的场景：

- **装了更旧的包**（商店回滚、手动装历史 apk、渠道包互换）→ 包内号更小 → **缓存接管** →
  旧 AOT 配着为新 AOT 编译的模块代码跑；
- 出包时 `--prev` 指错目录、或压根没跑 `--manifest` → 包内号可能低于线上。

**而 `coreApiHash` 闸救不了这一场**：缓存接管后 `check()` 判 `ALREADY_UP_TO_DATE`（缓存 = 远端），
根本不去拉更新戳 sidecar，闸不跑。表现就是「装完新包启动报错，清数据才好」。

解法是一道**冷启动对账**，判据用**主包 md5**（`settings.querySettings('assets','bundleVers').main`）：

```ts
// Bootstrap，必须在 bootCoreKit 之前
for (const d of resetCcHotUpdateOnAppChange()) console.log(`热更缓存作废 ${d}`);
```

| 为什么是这个判据 | |
|---|---|
| **拿得到** | 必须跑在 kit 装配之前（`AssetsManagerEx.create()` 一调就前插搜索路径），而 app 戳在 `resources` bundle 里要异步 load，那时还没到。`bundleVers` 是 `settings` 的一部分，引擎启动时就读好了，同步可取 |
| **口径更保守且正确** | `coreApiHash` 只描述 core 的 API 面，AOT 业务代码改了它不变；而热更下来的模块代码是对着**整个 AOT** 编译的 |
| **不误清** | 只改模块、AOT 没动时主包 md5 不变 → 玩家不会因为一次纯业务热更而重下所有包 |
| **判不了就不动** | 没开 `md5Cache` 时 `bundleVers` 是空表 → 返回 `undefined` → 原样不动（当成「换了」会让每次冷启动全量重下） |

清理范围是 base storagePath + 模块存储根 + `<base>_temp/`（断点续传目录与 storagePath **平级**，
留着会让下一轮更新从属于旧 APK 的半成品接着续），并把指向它们的搜索路径条目摘掉、
删掉持久化的 `HotUpdateSearchPaths`。

## 变更总览

| 层 | 文件 | 改动 |
|---|---|---|
| tools | `hot-update-manifest.ts` | `SplitManifestOptions.contentHashed` → base 丢弃 `src/**` 与 AOT bundle 条目 |
| tools | `hot-update-manifest.ts` | `archiveManifests` / `rollbackManifests`（回滚只动内容真变了的包） |
| tools | `cli.ts` | `--md5` 透传；`archive` / `rollback` 子命令 |
| core | `hotupdate/bundle-version.ts`（新） | `bundleVersionFromAssetKeys` 纯函数 |
| core | `hotupdate/hotupdate-backend.ts` | `IHotUpdateBackend.assetKeys?()` |
| core | `hotupdate/bundle-updater.ts` | `versionOf(bundle)`；`run()` 末尾记下 |
| core | `bundle/bundle-manager.ts` | version 解析挪到 `ensureLatest` 之后，插入 `versionOf` |
| engine | `hotupdate-backend.ts` | 实现 `assetKeys()`（解析那半在 `hotupdate-paths.ts` 的 `manifestAssetKeys`，按 ADR-0002）；留一条注释挡住「注入 `setVersionCompareHandle`」这个陷阱；新增 `resetCcHotUpdateOnAppChange()` |
| engine | `hotupdate-paths.ts` | `manifestAssetKeys` / `aotStamp` / `searchPathsWithout` 三个纯函数 |
| demo | `assets/boot/Bootstrap.ts` | `bootCoreKit` 之前调 `resetCcHotUpdateOnAppChange()` |
| demo | `build-configs/android-boot.json` | `md5Cache: true` |
| demo | `scripts/build.mjs` | 传 `--md5`；CDN 同步改叠加 + `releases/<version>/` 归档 |

## 关键决策

| # | 决策 | 理由 | 否决的替代 |
|---|---|---|---|
| D1 | 版本从 bundle manifest 反推 | 与刚落盘的内容严格同步，零失配面；native 不必配 `versionUrl` / 拼 `cdnUrl` / 防缓存 | native 也拉一张 `cck-versions.json`：多一套真相、多三处要对齐 |
| D2 | 读 manifest 文件自己 parse | `native.Manifest` 没有 `getAssets()` JS 绑定（事实 11） | 改引擎加绑定：要维护引擎补丁，代价远超收益 |
| D3 | 显式 `loadOpts.version` 仍最高优先 | 保住现有语义（调用方指定版本是逃生口） | 让 `versionOf` 压过显式指定 |
| D4 | base manifest 在 md5 模式下丢掉 `src/` 与 AOT 包 | 下发也无人读，只造成白下 + 每次发布必涨 base 版本 | 保留：等于每次启动全量下一遍引擎 JS 再原样丢掉 |
| D5 | **不动**版本比较，回滚表达为「发一版号更大、内容是旧的」 | 同一个 handle 还管「新 APK 清旧缓存」（`versionGreater`），改了会让新包被旧缓存盖住 | 注入「不等即更新」：修了回滚，砸了升级 |
| D5b | 回滚只改内容真变了的那几份 manifest | 「版本号变了」必须蕴含「内容真变了」，否则空 diff → worker 线程 SIGSEGV（真机崩过） | 全部涨号：省一次比对，换一次崩溃 |
| D6 | native CDN 改叠加式 + 归档 manifest | 内容寻址后新旧天然共存，回滚只需换 manifest | 保持覆盖式：回滚必须重新出包重新上传 |
| D7 | `md5Cache` 由构建配置开关，tools 侧显式 `--md5` 跟随 | 两种模式并存、可回退；不靠猜产物形态 | 自动探测 `settings.<hex>.json`：省一个参数，换来一个隐式判据 |
| D8 | APK 换了就清空热更缓存，判据用主包 md5 | 引擎那道 `versionGreater` 只在版本号纪律成立时有效，降级安装直接穿透；闸也救不了（缓存 = 远端 → 不拉 sidecar） | 只靠版本号纪律：一次手动装旧包就复现「装完启动报错」 |
| D9 | 判不了（没开 md5Cache）就原样不动 | 把「判不了」当「换了」= 每次冷启动全量重下 | 保守清空 |

## 代价（必须知情后再拍板）

**base 层（引擎 JS + AOT 业务代码 `assets/boot`）从此只能整包更新。** 开 md5 之前，改
`assets/boot` 的代码可以靠 base 热更推下去；开了之后它变成 `assets/main/index.<md5>.js`，
而引用它的 `settings` → `application.js` → `main.js` 这条链的根不可热更，推下去也不会被加载。

这与架构定的分层是一致的（`boot/` = AOT，「发新包、重启」），**但确实失去了「紧急修 boot 层
bug 不发包」这个能力**。缓解：真正需要紧急修的逻辑本就该放 `foundation`（热更层），
boot 只留「起进程 + 找到 foundation」这点代码 —— 这正是 `docs/design/2026-08-07-demo-assets-layout-v2-proposal.md`
定的边界。

次要代价：CDN 侧叠加发布会累积历史版本，需要一条「按时间保留 N 版」的清理策略（与 web 同题，
不在本提案范围）。设备侧不会无界增长——`updateSucceed` 按 diff 删旧文件。

## 测试计划

| 层 | 用例 |
|---|---|
| core 单测 | `bundleVersionFromAssetKeys`：命中 / 无 md5 名（不开 md5 的产物）/ 多余 key 干扰 / bundle 名含连字符 / 空表 |
| core 单测 | `BundleUpdater.versionOf`：`ensureLatest` 前恒 undefined；失败后不留值；后端不实现 `assetKeys` → undefined |
| core 单测 | `BundleManager.load` 版本优先级三档；`versionOf` 的值真的传进了 `source.loadBundle` |
| tools 单测 | `contentHashed` 开关下 base manifest 的条目集合；bundle manifest 不受影响 |
| engine | `cc` mock 测 `assetKeys()` 的文件选择（缓存优先 / 回落包内 / 都没有 → 空 / JSON 坏 → 空） |
| 真机 e2e | ① md5 包冷启动到 Lobby；② 改一行 foundation 代码 → 重新出包 → 只传 CDN → 重启客户端 → **新代码真的生效**（这一步是整个提案的判据）；③ 把上一版 manifest 拷回去 + 涨版本号 → 客户端回滚到旧代码 |

### 执行结果（2026-08-20，Android 模拟器 `fortune_test`）

| | 判据 | 结果 |
|---|---|---|
| ① | 冷启动到 `LoginView` + 长连接就绪 | ✅ |
| ② | 改 `LoginView` 一行日志 → `--manifest --manifest-version 1.0.1`（**不出 APK**）→ 重启 | ✅ 日志出现新文案；设备落盘 `index.eab41.js`；缓存 manifest version=1.0.1 |
| ②附 | 只有 `foundation.manifest` 涨到 1.0.1，`project.manifest` 仍 1.0.0 | ✅ `--prev` 生效，base 不再每次发布必涨 |
| ③ | `rollback --release 1.0.0 --version 1.0.2` → 重启 | ✅ 新文案消失、落盘回 `index.d6501.js`、`eab41` 被 `genDiff` 删掉；**没重新出包、没重传内容文件** |
| ③附 | 回滚只动 1 个包，13 个内容未变的原样不动 | ✅ 第一版实现全涨号，真机当场 SIGSEGV → 已修 + 补回归测试 |

②③ 两条必须在真机上跑，因为静默失效正是「日志全绿但代码没生效」——单测和预览都测不出来。

## 实施步骤

1. tools：`contentHashed` + `--md5`，补单测。
2. core：`bundleVersionFromAssetKeys` + `assetKeys?()` + `versionOf` + `BundleManager` 版本解析顺序，补单测。
3. engine：`assetKeys()` 实现 + `setVersionCompareHandle`。
4. demo：`md5Cache: true`、`build.mjs` 传 `--md5` + 叠加式 CDN + `releases/` 归档。
5. 五道门（`lint` / `typecheck` / `test` / `check:vm-tests` / `docs:api`）。
6. 真机 e2e 三条。
7. 收尾：模块文档改写为现状、`docs/progress.md`、本提案标「已实施」、追加 ADR（D5/D6 属破坏性：
   版本比较语义变了、CDN 发布方式变了）。

## Open Questions

- CDN 历史版本的保留策略（保留 N 版 / 按时间）—— web 侧同题，一起做还是各做各的？
- `releases/<version>/` 的归档要不要连 `cck-update-compat.json` 一起（回滚时 `coreApiHash` 也要跟着回退）？
  倾向要，实施时确认。
