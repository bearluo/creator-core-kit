---
模块: hotupdate-service
所在包: packages/core（更新状态机 + 版本闸策略 + 内存 fake，零 cc）；native.AssetsManager / game.restart 的 native 后端已实现（见文末 engine 半适配）；Web·小游戏远程 bundle 版本化后续
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 线上热更统一入口 createHotUpdateService——check → 版本兼容闸 → download(进度) → apply → restart，三平台一个 API。core 持更新状态机 + VersionGate 兼容策略（默认 semver 安全闸、可 override，承 ADR-0001 防 主包裁剪缺代码），平台 IO 经 IHotUpdateBackend 下沉 engine（native jsb.AssetsManager / Web·小游戏远程 bundle）。
何时读: 需要线上补丁下载/版本校验/热更 UI 状态/失败重试，或为某平台接热更后端时。
日期: 2026-07-28
依赖: di（HOTUPDATE_BACKEND/HOTUPDATE_SERVICE token）、logger（告警）、[[adr-0001]]（主包裁剪缺代码 → 版本绑定）。IHotUpdateBackend 的平台适配走 engine（后续）；出包期打戳/校验（coreApiHash/minAppVersion 的产生侧）走 packages/tools 的 [[compat-stamp]]（已实现）。横评见 docs/research/2026-07-28-hotupdate-survey.md。
---

# HotUpdateService（线上热更统一入口）设计文档

## TL;DR

`createHotUpdateService({ backend?, gate?, app?, logger? })` 返回 `HotUpdateService`：`check()` 拉远程版本头比版本 → 过**版本兼容闸** → `up-to-date | update-available | rejected(needFullUpdate) | error`；`update(onProgress?)` 下载差量 + 应用 → `ready(待 restart) | failed(retryable) | skipped`；`restart()` 重启生效。三平台（native/Web/小游戏）一个 API，平台差异经 `IHotUpdateBackend`（`check/download/apply/restart`）下沉 engine。**版本闸 = 钩子 + 安全默认**（用户定 2026-07-28）：core 定 `VersionGate` 接缝 + 默认 `createSemverVersionGate`（`minAppVersion` + 可选 `coreApiHash` 比对，承 ADR-0001 防 主包裁剪缺代码崩），零配置即安全，可注入自定义 gate 做灰度/强更。**core 零 cc**：状态机 + 版本策略 + 内存 fake 全可 node 单测。

## 这份文档管什么（与接入方装配文档的分工）

热更这件事横跨 kit 与接入方工程，两边各有一份文档，**判据是「换一个接入方工程，它要不要改」**：

| | 本文档（随 `@cck/core` 发布） | 接入方工程的装配文档 |
|---|---|---|
| 回答 | 这个服务**是什么、怎么用、平台上受什么硬约束** | **这个工程**怎么把它装起来 |
| 内容 | API 签名 · 状态机 · 闸策略 · `IHotUpdateBackend` 契约 · 各平台机制与坑 · 接入方必做项 | 具体 bundle 名与目录 · 出包脚本 · 发版与回滚命令 · CDN 选型 · 该工程的真机实证 |
| 判据 | **换一个工程，这里一个字都不用改** | 换一个工程，这里基本要重写 |
| 举例 | 一律用占位（`<bundle>` / `<你的工程>/…`），真样例只给指针 | 用真名真路径 |

本仓的样例接入方是 demo，装配细节见 `apps/demo/docs/hotupdate-pipeline.md`；
逐次真机 e2e 的**实录属编年史**，在 `docs/progress.md`，两份现状文档都不留流水账。

## Purpose（目标与定位）

