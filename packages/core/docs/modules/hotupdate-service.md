---
模块: hotupdate-service
所在包: packages/core（更新状态机 + 版本闸策略 + 内存 fake，零 cc）；native.AssetsManager / game.restart 的 native 后端已实现（见文末 engine 半适配）；Web·小游戏远程 bundle 版本化后续
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 线上热更统一入口 createHotUpdateService——check → 版本兼容闸 → download(进度) → apply → restart，三平台一个 API。core 持更新状态机 + VersionGate 兼容策略（默认 semver 安全闸、可 override，承 ADR-0001 防 AOT 缺代码），平台 IO 经 IHotUpdateBackend 下沉 engine（native jsb.AssetsManager / Web·小游戏远程 bundle）。
何时读: 需要线上补丁下载/版本校验/热更 UI 状态/失败重试，或为某平台接热更后端时。
日期: 2026-07-28
依赖: di（HOTUPDATE_BACKEND/HOTUPDATE_SERVICE token）、logger（告警）、[[adr-0001]]（AOT 缺代码 → 版本绑定）。IHotUpdateBackend 的平台适配走 engine（后续）；出包期打戳/校验（coreApiHash/minAppVersion 的产生侧）走 packages/tools 的 [[compat-stamp]]（已实现）。横评见 docs/research/2026-07-28-hotupdate-survey.md。
---

# HotUpdateService（线上热更统一入口）设计文档

## TL;DR

`createHotUpdateService({ backend?, gate?, app?, logger? })` 返回 `HotUpdateService`：`check()` 拉远程版本头比版本 → 过**版本兼容闸** → `up-to-date | update-available | rejected(needFullUpdate) | error`；`update(onProgress?)` 下载差量 + 应用 → `ready(待 restart) | failed(retryable) | skipped`；`restart()` 重启生效。三平台（native/Web/小游戏）一个 API，平台差异经 `IHotUpdateBackend`（`check/download/apply/restart`）下沉 engine。**版本闸 = 钩子 + 安全默认**（用户定 2026-07-28）：core 定 `VersionGate` 接缝 + 默认 `createSemverVersionGate`（`minAppVersion` + 可选 `coreApiHash` 比对，承 ADR-0001 防 AOT 缺代码崩），零配置即安全，可注入自定义 gate 做灰度/强更。**core 零 cc**：状态机 + 版本策略 + 内存 fake 全可 node 单测。

## Purpose（目标与定位）

- **做什么**：把 CLAUDE.md「三种热」的**线上热更(hotfix)** 收敛为一个带**统一状态机 + 版本兼容闸 + 进度/重试**的入口。（另两热：运行时按需分包归 [[bundle-manager]]；开发期热重载走 vitest watch，非本模块。）
- **定位/取舍**：**瘦 core 半 + engine backend**（用户定 2026-07-28，横评候选 A）——core 持更新状态机、版本策略、失败重试语义（**可 node 单测**）；engine `IHotUpdateBackend` 做平台 IO：native 包 `jsb.AssetsManager`（checkUpdate/update 事件 + setSearchPaths + game.restart），Web/小游戏包远程 Asset Bundle 版本化（`assetManager.loadBundle({version})`）。与 [[sceneflow]]（core 状态机 + engine 真切场景）同构。
- **版本闸为何「钩子 + 安全默认」**（用户定 2026-07-28）：ADR-0001 实证 AOT 缺代码会让热更包**跑到一半才崩**、线上难复现。纯钩子把安全变 opt-in（易漏），纯强制闸不够灵活。合一方案：`VersionGate` 接缝 + 默认安全 gate → **零配置即挡崩溃**，override 时才自担责，兼得灵活与安全，且默认策略是纯函数好测。
- **三平台抽象、先实 native backend**（用户定 2026-07-28）：`IHotUpdateBackend` 抽象覆盖三平台；engine 首版只实 native，Web/小游戏 backend 随需再接。core 半与测试不受平台影响。
- **YAGNI（首版砍）**：自动重试退避调度（`update` 可再调重试，重试**时机**交上层——AssetsManager 自带 downloadFailedAssets 续传）；断点续传细节（backend 内部事）；多补丁排队；下载限速。

## Public API（TypeScript 精确签名）

