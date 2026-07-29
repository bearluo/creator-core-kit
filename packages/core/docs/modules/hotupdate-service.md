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

## Platform considerations（全平台 / 小游戏兼容）

- core（状态机/闸/内存 fake）纯 TS，全平台无差异。
- **native**：`jsb.AssetsManager` 差量下载脚本+资源 → 写 `writablePath` → `setSearchPaths` 置顶 → `game.restart` 生效。
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
  1. **启动还原**：原生工程 `main.js`（引擎起前、本 bundle 未加载时）须读同一 `localStorage[searchPathsKey]`（默认键 `'HotUpdateSearchPaths'`，对齐官方模板）→ `setSearchPaths` 还原上次 apply 的搜索路径，否则重启不生效。
  2. **manifest 产物**：`project.manifest` / `version.manifest`（远程 URL + 版本 + 文件 md5）由 tools 出包期生成（后置模块）。
- **类型策略**：官方 `@cocos/creator-types@3.8.7` 的 `native.AssetsManager`/`native.EventAssetsManager`/`native.fileUtils` 真类型（ADR-0005），无 ambient hack。
- **验证**：四门全绿；**真机 gameView 预览已验证**（web 侧守门 + 回退）：`sys.isNative=false → HOTUPDATE_BACKEND registered=false` + `HotUpdateService.check()={"kind":"up-to-date"}`（守门 no-op 正确、空后端回退正确、web 下触碰 `native.AssetsManager` 不崩）。

### native 真机 e2e 验证（2026-07-28，真 Android APK · PASS）

**完整热更闭环在真 x86_64 Android 模拟器（`fortune_test`）上跑通**——同一 APK 内 `BUILD_TAG` 从 `v1` 跃迁到 `v2`，铁证下载来的新代码接管：

```
BUILD_TAG = v1                    ← 首启，APK 内置 v1 代码
check() = {"kind":"update-available","info":{"version":"1.0.1","totalBytes":17474}}
⏳ 下载 → 17474/17474 字节（1 文件：assets/main/index.js）
update() = {"kind":"ready"}
✅ 就绪 → 2 秒后 restart
BUILD_TAG = v2                    ← game.restart() 同进程热重启（PID 不变）后，v2 代码接管
```

**已验证的 native 集成步骤（落实上文「⚠️ native 集成步骤」，可复现）**：

1. **manifestUrl 解析**：`ccHotUpdateModule({ manifestUrl: 'project.manifest' })` 传裸文件名即可——把 `project.manifest` 放构建产物 `data/` 根（APK 内 `assets/` 根，是默认搜索路径），`native.AssetsManager.create('project.manifest', …)` 经 fileUtils 直接解析到。**比官方「导入 `.manifest` 资产取 `nativeUrl`」更省**，因 data 根本就是搜索路径。
2. **main.js 启动还原**（原生工程侧手动加，见 `apps/demo/build/android/data/main.js` 顶部）：引擎/资源加载前读 `localStorage['HotUpdateSearchPaths']` → `jsb.fileUtils.setSearchPaths(...)`。键须与 backend `searchPathsKey`（默认 `'HotUpdateSearchPaths'`）一致。**冷启动必需**；`game.restart()` 热重启因 apply() 已在内存 `setSearchPaths`，同进程内即便不还原也能加载 v2，但冷启动（进程被杀）只靠这段。生产应放 `build-templates/android/data/main.js` 使其存活于每次构建（demo 为验证直接改生成物）。
3. **manifest 产物**：`cck-manifest`（tools 半）对 `build/android/data` 生成 `project.manifest`/`version.manifest`——默认走 `src/assets/jsb-adapter` 三子目录（根级 main.js/manifest 自身不纳入，无自引用）；v1 打 `version 1.0.0` 烘进 APK，v2 改一处代码重构建后打 `1.0.1` + 同 `packageUrl` 托管远端。AssetsManager 按 md5 差量：仅变更的 `assets/main/index.js`（md5 `e815…`→`9c40…`）被下载。
4. **远端托管**：宿主起 http server，模拟器经 `10.0.2.2:<port>`（user-net 网关映射宿主 loopback）直连，免 CDN/鉴权。Cocos 3.8 android 模板 `AndroidManifest.xml` 默认 `android:usesCleartextTraffic="true"`，HTTP 明文开箱可用。
5. **原生构建**：Creator 3.8.7 经 builder `add-task` 消息程序化触发（复用运行中的编辑器，无锁冲突），NDK/SDK/JDK 路径直填任务 options（`sdkPath`/`ndkPath`/`javaHome`）绕开偏好设置；ABI 选 **x86_64**（对齐 x86_64 模拟器，原生跑不靠 ARM 转译，Cocos 3.8 支持）；产物 gradle 工程 `gradlew assembleDebug` 编 APK。详见 [[adr-0006]]。

至此「三种热」之**线上热更**在 native 真机端到端闭环验证完成（Web/小游戏远程 bundle backend 仍随需再接）。

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