- **做什么**：把 CLAUDE.md「三种热」的**线上热更(hotfix)** 收敛为一个带**统一状态机 + 版本兼容闸 + 进度/重试**的入口。（另两热：运行时按需分包归 [[bundle-manager]]；开发期热重载走 vitest watch，非本模块。）
- **定位/取舍**：**瘦 core 半 + engine backend**（用户定 2026-07-28，横评候选 A）——core 持更新状态机、版本策略、失败重试语义（**可 node 单测**）；engine `IHotUpdateBackend` 做平台 IO：native 包 `jsb.AssetsManager`（checkUpdate/update 事件 + setSearchPaths + game.restart），Web/小游戏包远程 Asset Bundle 版本化（`assetManager.loadBundle({version})`）。与 [[sceneflow]]（core 状态机 + engine 真切场景）同构。
- **版本闸为何「钩子 + 安全默认」**（用户定 2026-07-28）：ADR-0001 实证 主包裁剪缺代码会让热更包**跑到一半才崩**、线上难复现。纯钩子把安全变 opt-in（易漏），纯强制闸不够灵活。合一方案：`VersionGate` 接缝 + 默认安全 gate → **零配置即挡崩溃**，override 时才自担责，兼得灵活与安全，且默认策略是纯函数好测。
- **三平台抽象、先实 native backend**（用户定 2026-07-28）：`IHotUpdateBackend` 抽象覆盖三平台；engine 首版只实 native，Web/小游戏 backend 随需再接。core 半与测试不受平台影响。
- **YAGNI（首版砍）**：自动重试退避调度（`update` 可再调重试，重试**时机**交上层——AssetsManager 自带 downloadFailedAssets 续传）；断点续传细节（backend 内部事）；多补丁排队；下载限速。

## Public API（TypeScript 精确签名）