```ts
// —— 版本兼容闸（core，纯逻辑）——
export interface UpdateInfo { version: string; minAppVersion?: string; coreApiHash?: string; totalBytes?: number; }
export interface AppInfo { appVersion: string; coreApiHash?: string; }
export interface GateResult { ok: boolean; reason?: string; needFullUpdate?: boolean; }
export interface VersionGate { canApply(remote: UpdateInfo, local: AppInfo): GateResult; }
export function compareVersion(a: string, b: string): number;          // 点分数字比较 -1/0/1
export function createSemverVersionGate(): VersionGate;                 // 默认安全闸

// —— 平台后端接缝（core 定义，engine 实现）——
export type CheckResult = { status: 'up-to-date' } | { status: 'new-version'; info: UpdateInfo };
export interface HotUpdateProgress { bytesDone: number; bytesTotal: number; filesDone: number; filesTotal: number; }
export interface IHotUpdateBackend {
  check(): Promise<CheckResult>;
  download(onProgress: (p: HotUpdateProgress) => void): Promise<void>;
  apply(): Promise<void>;
  restart(): void;
}
export const HOTUPDATE_BACKEND: Token<IHotUpdateBackend>;
export function createMemoryHotUpdateBackend(preset?: { check?: CheckResult }): IHotUpdateBackend;

// —— 统一服务（core 实现）——
export type HotUpdateState = 'idle'|'checking'|'up-to-date'|'update-available'|'rejected'|'downloading'|'applying'|'ready'|'failed';
export type CheckOutcome =
  | { kind: 'up-to-date' } | { kind: 'update-available'; info: UpdateInfo }
  | { kind: 'rejected'; reason: string; needFullUpdate: boolean } | { kind: 'error'; error: unknown };
export type UpdateOutcome =
  | { kind: 'ready' } | { kind: 'failed'; error: unknown; retryable: boolean } | { kind: 'skipped'; reason: string };
export interface HotUpdateService {
  readonly state: HotUpdateState;
  readonly info: UpdateInfo | undefined;
  check(): Promise<CheckOutcome>;
  update(onProgress?: (p: HotUpdateProgress) => void): Promise<UpdateOutcome>;
  restart(): void;
}
export const HOTUPDATE_SERVICE: Token<HotUpdateService>;
export function getHotUpdateService(): HotUpdateService;
export function createHotUpdateService(opts?: { backend?: IHotUpdateBackend; gate?: VersionGate; app?: AppInfo; logger?: ILogger }): HotUpdateService;
```

## Behavior & data flow（行为与数据流）

- **状态机**：`idle →(check) checking →` `up-to-date` | `rejected` | `update-available` | `failed(check 抛错)`；`update-available →(update) downloading → applying → ready`，任一步抛错 → `failed`（可从 failed 再 update 重试）。
- **check()**：state=checking → `backend.check()`：
  - `up-to-date` → state=up-to-date；
  - `new-version` → 存 `info` → `gate.canApply(info, app)`：不通过 → state=rejected（reason/needFullUpdate，缺省兜底 '版本不兼容'/false）；通过 → state=update-available；
  - 抛错 → state=failed、告警、返回 `error`。
- **闸在 check 阶段跑**（下载**之前**）：不兼容不白下载几十 MB，直接提示需整包更新。
- **update(onProgress?)**：前置 state 须 `update-available` 或 `failed`（重试），否则告警返回 `skipped`；state=downloading → `backend.download(onProgress)` → state=applying → `backend.apply()` → state=ready；抛错 → state=failed、`retryable:true`。
- **restart()**：委托 `backend.restart()`（native game.restart / web reload）。
- **默认解析**：`backend = opts.backend ?? tryResolve(HOTUPDATE_BACKEND) ?? 空后端(恒 up-to-date)`；`gate = opts.gate ?? createSemverVersionGate()`；`app = opts.app ?? {appVersion:'0.0.0'}`。
- **与 cc 边界**：状态机/闸/内存 fake 全在 core（零 cc）。engine 实现 `IHotUpdateBackend`：native 用 `jsb.AssetsManager`（构造 manifestUrl+缓存路径、checkUpdate→CheckResult、update→事件转 HotUpdateProgress、setSearchPaths、game.restart）；Web/小游戏用远程 bundle 版本化。属**有状态引擎行为**，ADR-0002 不进 cc mock，走 apps/demo 集成验证。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | core/engine 拆分 | 纯 engine / **瘦 core 半 + engine backend** | **瘦 core 半**（用户定 2026-07-28） | 状态机/版本策略/重试脱 cc 可测；三平台一个 API |
| 2 | 版本兼容校验 | 强制闸 / 纯钩子 / **钩子 + 安全默认** | **钩子 + 安全默认**（用户定 2026-07-28） | 零配置即挡 AOT 缺代码崩（ADR-0001），override 可自定义灰度/强更 |
| 3 | 平台范围 | 只 native / **三平台抽象、先实 native** | **三平台抽象**（用户定 2026-07-28） | backend 接缝隔离平台；Web/小游戏随需接 |
| 4 | 闸运行时机 | 下载后 / **check 阶段（下载前）** | **下载前** | 不兼容不白下载；省流量、早提示 |
| 5 | 失败重试 | 内建退避调度 / **update 可再调、时机交上层** | **可再调** | AssetsManager 自带续传；退避调度 YAGNI |
| 6 | 应用生效 | 自动 restart / **apply 与 restart 分离** | **分离** | 让 UI 先提示「更新完成，重启生效」再由用户/上层触发 restart |
| 7 | DI 便捷 | 仅工厂 / **BACKEND + SERVICE token + get** | **都给** | 对齐姊妹模块 token+fallback 范式 |
| 8 | 包内无 `<bundle>.manifest` 时 | 放弃更新 / 落一份种子到盘 / **内存造种子 manifest** | **内存种子**（2026-08-17） | 从没随包发过的 bundle（新马甲皮 / 新模块）本来引导不起来；`<bundle>.manifest` 不在任何 asset 表里、热更带不来它。内存造不落盘、失败下次启动自动重来。`version` 恒 `0.0.0` 让缓存 manifest 接管 → 第二次起增量。见 [[adr-0013]] 补充 |
| 9 | 种子的基址从哪来 | 出包配置 / 包内 `packageUrl` / **服务端下发 `cdn_url`** | **服务端下发**（用户定 2026-08-18） | 内容托管在哪是运营期决定——换 CDN / 灰度 / 挪域名只该改服务端配置。包里烘的是出包那刻的快照，内容挪了就得发新包，正是热更要消灭的事。没下发才回落包内 `packageUrl`（兜底，不是「配错也能跑」） |
| 10 | 基址怎么落到引擎 | 改 local manifest / 改构造参数 / **自取 remote manifest 再 `loadRemoteManifest`** | **灌 remote**（2026-08-18） | 下载基址只认 remote（`AssetsManagerEx.cpp:738` 是全文件唯一一处 `getPackageUrl`），local 那份只提供 diff 用的 asset 表、一个字节都不用动。改 local 走不通：与缓存比版本，比输了被顶掉、比赢了清库且再不更新。**base 与所有分包统一走这条**，选项从 `bundleCdnUrl` 改名 `cdnUrl` |