```ts
// —— 版本兼容闸（core，纯逻辑）——
export interface UpdateInfo { version: string; minAppVersion?: string; coreApiHash?: string; engineHash?: string; totalBytes?: number; }
export interface AppInfo { appVersion: string; coreApiHash?: string; engineHash?: string; }
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
  /** 本地 manifest（更新成功后 = 远端那份）的 asset key；喂 bundleVersionFromAssetKeys。可选。 */
  assetKeys?(): readonly string[];
}

// —— 内容寻址产物：该按哪个版本加载这个 bundle（纯字符串处理）——
/** 从 asset key 里认出 `assets/<bundle>/index.<v>.js` 的 `<v>`；认不出 → undefined（没开 md5Cache）。 */
export function bundleVersionFromAssetKeys(bundle: string, keys: readonly string[]): string | undefined;
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
- **与 cc 边界**：状态机/闸/内存 fake 全在 core（零 cc）。engine 实现 `IHotUpdateBackend`：native 用 `jsb.AssetsManager`（构造 manifestUrl+缓存路径、checkUpdate→CheckResult、update→事件转 HotUpdateProgress、setSearchPaths、game.restart）；Web/小游戏用远程 bundle 版本化。属**有状态引擎行为**，ADR-0002 不进 cc mock，走接入方工程的真机集成验证（本仓样例是 demo）。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | core/engine 拆分 | 纯 engine / **瘦 core 半 + engine backend** | **瘦 core 半**（用户定 2026-07-28） | 状态机/版本策略/重试脱 cc 可测；三平台一个 API |
| 2 | 版本兼容校验 | 强制闸 / 纯钩子 / **钩子 + 安全默认** | **钩子 + 安全默认**（用户定 2026-07-28） | 零配置即挡 主包裁剪缺代码崩（ADR-0001），override 可自定义灰度/强更 |
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
- **native 的更新边界（两条线切死：还原时机 + 谁的名字带 md5；2026-08-05 查证边界，2026-08-20 按真实产物细分）**：C++ `BaseGame::init()` 依次 `runScript("jsb-adapter/web-adapter.js")` → `runScript("main.js")`，两者都用**默认搜索路径**解析，而还原逻辑就写在 `main.js` 里。还原之后仍有东西换不了。落到发版上只有三档代价：

  | 代价 | 改到了什么 | 怎么下去 |
  |---|---|---|
  | **只能发 APK** | 见下表三类 | **发不出去**：`cck-manifest` 的 `isEngineBound` 把它们剔出 base manifest；万一从别的路子混进来，客户端的**引擎指纹闸**（`engineHash`，按 `cc.<md5>.js` 取，见下）也拒收 |
  | **热更下发，重启生效**（base） | `application.<md5>.js` → `settings.<md5>.json` → `src/chunks/bundle.<md5>.js`、`assets/{main,resources,internal}` | `project.manifest` 一份，`game.restart()` 生效（[[adr-0017]]）。曾经的障碍是入口没有固定名；现在 `main.js` 改读固定名指针 `src/cck-base.json`，而那段跑在搜索路径还原**之后** |
  | **热更下发，不用重启** | 各功能模块 Asset Bundle | 各自 `<bundle>.manifest`（[[adr-0010]]），加载前按需更新（[[adr-0013]]，见下） |

  「只能发 APK」那一档里有三类，理由各不相同：

  | 这一类 | 具体是谁 | 为什么解不开 |
  |---|---|---|
  | **引擎的另一半** | `src/cocos-js/cc.<md5>.js`、`jsb-adapter/engine-adapter.js`、`src/effect.bin` | 与 `.so` 是同一次引擎构建的两半，换 JS 不换 `.so` 崩在绑定层。`effect.bin` 另有一层：**固定名无 md5**，下发会破坏内容寻址 |
  | **启动器自己，和跑在它之前的** | `libcocos.so`（引擎 C++ + jsb 绑定）、`jsb-adapter/web-adapter.js`、**`main.js` 自身** | 跑在搜索路径还原**之前**，而 `main.js` 就是那段还原 —— 下下来没人读 |
  | **名字烘死在启动器里的** | `src/system.bundle.<md5>.js`、`src/polyfills.<md5>.js`、`src/import-map.<md5>.json` | 纯 JS、与 `.so` 无关，但 `main.js` 里 `require` 的是字面量旧 md5 名，新文件下下来没人念。`import-map` 还兼任引擎身份凭据（`imports.cc`），**故意不解** |

  > 2026-08-20 之前的文档与 ADR 把这几档记作 `L0` / `L1-E` / `L1-N` / `L1-A` / `L2`：
  > `L0` + `L1-E` + `L1-N` = 只能发 APK，`L1-A` = base，`L2` = 模块 bundle。

  **base 入口指针**（base 能热更的全部机关）：`main.js` 里 `System.import(applicationJs)` 的那个名字不再是构建期插值，而是运行时读 `src/cck-base.json` 的 `application` 字段得来 —— 热更目录里有新的就命中新的，读不到 / 坏了 / 指向的文件不存在就退回包内那份（黑屏是最坏结果，退回还能起来）。同一段模板还把包内烘的名字挂成 `window.__cckBaseEntry`，那是 `packagedBaseEntry()` / `baseStamp()` 判「APK 换没换」的唯一不可伪造来源。

  `web-adapter.js` 是 `platforms/native/builtin/index.js` 的打包产物：jsb 命名空间与 native 引用管理、DOM/BOM 垫片、`XMLHttpRequest`/`WebSocket`、**`localStorage`**、`setTimeout`/rAF、Promise polyfill、`jsb.fileUtils` 单例。落到实处的影响：
  - 定时器 / Promise polyfill / DOM 垫片 / 音频 / 输入 / `jsb.WebSocket`（本仓 net 层就架在它上面）出问题，**热更修不了**。
  - **循环依赖**：`apply()` 靠 `localStorage` 存搜索路径，而 `localStorage` 实现本身跑在还原之前 —— 存档机制自己不可热更。
  - **`main.js` 换不了**：热更包里放新 `main.js` 无效（下了也不会被加载）。`cck-manifest` 默认只遍历 `src`/`assets`/`jsb-adapter` 三个子目录，根级文件要靠 `--files` 显式点名（base 入口 `application.<md5>.js` 就是这么进去的）—— **`main.js` 永远不许出现在那份名单里**。`jsb-adapter/` 整目录则由 `--md5` 排除：`web-adapter.js`（~170KB）跑在还原之前、下了不会被用是死重量；`engine-adapter.js` 属引擎那一半，读得到，但换它不换 `.so` 会崩在绑定层。

    这一整类（`isEngineBound`）**连传都不往 CDN 传**：`cck-manifest deploy` 同步产物时按同一份规则把它们滤掉，`main.js` 也在内。它们没进任何 manifest、客户端永远不会去 CDN 取，整目录拷过去只是每次发布叠一份没人读的死重量（`src/cocos-js/` 一家就近 4MB）。
  - `cc.js` 属引擎那一半：机制上**能**被换，但它与 `.so` 是配套的（jsb 绑定签名要对齐）→ **热更包必须由与线上包同一 Creator 版本、同一引擎裁剪配置构建产出**，跨版本换 `cc.js` 会崩在绑定层。这比 `coreApiHash` 闸挡的东西更底层 —— 现由**引擎指纹闸**覆盖（`UpdateInfo.engineHash` vs `AppInfo.engineHash`，见下），且 `cc.js` 本身已被 `--md5` 排除出 base manifest、结构上也换不成了。
  - **`assets/internal` 结构上在 base 这一档，实践上跟引擎走**（2026-08-20 按 android 产物实测，两半都取到样本）：① 它的资源集合与 `settings.engine.builtinAssets` **双向完全相等**（各 20 项），由 Creator 的**引擎模块开关**决定而不是场景用了什么 —— demo 从没用过 spine，但 `spine`/`dragon-bones` 模块开着，`builtin-spine` + `default-spine-material` 照样进包；`3d` 关着，`builtin-standard` 就不在。② **工程引用的 `db://internal` 资源不进 internal**，走普通 bundle 归属规则（判给优先级最高的引用者）—— 那条规则会漂，见下一条。⇒ **internal 变 ⟺ 引擎模块变 ⟺ `cc.<md5>.js` 变 ⟺ 引擎指纹闸拦成整包更新**。它仍在 base manifest 里，但**成本为零**：引擎没变时它逐字节相同、不产生 diff；引擎变了整个更新已被闸拒成「发 APK」。留着它是为了让 `settings.bundleVers.internal` 指向的目录一定在本地。
  - **资源归属会漂，且漂了是静默的**：Creator 把被多包引用的资源判给**优先级最高**的引用者，其余包降级成 `cc.config` 的 `deps` + `redirect`。实测两种漂法都出过（2026-08-20，demo 产物）—— 共用图漂进 `main`（base，只随 APK 换 → 热更下去的包引用旧 APK 没有的 uuid，运行时炸），以及两个马甲的地基皮包同优先级抢同一张图，Creator 挑了 default 那个 → vest 的皮包依赖 default 马甲的包。**规则**：① 工程各处照常引用 `db://internal`，**不改引用**；② 在 `resources` 里放一份「钉子」资产，把用到的每个内置资源挂一个节点钉一次 —— `resources` 的 priority 8 是工程里最高的，归属被它吸走后谁也抢不动（样例与两道闸的用法见接入方装配文档）；③ 它们跟 base 同寿命 —— base 解锁后这意味着「加一张内置图要热更整个 base 并重启」，而不再是「发 APK」。`cck-manifest --split` 出 manifest 前会扫 `deps`/`redirect` 硬拦，见 [[hot-update-manifest]]。
  - **`src/effect.bin` 属引擎那一半**：5.7 KB zlib 解压出 256 KB，内容是 `cc_matView` / `cc_fogColor` 这类**引擎 UBO / descriptor 布局**，不含任何 effect 名、与工程内容无关，跟引擎构建走。它由 `settings.rendering.effectSettingsPath` 按**固定名**引用（唯一一个不带 md5 的 `src/` 文件）—— base 能热更之后它也**不下发**：跟引擎走是一条理由，同名文件覆盖会破坏内容寻址的 immutable 缓存是另一条。`isEngineBound` 里单列了它。
  - 逃生口（**未验证**）：`native/engine/common/Classes/Game.cpp` 是项目文件且在 `BaseGame::init()` 之前跑，理论上可在那里先 `FileUtils::setSearchPaths` 把启动器那一类也纳入热更；但要先确认 `CocosApplication::init()` 会不会重置搜索路径，且引入它本身仍需发一次版。
- **native 分包更新（一 bundle 一 manifest，[[adr-0013]]）**：base 与模块是**两个独立更新目标**。

  | | base（base 层） | 模块 bundle |
  |---|---|---|
  | manifest | `project.manifest`（内容寻址产物下装 **base 整条链**：入口 + 指针 + settings + chunks + `assets/{main,resources,internal}`；「只能发 APK」那三类一个都不发，见上表） | `<bundle>.manifest`（该 bundle 一份，`cck-manifest --split` 产出） |
  | storagePath | `<writable>cck-remote-asset/` | `<writable>cck-bundle-asset/<bundle>/`（并列不嵌套） |
  | 触发时机 | 启动期 `HotUpdateService.check/update` | `BundleManager.load(name)` 之前，经 `BundleUpdater.ensureLatest` |
  | 生效 | `game.restart()` | **免重启**——模块此刻尚未加载 |
  | 启动还原 | **必需**（`build-templates/native/index.ejs` 读 localStorage） | **不需要** |

  模块不需要启动还原，是因为 `AssetsManagerEx` 在 `create()`（`prepareLocalManifest → Manifest::prependSearchPaths`）与 `updateSucceed()` 第 4–5 步都会**自行** `prependSearchPaths` —— 冷启动只要在 `loadBundle` 前造一次 AssetsManager 就够了。base 则绕不开：造 AssetsManager 的代码自己就在 `assets/main/index.js` 里，鸡生蛋。

  **搜索路径由 C++ 负责生效，`apply()` 只负责归一化与持久化**。`updateSucceed` 第 7 步才 `dispatchUpdateEvent(UPDATE_FINISHED)`（= `download()` 的 resolve 点），前插在第 5 步 —— promise 兑现时路径早已生效，再 unshift 就是重复条目。`apply()` 保留的那次 `setSearchPaths` 不能省：它顺带 `_fullPathCache.clear()`，而 `prependSearchPaths` 在路径已存在时不会调它 —— 同一 bundle 第二次更新若**删掉**了某文件，旧解析结果会一直缓存在 `_fullPathCache` 里，既解析不到也不回退包内那份。（C++ 的 `purgeCachedEntries()` **无 JS 绑定**，`setSearchPaths` 是它的超集，不必改引擎。）

  **一 bundle 一 storagePath 是硬约束**：`_cacheManifestPath = _storagePath + MANIFEST_FILENAME` 而 `MANIFEST_FILENAME` 硬编码为 `"project.manifest"` —— 共用目录 = 各 bundle 缓存 manifest 互相覆盖。真机上 `cck-bundle-asset/shop/` 里那份缓存文件确实叫 `project.manifest`，尽管远端叫 `shop.manifest`。

  **各 bundle 的版本节奏由内容决定**：`cck-manifest --split --prev <上次发布目录>` 只给内容真变了的包涨版本号，没动的包沿用旧号（见 [[hot-update-manifest]]）。客户端那边没动的包直接 `ALREADY_UP_TO_DATE`，不再空跑一轮「下载 0 个文件」。版本号仍单调递增，因此不碰引擎默认的 `cmpVersion`——它先 `sscanf("%d.%d.%d.%d")` 逐段比，**任一侧解析不出数字才退化成 `strcmp`**。这条排除了「直接拿内容 hash 当版本号」的路：纯 hash 若以数字开头（`03cb…`）会被 sscanf 吃成 `3`、与 `03aa…` 判等而永不更新；即使加前缀强制走 `strcmp`，字典序也不单调，约一半的发版会被判成 up-to-date 而静默丢失。

  **包内 base 与缓存对不上就把热更缓存整个作废**（`resetCcHotUpdateOnAppChange()`，**须在 kit 装配之前调**）。两种触发：**APK 换了**（下述）与 **base 被启动看门狗隔离**（见下条）。引擎自带的那道——`loadLocalManifest` 用 `versionGreater(cached)` 比包内与缓存 manifest、包内更新就 `removeDirectory(storagePath)`（`AssetsManagerEx.cpp:213/287`）——**只在版本号纪律成立时有效**：装了更旧的包（商店回滚 / 手动装历史 apk / 渠道包互换）时包内号更小 → **缓存接管** → 旧 base 配着为新 base 编译的模块代码跑。而 `coreApiHash` 闸救不了这一场：缓存接管后 `check()` 判 `ALREADY_UP_TO_DATE`（缓存 = 远端），压根不去拉更新戳 sidecar。表现是「装完新包启动报错，清数据才好」。
  判据用**包内 base 入口的 md5**（`main.js` 挂上来的 `window.__cckBaseEntry` → `packagedBaseEntry()` → `baseStamp()`）而不是 app 戳的 `coreApiHash`：① 这一步必须早于 `AssetsManagerEx.create()`（一 create 就前插搜索路径），而 app 戳在 `resources` bundle 里要异步 load，那时还没到；② 口径更保守——`coreApiHash` 只描述 core 的 API 面，base 业务代码改了它不变，而热更下来的模块代码是对着整个 base 编译的。**不能用运行时 `settings.bundleVers`**：base 现在可热更，那个每更新一次就翻一次，会把刚下好的缓存当成「上一版 APK 的」删掉，死循环（[[adr-0017]] 决策 6）。**没开 `md5Cache` 时入口就叫 `application.js`、抠不出 md5 → 判不了 → 原样不动**（当成「换了」会让每次冷启动全量重下）。清理范围含 `<base>_temp/`（断点续传目录与 storagePath **平级**，留着会让下一轮更新从属于旧 APK 的半成品接着续）。

  **base 启动看门狗**（[[adr-0018]]）。三道指针兜底管的是「指针指不到东西」，管不了「指到了、文件也在、**但那份 base 起不来**」—— 那时 `System.import` 抛在 `main.js` 的 catch 里，而作废缓存的代码在 Bootstrap 里、**永远轮不到**。实测：连续冷启动逐字相同，**覆盖装另一个 APK 也救不了**，只有清应用数据。所以 `main.js` 每次「决定用热更 base」就把 `cck.baseTry` +1（**落盘在 `System.import` 之前**），`resetCcHotUpdateOnAppChange()` 跑到就清 0 —— 那是「这套 base 确实起得来」的握手；连续 2 次没清就**隔离**：不还原搜索路径、不认指针、跑包内 base，缓存由 `resetCcHotUpdateOnAppChange()` 真删（`AssetsManagerEx.create()` 会把 storagePath 前插回来，不删就是包内 base 配缓存里的新模块），它**删之前**先把那份缓存 manifest 的版本号记进 `cck.baseBadVersion` —— 读这一步只能在 engine 侧做，版本号所在的目录是可配的 `storagePath`，`main.js` 只够得着硬编码的键。之后 **base 的 `check()` 见到同号直接当 up-to-date**，否则「隔离 → 重下同一版 → 又隔离」三步一轮地振荡；见到别的号说明发布方已翻篇，顺手清掉标记。**只挡 base**（判据是 backend 有没有 `persistKey`，不是有没有 `seed` —— 随包发 manifest 的分包同样没有 seed）：base 与分包共用同一个 `--version`，拿它挡分包会把一批分包永久钉死在包内版本，而分包与包内 base 兼不兼容自有 `coreApiHash` 闸管。发布方发个新号即自动恢复。⚠️ `cck.baseTry` 的字面量在 `index.ejs` 与 `hotupdate-backend.ts` 里各写一份（`main.js` 跑在 SystemJS 之前），`build.mjs` 出包时对一次。

  **已下线模块的目录回收**：`pruneCcBundleStorage(keep)` 启动时对账一次，删掉 `cck-bundle-asset/` 下不在名单里的目录。单个 bundle 内的旧文件由 `AssetsManagerEx::updateSucceed` 按 diff 删，这里只管**整包下线**的残留。`keep` 由 app 给——native 侧没有权威来源可查「远端还发不发」，删错了下次 `load` 只能退回包内旧版本。名单为空会清光整个根。
  真机上存储根里除了 `<bundle>/` 还并排躺着 `<bundle>_temp/`（`_tempStoragePath` = storagePath 去尾斜杠 + `TEMP_PACKAGE_SUFFIX`），它是断点续传状态，归对应 bundle 管、不能单独删。