## Platform considerations（全平台 / 小游戏兼容）

- core（状态机/闸/内存 fake）纯 TS，全平台无差异。
- **native**：`jsb.AssetsManager` 差量下载脚本+资源 → 写 `writablePath` → `setSearchPaths` 置顶 → `game.restart` 生效。
- **native 的三层更新边界（搜索路径还原的时机决定的，2026-08-05 查证）**：C++ `BaseGame::init()` 依次 `runScript("jsb-adapter/web-adapter.js")` → `runScript("main.js")`，两者都用**默认搜索路径**解析，而还原逻辑就写在 `main.js` 里 —— 于是热更能覆盖的范围被这条时间线切成三段：

  | 层 | 内容 | 能否热更 |
  |---|---|---|
  | L0 还原之前 | native `.so`（引擎 C++ + jsb 绑定）、`jsb-adapter/web-adapter.js`、**`main.js` 自身** | **不能**，只能发版 |
  | L1 还原之后 · 需重启 | `src/`（`system.bundle.js` / `cocos-js/cc.js` / `chunks/*` / `settings.json` / `import-map.json`）、`assets/main`、`assets/res`、`jsb-adapter/engine-adapter.js` | 能，`game.restart()` 生效 |
  | L2 模块 bundle | 各功能模块 Asset Bundle | 能，可不重启（[[adr-0010]]），且**按需分包更新**（[[adr-0013]]，见下） |

  `web-adapter.js` 是 `platforms/native/builtin/index.js` 的打包产物：jsb 命名空间与 native 引用管理、DOM/BOM 垫片、`XMLHttpRequest`/`WebSocket`、**`localStorage`**、`setTimeout`/rAF、Promise polyfill、`jsb.fileUtils` 单例。落到实处的影响：
  - 定时器 / Promise polyfill / DOM 垫片 / 音频 / 输入 / `jsb.WebSocket`（本仓 net 层就架在它上面）出问题，**热更修不了**。
  - **循环依赖**：`apply()` 靠 `localStorage` 存搜索路径，而 `localStorage` 实现本身在 L0 —— 存档机制自己不可热更。
  - **`main.js` 在 L0**：热更包里放新 `main.js` 无效（下了也不会被加载）。`cck-manifest` 默认只收 `src`/`assets`/`jsb-adapter` 三个子目录、根级 `main.js` 天然在外，这条恰好是对的；但 `jsb-adapter` 目录里 **`web-adapter.js`（~170KB）被收进 manifest 是死重量**——它属 L0，下载了也不会被用（`engine-adapter.js` 属 L1，收它有效）。
  - `cc.js` 属 L1 **能**被换，但它与 L0 的 `.so` 是配套的（jsb 绑定签名要对齐）→ **热更包必须由与线上包同一 Creator 版本、同一引擎裁剪配置构建产出**，跨版本换 `cc.js` 会崩在绑定层。这比 `coreApiHash` 闸挡的东西更底层，闸目前不覆盖。
  - 逃生口（**未验证**）：`native/engine/common/Classes/Game.cpp` 是项目文件且在 `BaseGame::init()` 之前跑，理论上可在那里先 `FileUtils::setSearchPaths` 把 L0 也纳入热更；但要先确认 `CocosApplication::init()` 会不会重置搜索路径，且引入它本身仍需发一次版。
- **native 分包更新（一 bundle 一 manifest，[[adr-0013]]）**：base 与模块是**两个独立更新目标**。

  | | base（AOT 层） | 模块 bundle |
  |---|---|---|
  | manifest | `project.manifest`（`src/` + `jsb-adapter/` + `assets/{main,internal,resources}`） | `<bundle>.manifest`（该 bundle 一份，`cck-manifest --split` 产出） |
  | storagePath | `<writable>cck-remote-asset/` | `<writable>cck-bundle-asset/<bundle>/`（并列不嵌套） |
  | 触发时机 | 启动期 `HotUpdateService.check/update` | `BundleManager.load(name)` 之前，经 `BundleUpdater.ensureLatest` |
  | 生效 | `game.restart()` | **免重启**——模块此刻尚未加载 |
  | 启动还原 | **必需**（`build-templates/native/index.ejs` 读 localStorage） | **不需要** |

  模块不需要启动还原，是因为 `AssetsManagerEx` 在 `create()`（`prepareLocalManifest → Manifest::prependSearchPaths`）与 `updateSucceed()` 第 4–5 步都会**自行** `prependSearchPaths` —— 冷启动只要在 `loadBundle` 前造一次 AssetsManager 就够了。base 则绕不开：造 AssetsManager 的代码自己就在 `assets/main/index.js` 里，鸡生蛋。

  **搜索路径由 C++ 负责生效，`apply()` 只负责归一化与持久化**。`updateSucceed` 第 7 步才 `dispatchUpdateEvent(UPDATE_FINISHED)`（= `download()` 的 resolve 点），前插在第 5 步 —— promise 兑现时路径早已生效，再 unshift 就是重复条目。`apply()` 保留的那次 `setSearchPaths` 不能省：它顺带 `_fullPathCache.clear()`，而 `prependSearchPaths` 在路径已存在时不会调它 —— 同一 bundle 第二次更新若**删掉**了某文件，旧解析结果会一直缓存在 `_fullPathCache` 里，既解析不到也不回退包内那份。（C++ 的 `purgeCachedEntries()` **无 JS 绑定**，`setSearchPaths` 是它的超集，不必改引擎。）

  **一 bundle 一 storagePath 是硬约束**：`_cacheManifestPath = _storagePath + MANIFEST_FILENAME` 而 `MANIFEST_FILENAME` 硬编码为 `"project.manifest"` —— 共用目录 = 各 bundle 缓存 manifest 互相覆盖。真机上 `cck-bundle-asset/shop/` 里那份缓存文件确实叫 `project.manifest`，尽管远端叫 `shop.manifest`。

  **各 bundle 的版本节奏由内容决定**：`cck-manifest --split --prev <上次发布目录>` 只给内容真变了的包涨版本号，没动的包沿用旧号（见 [[hot-update-manifest]]）。客户端那边没动的包直接 `ALREADY_UP_TO_DATE`，不再空跑一轮「下载 0 个文件」。版本号仍单调递增，因此不碰引擎默认的 `cmpVersion`——它先 `sscanf("%d.%d.%d.%d")` 逐段比，**任一侧解析不出数字才退化成 `strcmp`**。这条排除了「直接拿内容 hash 当版本号」的路：纯 hash 若以数字开头（`03cb…`）会被 sscanf 吃成 `3`、与 `03aa…` 判等而永不更新；即使加前缀强制走 `strcmp`，字典序也不单调，约一半的发版会被判成 up-to-date 而静默丢失。

  **已下线模块的目录回收**：`pruneCcBundleStorage(keep)` 启动时对账一次，删掉 `cck-bundle-asset/` 下不在名单里的目录。单个 bundle 内的旧文件由 `AssetsManagerEx::updateSucceed` 按 diff 删，这里只管**整包下线**的残留。`keep` 由 app 给——native 侧没有权威来源可查「远端还发不发」，删错了下次 `load` 只能退回包内旧版本。名单为空会清光整个根。
  真机上存储根里除了 `<bundle>/` 还并排躺着 `<bundle>_temp/`（`_tempStoragePath` = storagePath 去尾斜杠 + `TEMP_PACKAGE_SUFFIX`），它是断点续传状态，归对应 bundle 管、不能单独删。

- **Web**：无 jsb；`assetManager.loadBundle(url, {version})` 换 bundle 版本即“热更”；主包/AOT 不可换（刷页面加载新 index）。
- **小游戏**：各家分包/远程包机制，资源/子包远程版本化；主包更新走平台审核。
- **AOT 缺代码防护**：版本闸 `coreApiHash`/`minAppVersion` 是运行时兜底；配套出包期打戳/校验脚本（tools 层，见 Open Questions）是另一半。跨 bundle 服务走全局 token（[[adr-0001]]）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；spy `IHotUpdateBackend`（可设 check 结果 / 各阶段抛错 / emit 进度 / 记 restart）+ 默认或自定义 gate + fake logger。
- **用例清单**（已实现，25 用例）：
  - `version-gate`（11）：compareVersion 逐段数字/相等/补 0/大小/非数字容错；默认闸 minAppVersion 拒+放行、coreApiHash 都有且不等拒/相等放行/单边缺放行/无声明放行。
  - `hotupdate-service`（14+）：check up-to-date / 新版+闸放行(记 info) / 新版+闸拒(needFullUpdate) / check 抛错(failed+告警) / 自定义 gate override；update 全流程(进度+状态流转) / 非法状态 skipped / download 失败(retryable+重试转 ready) / apply 失败 / 无 onProgress；restart 委托；DI 回退空后端 / getHotUpdateService 单例 / register 覆盖 / tryResolve(BACKEND)；gate 裸 {ok:false} 走默认兜底；空后端全 no-op。

## Open Questions（已决议 · 2026-07-28）