- **Web**：无 jsb；`assetManager.loadBundle(url, {version})` 换 bundle 版本即“热更”；主包/base 不可换（刷页面加载新 index）。
- **小游戏**：各家分包/远程包机制，资源/子包远程版本化；主包更新走平台审核。
- **引擎指纹闸**（`engineHash`）：两端都声明且不等 → 拒 + `needFullUpdate`。判据是 `cc.<md5>.js` 的那段 md5 —— 它与 `libcocos.so` 是同一次引擎构建的两半，业务代码怎么改都不动它（实测：三次业务重建 `cc.25e81.js` 纹丝不动，而 `settings`/`application` 各出了三个 md5）。

  **和 `coreApiHash` 挡的是两回事，不可互相替代**：后者只描述 `@cck/core` 的 API 面，换 Creator 版本或改引擎模块勾选时它一动不动，于是老包会照单全收为新引擎编的 JS，崩在绑定层。为什么用 `cc.js` 的 md5 而不是 hash `.so`：热更只下发 JS，要挡的是「热更来的 JS 用了这个引擎没有的 API」，对应的正是 `cc.js` 的接口面；`.so` 既要挑 ABI 又要分 debug/release，还读不出 JS API 面变没变。唯一漏网的是只改 `native/engine/` 的 C++ 而不动 JS —— 那种改动本来也只能发包。

  两端取值路径不同，各自都不可伪造：**app 一端**由 engine 的 `engineHash()` 运行时从 SystemJS import map 取（那份 map 属结构性不可热更的一层，热更改不动）；**更新一端**由 tools 的 `readEngineHash(dataRoot)` 出包期从产物 `src/import-map*.json` 读、写进更新戳 sidecar。app 戳文件里**没有**这个字段 —— 它生成于 Creator 构建之前，那时产物还不存在。