1. **瘦 core 半 / 钩子+安全默认 / 三平台抽象先实 native**：✅（用户定）。
2. **出包期打戳/校验脚本（tools 层）— 版本兼容的另一半**：✅ **已实现**（2026-07-29，见 [[compat-stamp]]）。运行时闸只**执行**比对，`coreApiHash`/`minAppVersion` 的**产生**在出包期，落在 tools 的 `compat-stamp`：**打戳**（`computeCoreApiHash` 读 core rolled-up d.ts 算 API 表面 hash + `writeStamp` 造 app 戳/更新戳）+ **出包期主动校验**（`verifyCompat` 同 core gate 语义、shift-left CI、`cck-manifest verify-compat` 退出非 0 拦不兼容）。本 core 半 `coreApiHash`/`minAppVersion` 字段即对接点，设计不变。**首版 hash 级**（表面变没变）；符号级深校验（精确到引用了哪个被裁符号）与「戳的运行时读入」（engine 侧 backend 透传 coreApiHash——现 native backend 尚未透传、闸对该字段暂休眠）为下游后续。见横评「五·补」。
3. 淡入/断点续传/多补丁排队：backend 内部或后续；core 状态机不涉。
4. `coreApiHash` 单边缺失时放行（无法证伪不阻断）：文档标注；需严格模式可自定义 gate。

---

## 实现记录

- **落地文件**：`packages/core/src/hotupdate/version-gate.ts`（`UpdateInfo`/`AppInfo`/`GateResult`/`VersionGate` + `compareVersion` + `createSemverVersionGate`）、`hotupdate-backend.ts`（`CheckResult`/`HotUpdateProgress`/`IHotUpdateBackend` + `HOTUPDATE_BACKEND` + `createMemoryHotUpdateBackend`）、`hotupdate-service.ts`（`createHotUpdateService` + 状态机/`CheckOutcome`/`UpdateOutcome` + `HOTUPDATE_SERVICE` + `getHotUpdateService`）、`index.ts`；core `index.ts` re-export（第 3 批起始 `export * from './hotupdate'`）。
- **最终 API 与设计偏差**：无偏差，与定稿一致。`compareVersion` 首版按纯数字段（忽略 pre-release/build 元数据，非数字段容错为 0），需要时再引 semver 库。
- **测试结果 / 覆盖率**：`version-gate.test.ts` 11 + `hotupdate-service.test.ts` 14（含空后端/裸闸兜底补测）= **25 用例全绿**；`version-gate.ts`、`hotupdate-backend.ts`、`hotupdate-service.ts`、`index.ts` 均 **100% Stmts/Branch/Funcs/Lines**（全量 298 passed）。
- **commit / PR**：待提交。
- **遗留 Minors**：engine 侧 native 后端已实现（见下）；Web/小游戏远程 bundle backend 随需；**出包期 tools 脚本**（打戳 + 主动校验，见 Open Questions #2）待 tools 包搭建；退避重试/断点续传留后续。

### engine 半适配（native.AssetsManager 后端，2026-07-28）

- **落地文件**：`packages/engine/src/hotupdate-backend.ts`——`createCcHotUpdateBackend(opts)`（`IHotUpdateBackend` 的 native 实现）+ `ccHotUpdateModule(opts)`（`sys.isNative` 守门注册 `HOTUPDATE_BACKEND`）+ `CcHotUpdateOptions`；engine `index.ts` 导出。
- **实现**：包 `native.AssetsManager`（原 `jsb.AssetsManager`，Cocos 3.x 迁入 `native` 命名空间）。`AssetsManager` 只有单事件回调，故 check/download 各把当前分派器挂到 `handler`、用完即卸（单回调多路复用）：
  - `check()` → `checkUpdate()`，事件 `ALREADY_UP_TO_DATE`→`up-to-date` / `NEW_VERSION_FOUND`→`new-version`（`info.version=getRemoteManifest().getVersion()`，`totalBytes=getTotalBytes()`）/ `ERROR_*_MANIFEST`→reject。
  - `download(onProgress)` → `update()`，`UPDATE_PROGRESSION`→桥 `{bytesDone/bytesTotal/filesDone/filesTotal}` / `UPDATE_FINISHED`→resolve / `UPDATE_FAILED·ERROR_UPDATING·ERROR_DECOMPRESS`→reject。
  - `apply()` → 新资源搜索路径置顶（`getSearchPaths().unshift(...getLocalManifest().getSearchPaths())`）+ 持久化 `localStorage[searchPathsKey]` + `setSearchPaths`。
  - `restart()` → `game.restart()`。
- **守门**：`ccHotUpdateModule` 用 `sys.isNative`——**仅原生注册真后端**；web/编辑器预览下 `native.AssetsManager` 为 undefined，故 no-op，core 回退空后端（恒 up-to-date），保证预览不崩。
- **⚠️ native 集成步骤（本 npm 包管不到、须在原生工程侧手动做）**：
  1. **启动还原**：放 `apps/<项目>/build-templates/native/index.ejs`（Creator 3.8 官方的原生模板覆盖点，android/ios/windows 共用一份；`data/main.js` 就是它渲染出来的），在**任何 `require` 之前**读 `localStorage[searchPathsKey]`（默认键 `'HotUpdateSearchPaths'`，对齐官方模板）→ `setSearchPaths`。**别改构建产物 `data/main.js`**——每次构建重新渲染，改了必被覆盖。**冷启动（进程被杀）必需**；`game.restart()` 同进程热重启因 `apply()` 已在内存 `setSearchPaths`，不还原也能加载新版本，所以漏了这步很难当场发现。本仓样例：`apps/demo/build-templates/native/index.ejs`（2026-08-05 android 构建实测生效）。
  2. **manifest 产物**：`project.manifest` / `version.manifest`（远程 URL + 版本 + 文件 md5）由 tools 出包期生成（后置模块）。