- **三个指纹管三件事，别混用**：`baseStamp`（包内 base 入口 md5）答「APK 换没换」，业务一改就翻，敏感是特性（`resetCcHotUpdateOnAppChange` 用它）；`coreApiHash` 答「core 的 API 面变没变」；`engineHash` 答「引擎换没换」。

- **主包裁剪缺代码防护**：版本闸 `coreApiHash`/`minAppVersion` 是运行时兜底；配套出包期打戳/校验脚本（tools 层，见 Open Questions）是另一半。跨 bundle 服务走全局 token（[[adr-0001]]）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；spy `IHotUpdateBackend`（可设 check 结果 / 各阶段抛错 / emit 进度 / 记 restart）+ 默认或自定义 gate + fake logger。
- **用例清单**（已实现，25 用例）：
  - `version-gate`（15）：compareVersion 逐段数字/相等/补 0/大小/非数字容错；默认闸 minAppVersion 拒+放行、coreApiHash 都有且不等拒/相等放行/单边缺放行/无声明放行；engineHash 不等拒/相等放行/单边缺放行/「coreApiHash 一致但引擎换了仍拒」。
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
- **测试结果 / 覆盖率**：`version-gate.test.ts` 11 + `hotupdate-service.test.ts` 14（含空后端/裸闸兜底补测）起步 25 用例；`version-gate.ts`、`hotupdate-backend.ts`、`hotupdate-service.ts`、`index.ts` 至今保持 **100% Stmts/Branch/Funcs/Lines**（core 覆盖率是 CI 硬门槛）。
- **遗留**：Web / 小游戏的远程 bundle backend 随需再接；退避重试、断点续传留后续。出包期打戳与主动校验已落地（[[compat-stamp]]）。