- **类型策略**：官方 `@cocos/creator-types@3.8.7` 的 `native.AssetsManager`/`native.EventAssetsManager`/`native.fileUtils` 真类型（ADR-0005），无 ambient hack。
- **验证**：四门全绿；**真机 gameView 预览已验证**（web 侧守门 + 回退）：`sys.isNative=false → HOTUPDATE_BACKEND registered=false` + `HotUpdateService.check()={"kind":"up-to-date"}`（守门 no-op 正确、空后端回退正确、web 下触碰 `native.AssetsManager` 不崩）。

### native 真机 e2e 验证（2026-08-05，真 Android APK · PASS）

**完整热更闭环在真 x86_64 Android 模拟器上跑通**——同一 APK 内 `BUILD_TAG` 从 `v1` 跃迁到 `v2`，且**杀进程冷启动后仍是 v2**，铁证下载来的新代码接管：

```
BUILD_TAG = v1                    ← 首启，APK 内置 v1 代码（PID 6157）
app 戳读入 → appVersion=1.0.0 coreApiHash=03cb152c725e（闸已激活）
check() = {"kind":"update-available","info":{"version":"1.0.1","totalBytes":53898,"coreApiHash":"03cb152c725e"}}
⏳ 下载 → 53898/53898 字节（1 文件：assets/main/index.js）
update() = {"kind":"ready"}
BUILD_TAG = v2                    ← game.restart() 同进程热重启（PID 6157 不变）后，v2 代码接管

am force-stop → 冷启动（PID 6321，全新进程）
BUILD_TAG = v2                    ← 只可能来自 main.js 的启动还原（见步骤 2）
check() = {"kind":"up-to-date"}   ← 本地 manifest 已是 1.0.1，读的是可写路径那份
断开托管后再冷启动（PID 6551）：BUILD_TAG 仍 = v2，check() 优雅 error 不崩 —— 排除「其实是又下了一遍」
```

冷启动这段是 `game.restart()` 验不到的：热重启时内存里的 `setSearchPaths` 还在，漏掉启动还原也照样加载新版本。

**已验证的 native 集成步骤（落实上文「⚠️ native 集成步骤」，可复现）**：

1. **manifestUrl 解析**：`ccHotUpdateModule({ manifestUrl: 'project.manifest' })` 传裸文件名即可——把 `project.manifest` 放构建产物 `data/` 根（APK 内 `assets/` 根，是默认搜索路径），`native.AssetsManager.create('project.manifest', …)` 经 fileUtils 直接解析到。**比官方「导入 `.manifest` 资产取 `nativeUrl`」更省**，因 data 根本就是搜索路径。
2. **main.js 启动还原**：源在 `apps/demo/build-templates/native/index.ejs`，构建时渲染进 `build/android/data/main.js` 顶部——引擎/资源加载前读 `localStorage['HotUpdateSearchPaths']` → `jsb.fileUtils.setSearchPaths(...)` + 官方那段 `_temp/` 断点修复。键须与 backend `searchPathsKey`（默认 `'HotUpdateSearchPaths'`）一致。**冷启动必需**；`game.restart()` 热重启因 apply() 已在内存 `setSearchPaths`，同进程内即便不还原也能加载 v2，但冷启动（进程被杀）只靠这段。
   > 平台目录是 **`native` 不是 `android`**，也不带 `data/` 那层（原生三平台共用一份模板）。构建实测：渲染出的 `data/main.js` 4112 字节（默认模板 840 字节），注入块在最顶、`<%= systemJsBundleFile %>` 等占位符正常渲染；由该模板打出的 APK 冷启动直接进 v2（上文 PID 6321/6551 两次）。ADR-0006 决策 5 当初写的 `build-templates/android/data/main.js` 路径是错的，见该 ADR 文末修正。
3. **manifest 产物**：`cck-manifest`（tools 半）对 `build/android/data` 生成 `project.manifest`/`version.manifest`——默认走 `src/assets/jsb-adapter` 三子目录（根级 main.js/manifest 自身不纳入，无自引用）；v1 打 `version 1.0.0` 烘进 APK，v2 改一处代码重构建后打 `1.0.1` + 同 `packageUrl` 托管远端。AssetsManager 按 md5 差量：仅变更的 `assets/main/index.js`（md5 `e815…`→`9c40…`）被下载。
4. **远端托管**：宿主起 http server，模拟器经 `10.0.2.2:<port>`（user-net 网关映射宿主 loopback）直连，免 CDN/鉴权。Cocos 3.8 android 模板 `AndroidManifest.xml` 默认 `android:usesCleartextTraffic="true"`，HTTP 明文开箱可用。
5. **原生构建**：Creator 3.8.7 经 builder `add-task` 消息程序化触发（复用运行中的编辑器，无锁冲突），NDK/SDK/JDK 路径直填任务 options（`sdkPath`/`ndkPath`/`javaHome`）绕开偏好设置；ABI 选 **x86_64**（对齐 x86_64 模拟器，原生跑不靠 ARM 转译，Cocos 3.8 支持）；产物 gradle 工程 `gradlew assembleDebug` 编 APK。详见 [[adr-0006]]。

至此「三种热」之**线上热更**在 native 真机端到端闭环验证完成（Web/小游戏远程 bundle backend 仍随需再接）。

### 分包更新 e2e（2026-08-05，真 Android APK · PASS）

干净安装（先 `adb uninstall`），远端 base 停在 1.0.0（与包内 manifest **md5 完全一致**）、只有 `shop.manifest` 提到 1.0.1：

```
BUILD_TAG = v1                            ← AOT 代码全程没换
app 戳读入 appVersion=1.0.0 coreApiHash=03cb152c725e
HOTUPDATE_BACKEND_FACTORY registered = true
HotUpdateService.check() = up-to-date      ← base 无更新 → 不触发 restart
bundle 'shop' 更新 1/1 文件 · 271 字节     ← BundleManager.load 前自动更新，只下那一个变更文件
SHOP_TAG = v2                              ← 免重启读到新内容

am force-stop 冷启动（服务端在）  → SHOP_TAG = v2，base check up-to-date
断开托管后再冷启动               → SHOP_TAG = v2，check 优雅 error 不崩
```

最后一次是关键判据：`localStorage` 里**确无** `HotUpdateSearchPaths`（base 从未更新过，模块的 apply 不写），v2 只可能来自 `create()` 时 C++ 的 `prependSearchPaths`。设备落盘形态也与设计一致——`cck-bundle-asset/shop/{project.manifest, assets/shop/import/…}`，与 `cck-remote-asset/` 并列。全程无 FATAL / native signal。

### 逐包版本节奏 + 下线目录回收 e2e（2026-08-05，真 Android APK · PASS）

分包热更遗留的两个口子一并收掉。设备上先手植一个"已下线"包（`cck-bundle-asset/arena/` + `arena_temp/`，chown 成 app uid），远端用 `--prev`（基线 = 从已装 APK 里解出来的那批包内 manifest）重算：

```
base manifest        22 个资源 → 1.0.1              ← DemoBoot 改了，自动涨
fixtures-bundle/lobby/mini-clicker/mini-dodge/shared → 1.0.0（内容未变，沿用旧版本）
shop                 6 个资源 → 1.0.1              ← 只有它真变了
```

5/6 个模块包与包内 manifest **逐字节一致**，顺带证明 Creator 构建对未改内容是可复现的——`--prev` 这条路成立的前提。

设备端（base 1.0.0 → 1.0.1 只下 2/22 个文件，`game.restart()` 后新 JS 生效）：

```
🧹 回收已下线 bundle 目录 2 个：…/cck-bundle-asset/arena/, …/cck-bundle-asset/arena_temp/
HotUpdateService.check() = up-to-date      ← 重启后
SHOP_TAG = v2                              ← shop/ 与 shop_temp/ 未被误删
再 force-stop 冷启动 → 回收 0 个，SHOP_TAG = v2   ← 幂等
```

`shop_temp/` 在 up-to-date 后消失，是 `AssetsManagerEx::loadRemoteManifest` 自己 `removeDirectory(_tempStoragePath)` 清的，不是回收删的。全程无 FATAL / native signal。

### 热更新增 bundle 的自愈：种子 manifest（2026-08-17，真 Android APK · PASS）

分包热更此前有个只在「**热更改了配置、指向一个从没随包发过的 bundle**」时才暴露的缺口。demo 的真实
触发路径：base 热更把 `settings.cck.vest` 翻成另一个马甲 → 重启 → 启动预载列表变成
`['shared', 'skin-vest-foundation']`，而这个皮包是发版之后才加的。

病根不在配置，在**引导**：`<bundle>.manifest` 躺在构建产物 `data/` 根，而 manifest 只遍历
`src|assets|jsb-adapter` → **它自己不进任何 asset 表、永远不会被热更下发**。包内没有 + 热更带不来
= `AssetsManagerEx` 连去哪查更新都不知道。补法见 [[adr-0013]] 补充（内存种子，`version` 恒 `0.0.0`）。

同时补上的还有**注册**：`BUNDLE_UPDATER` 此前只在 `probes/DemoBoot.ts` 里注册过，正式启动路径
（`boot/Bootstrap.ts`）从未注册 → **加载前更新整条链在正式路径上是关的**，任何 bundle 都不会更新。
现在挂在 `dispatch` 阶段的项目步骤里（那里 `APP_INFO` 与握手结果都已就位，且早于最早的 `load()`）。

**实证**（真 x86_64 模拟器，干净安装，APK 里不含 `skin-vest-*`）：

```
skin='base'  → hotupdate 25→100% → restart
skin='vest'  → shared 步 load('skin-vest-foundation')
             ⏳ 更新 0/3 → 1/3 → 2/3 → 3/3 文件      ← 包内无 manifest，走种子全量下
             启动阶段 → shared 0% → 100%              ← 启动界面按段插值，不再是静止的「加载公共资源…」
force-stop 冷启动 → 只发 4 个 *.version.manifest 探测，**一个资源文件都没重下**
```

最后一行是 `version: '0.0.0'` 那条约束的判据：种子恒最旧 → `loadLocalManifest` 让
`<storagePath>/project.manifest`（上次下载落的真 manifest）接管 → 第二次起是增量而不是每次全量重下。