### engine 半适配（native.AssetsManager 后端，2026-07-28）

- **落地文件**：`packages/engine/src/hotupdate-backend.ts`——`createCcHotUpdateBackend(opts)`（`IHotUpdateBackend` 的 native 实现）+ `ccHotUpdateModule(opts)`（`sys.isNative` 守门注册 `HOTUPDATE_BACKEND`）+ `CcHotUpdateOptions`；engine `index.ts` 导出。
- **实现**：包 `native.AssetsManager`（原 `jsb.AssetsManager`，Cocos 3.x 迁入 `native` 命名空间）。`AssetsManager` 只有单事件回调，故 check/download 各把当前分派器挂到 `handler`、用完即卸（单回调多路复用）：
  - `check()` → `checkUpdate()`，事件 `ALREADY_UP_TO_DATE`→`up-to-date` / `NEW_VERSION_FOUND`→`new-version`（`info.version=getRemoteManifest().getVersion()`，`totalBytes=getTotalBytes()`）/ `ERROR_*_MANIFEST`→reject。
  - `download(onProgress)` → `update()`，`UPDATE_PROGRESSION`→桥 `{bytesDone/bytesTotal/filesDone/filesTotal}` / `UPDATE_FINISHED`→resolve / `UPDATE_FAILED·ERROR_UPDATING·ERROR_DECOMPRESS`→reject。
  - `apply()` → 新资源搜索路径置顶（`getSearchPaths().unshift(...getLocalManifest().getSearchPaths())`）+ 持久化 `localStorage[searchPathsKey]` + `setSearchPaths`。
  - `restart()` → `game.restart()`。
- **守门**：`ccHotUpdateModule` 用 `sys.isNative`——**仅原生注册真后端**；web/编辑器预览下 `native.AssetsManager` 为 undefined，故 no-op，core 回退空后端（恒 up-to-date），保证预览不崩。
- **接入方要做的那几步**：见下「接入方必做项（native）」——`ccHotUpdateModule` 只负责注册后端，启动还原、入口指针、缓存作废的调用点都在原生工程侧。
- **类型策略**：官方 `@cocos/creator-types@3.8.7` 的 `native.AssetsManager`/`native.EventAssetsManager`/`native.fileUtils` 真类型（ADR-0005），无 ambient hack。
- **验证**：四门全绿；**真机 gameView 预览已验证**（web 侧守门 + 回退）：`sys.isNative=false → HOTUPDATE_BACKEND registered=false` + `HotUpdateService.check()={"kind":"up-to-date"}`（守门 no-op 正确、空后端回退正确、web 下触碰 `native.AssetsManager` 不崩）。

### 接入方必做项（native）