**内容基址由服务端下发**：所有更新目标（base 与每个分包）`check()` 时都**自己把 remote manifest
拉下来、改掉三个地址字段、经 `loadRemoteManifest()` 灌回引擎**，基址取 dispatcher 握手的 `cdn_url`
（`CcHotUpdateOptions.cdnUrl`）。于是换 CDN / 灰度分流 / 把内容挪去另一个域名，都只改服务端配置、
不必发新包。拉不到、拉回来不是 JSON、引擎不收（状态已越过 `UNCHECKED`）——任一情形都退回
`checkUpdate()` 老路，用包内烘的地址试一次，并打一行 warn（两条路的产物一模一样，不打日志就无从
判断走的是哪条）。「为什么灌 remote 不灌 local」见 [[adr-0013]] 补充。

⚠️ **配 CDN 基址时 `200` 不等于拿到文件，要看 `Content-Type`。** 本机 filebrowser 只在
`/api/public/dl/<hash>/` 下发文件，其它路径一律回 SPA 首页 + `200 text/html` → 客户端「下载成功」
拿到一坨 HTML，直到解析才炸。dispatcher 当前配的 `http://172.25.50.135:8081/cdn/` 正是这个形态
（[server-core-kit#1](https://hlgit.5518game.com/luohao/server-core-kit/-/issues/1)，改那个文件属别的仓）；
正确值是固定分享 `http://172.25.50.135:8081/api/public/dl/shCo8WNE/`。

**实证 PASS**（2026-08-18，真 x86_64 模拟器，干净安装）。判据做成二值的：**APK 与 CDN 上所有 manifest 的
`packageUrl` 全烘成死地址 `http://127.0.0.1:9/dead/`**，全局唯一的活地址是握手下发的 `cdn_url` ——
能下载成功就只可能来自运行时改写。

```
dispatcher 放行：cdn=http://172.25.50.135:8081/api/public/dl/shCo8WNE/
[cck] project.manifest 基址取服务端下发：…/shCo8WNE/     ← base 走注入路
启动阶段 → hotupdate 37% → 100% → restart
马甲皮 → skin='vest'                                     ← 热更下来的 settings 接管
[cck] shared.manifest / skin-vest-foundation.manifest / foundation.manifest 基址取服务端下发：…
【force-stop 冷启动】skin='vest'，四个包全走注入路，零重下
```

对照组同样明确：**同一份死地址内容 + 改动前的 engine** → `热更检查失败:
java.net.ConnectException: Failed to connect to /127.0.0.1:9`。该轮 `cdn_url` 由本机假 dispatcher 下发
（真的那台配的仍是上面那个错形态的值）。

> ⚠️ 这一程**没跑到大厅**：`demo-foundation` 步的长连接 `10s 未就绪（停在 reconnecting）：
> ws://172.25.50.20:9101/ws`。同一失败在 `skin='base'` 下同样复现（与皮包、与本次改动无关），
> 网关从宿主机 `/healthz` 200、WS 升级 101 都正常，模拟器到 9101 的 TCP 也通 —— 是模拟器侧
> WS 握手/重连的独立问题，另查。顺带把 `Bootstrap` 的失败日志摊平成一行：Cocos native 转发
> JS console 到 logcat 时对象参数一律打成 `[object Object]`，真机上唯一的失败信息不能是这个。

### coreApiHash 版本闸激活（戳的运行时读入，2026-07-29 · 真机 e2e PASS）

此前版本闸的 `coreApiHash` 比对**休眠**（`AppInfo`/`UpdateInfo` 都缺该字段 → 单边缺失恒放行）。补齐**读入侧**（详见 [[adr-0007]] + tools [[compat-stamp]]）后，闸首次端到端生效：

- **app 侧**：app 戳 `resources/cck-app-compat.json`（`cck-manifest stamp` 出的 `{version, coreApiHash}`）→ 启动时 `AssetLoader` 读 → `createHotUpdateService({app:{appVersion, coreApiHash}})` 注册覆盖默认（缺戳退回 `0.0.0`、闸休眠不阻断）。
- **update 侧**：engine native backend `check()` 在发现新版本时经 `am.getRemoteManifest().getPackageUrl() + compatFilename`（`CcHotUpdateOptions.compatFilename` opt-in）拉更新戳 sidecar `cck-update-compat.json` → 把 `coreApiHash`/`minAppVersion` 并进 `UpdateInfo`（`native.AssetsManager` 的 Manifest 绑定不透传自定义字段，故走旁挂 sidecar；拉不到降级放行、不阻断正常热更）。

**同一 v1 APK 二分实证**（真 x86_64 模拟器，远端经 filebrowser 固定链接托管）：
```
兼容   远端戳 coreApiHash = app 侧(fc033ce4c4a7) → check()=update-available(info.coreApiHash 已并入) → 下 v2 → restart → BUILD_TAG=v2
不兼容 远端戳 coreApiHash 改 deadbeefcafe(≠app)   → check()=rejected,reason='core API 不兼容',needFullUpdate=true → 不下载/不重启，停 v1
```
闸的放行/拦截仅由远端戳 coreApiHash 决定 → ADR-0001 的 AOT 缺代码防护从「运行时兜底字段」变为**出包期打戳 → 运行时读入 → check 阶段拦截**的完整闭环。