以下几步 **npm 包管不到**，必须在接入方的原生工程里做。漏了任何一步都不会当场报错，
一律表现为「更新下发成功、玩家跑的还是旧代码」或几个版本之后才发作的崩溃。
本仓的样例实现在 `apps/demo`（装配细节见它的 `docs/hotupdate-pipeline.md`）。

1. **启动还原**：放一份 `<你的工程>/build-templates/native/index.ejs`（Creator 3.8 官方的原生模板
   覆盖点，android/ios/windows 共用一份；`data/main.js` 就是它渲染出来的），在**任何 `require`
   之前**读 `localStorage[searchPathsKey]`（默认键 `'HotUpdateSearchPaths'`，对齐官方模板）→
   `setSearchPaths`。**别改构建产物 `data/main.js`**——每次构建重新渲染，改了必被覆盖。
   **冷启动（进程被杀）必需**；`game.restart()` 同进程热重启因 `apply()` 已在内存 `setSearchPaths`，
   不还原也能加载新版本，所以漏了这步很难当场发现。
2. **base 入口指针**：同一份模板里，`System.import` 的名字改成运行时读固定名 `src/cck-base.json`，
   并把包内烘的名字挂成 `window.__cckBaseEntry`（`packagedBaseEntry()` 判「APK 换没换」的唯一来源）。
   出包脚本负责写这份指针，并把产物根上的入口用 `--files` 喂给 manifest（子目录遍历够不着根）。
   ⚠️ 出包时**硬校验** `project.manifest` 里入口与指针都在，否则「base 热更静默失效」。
3. **`resetCcHotUpdateOnAppChange()` 必须早于 kit 装配**（早于任何 `AssetsManagerEx.create()`
   ——一 create 就前插搜索路径）。它同时兼三件事：清启动看门狗计数（= 「这套 base 起得来」的握手）、
   认 APK 换没换、执行隔离态的缓存作废。**忘了调 = 每套热更 base 跑两次就被隔离**。
4. **manifest 产物**：`cck-manifest --split` 出 base + 每包一份，`--prev` 指向紧邻的上一次发布。
   **`--prev` 是必需项不是优化项**：给内容没变的包涨版本号会让客户端在 worker 线程崩（见
   [[hot-update-manifest]]）。`main.js` 永远不许出现在 `--files` 名单里。
5. **两枚戳**：app 戳进 `resources`（不可被热更改动，闸的这一端才不可伪造），更新戳跟 manifest
   一起上 CDN。两端 hash 由同一份 core d.ts 算出，出包期就该校验相等（见 [[compat-stamp]]）。
6. **看门狗计数键两处一致**：`cck.baseTry` 在 `index.ejs` 与 engine 的 `hotupdate-backend.ts` 里
   各写一份（`main.js` 跑在 SystemJS 之前，import 不到 TS 侧常量）。漏改一处**静态检查全绿**、
   只在真机上发作，出包脚本应对一次字面量。

### 验证

kit 半（状态机 / 闸 / 内存 fake）由 vitest 覆盖，见上「Testable seams」。**带 native 的那一半按
ADR-0002 不进 cc mock，验证一律在接入方工程的真机上做** —— 逐次实录属编年史，在 `docs/progress.md`；
接入方视角的结论表在 `apps/demo/docs/hotupdate-pipeline.md` 的「现状」。

| 能力 | 验到什么程度 |
|---|---|
| base 热更 | 真 Android APK，含 `force-stop` 冷启动仍是新版（热重启验不到启动还原） |
| base 热更（重启生效） | 真机，固定名指针接管 + 冷启动保持 |
| base 启动看门狗 | 真机，坏 base 死两次 → 第三次跑包内 + 作废缓存 + 记坏版本号；发新号自愈；只挡 base |
| 分包热更（免重启） | 真机，只下变更文件；断网冷启动仍是新版（排除「其实又下了一遍」） |
| 内容基址听服务端下发 | 真机，判据二值化：所有包内与 CDN 的 `packageUrl` 全烘死地址 |
| 新增 bundle 自愈（种子 manifest） | 真机，首次全量、冷启动零重下 |
| 版本闸（`coreApiHash` / `engineHash`） | 真机二分：改 hash 即 `rejected(needFullUpdate)`、恢复即放行 |
| web 远程 bundle 版本化 | 浏览器 e2e：旧页面加载新 bundle 代码、整页未重载 |
| 小游戏 | ❌ 未验 |
