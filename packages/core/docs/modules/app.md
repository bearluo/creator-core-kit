---
模块: app
所在包: packages/core（启动序列 / 状态 / 失败分类，纯逻辑零 cc）+ packages/engine（`appModule`：平台 restart + bundle reloader 注册）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 启动编排层——`createApp(config, {steps})` 把「读戳 → 服务器握手 → 热更 → 装 shared 包 → 进大厅」串成一条可插拔（`LaunchStep`）、可上报（`onProgress`）、可分类失败（network / needFullUpdate / maintenance / fatal）、可从失败那一步续跑（`retry`）的序列；compat 闸摆在加载第一个业务 bundle 之前。
何时读: 接入 kit 写启动流程时；要往启动里插登录 / SDK 初始化 / 公告时；要接服务端 dispatcher 或 web/native 线上热更时；排查「启动卡在某阶段 / 启动失败该给用户看什么」时。
日期: 2026-08-04
依赖: [[hotupdate-service]]（check/update/restart + VersionGate）、[[bundle-manager]]（load / setVersions / BundleScope）、[[asset-manager]]（读 app 戳、拉版本表）、[[network]]（`IHttp`：dispatch 步打握手请求）、[[di-container]]（APP token）、[[adr-0001]]（跨 bundle 单例 + 主包裁剪缺代码）、[[adr-0007]]（compat 戳运行时读入）、[[adr-0011]]（服务端分仓 + 协议契约）。提案封存于 `docs/design/2026-07-31-app-layer-and-bundle-lifecycle-proposal.md`。
---

# App 设计文档

## TL;DR

`createApp(config, { steps? })` → `App`。`launch()` 按序跑 `LaunchStep[]`，每步开始时 `report({phase})`；任一步抛错 → `phase='failed'` + `onFailure(分类)`，**游标停在失败那步**，`retry()` 从那里续跑，前面不重跑。默认序列 `defaultLaunchSteps()` 五步：`platform`（读 app 戳 → `AppInfo`）→ `dispatch`（向服务端 dispatcher 握手 → 拿 `wsUrl`/`cdnUrl`/服务器时间，或被判 UPDATE / MAINTENANCE 直接中止；不配 `config.dispatcher` 则空跑）→ `hotupdate`（native：check/update/restart；web：拉版本表 → compat 闸 → `setVersions`）→ `shared`（按序 load 共享 bundle）→ `lobby`（load 大厅 bundle → 调 `config.lobby.enter()`）。**core 零 cc**：切场景这类副作用由 `lobby.enter` 回调交还 engine；engine 侧 `appModule(config, {steps})` 只补两件平台事——**怎么重启**（native `game.restart()` / web `location.reload()`）与 **bundle 脚本失效实现**（`BUNDLE_RELOADER`），然后 `createApp` 注册进容器。**只造不跑**：`launch()` 由调用方在 `bootCoreKit` 之后显式发起，好让进度 / 失败订阅先挂上。

## Purpose（目标与定位）

- **做什么**：零件（HotUpdateService / BundleManager / compat 闸 / UIManager / DI）本就齐备，App 是把它们**按序装起来并对失败分类**的那一层。没有它，每个项目都要在 `Bootstrap.ts` 里手写一遍启动顺序，热更也就永远接不进主流程。
- **为什么可插拔**：各项目的差异**全部**落在这段——登录、SDK 初始化、公告、隐私协议、资源预热。固定序列必然不够用，所以序列本身是入参：`defaultLaunchSteps()` 返回数组，项目 `[...默认]` 后按名字定位插队，或整体替换。
- **为什么失败要分四类**：网络失败要给「重试」按钮、版本不兼容要引导去商店整包更新、停服维护要显示公告、代码 bug 只能兜底提示——四者给用户看的东西完全不同，糊成一个 `Error` 就只能弹「启动失败」。
- **compat 闸为什么摆在 lobby 之前**：[[adr-0001]] 的 主包裁剪缺代码真正暴雷的时刻是**第一个业务 bundle 加载时**（热更下来的新 bundle 引用主包 base 里已被裁掉的符号 → 跑到那一行才崩）。闸守在 `apply` 之前拦不住 web 路径（web 没有 apply）。
- **YAGNI（本版砍）**：kit 内置 loading UI（只出 `onProgress` 事件，样式是项目的事）；灰度 / AB / 分渠道版本表；`pendingRestart` 标志（见「与提案的偏差」）。

## Public API（TypeScript 精确签名）

```ts
// —— 配置 ——
export interface AppConfig {
  readonly appId: string;
  readonly version: string;                        // 客户端版本；app 戳缺失时作 compat 闸 appVersion 兜底
  readonly channel: string;
  readonly env: 'dev' | 'staging' | 'prod';
  readonly shared?: readonly string[];             // 启动期按序 load，默认 ['shared']
  readonly lobby: {
    readonly bundle: string;
    /** 进入大厅。engine 侧通常就是一行 `loadScene(scene, { bundle })`。 */
    readonly enter: () => Promise<void>;
  };
  readonly versionUrl?: string;                    // web：bundle 版本表 JSON 地址；不配则跳过该步
  readonly stampBundle?: string;                   // app 戳所在 bundle，默认 'main'
  readonly stampPath?: string;                     // app 戳资源路径，默认 'cck-app-compat'
  readonly dispatcher?: DispatcherConfig;          // 启动握手；不配则 dispatch 步空跑
}

export interface DispatcherConfig {
  readonly url: string;             // 完整地址，如 https://dispatch.example.com/api/Handshake
  readonly protoVersion: number;    // 协议契约版本，**由项目提供**（kit 里不出现协议常量）
  readonly platform: string;        // android / ios / web / wechat …
  readonly deviceId?: string;
  readonly timeoutSec?: number;
}

export type DispatchAction = 'play' | 'update' | 'maintenance';

/** dispatcher 下发的内容，落在 `bag[DISPATCH]`。 */
export interface DispatchResult {
  readonly action: DispatchAction;
  readonly wsUrl: string;           // 'play' 时有效：按客户端版本路由到的那个部署单元
  readonly cdnUrl: string;          // 资源 / 热更内容基址，**就是个 URL**，客户端自己解释
  readonly notice: string;
  readonly storeUrl: string;
  readonly serverTimeMs: number;    // 服务器权威时间（Unix 毫秒）
}

/** 远程版本表：web 热更的全部输入。 */
export interface RemoteVersions {
  readonly bundles?: Readonly<Record<string, string>>;  // bundle 名 → 出包 md5
  readonly version?: string;                            // 本次内容版本，喂 compat 闸
  readonly minAppVersion?: string;
  readonly coreApiHash?: string;
}

// —— 阶段 / 进度 / 失败 ——
export type LaunchPhase =
  | 'idle' | 'platform' | 'dispatch' | 'hotupdate' | 'shared' | 'lobby' | 'running' | 'failed';

export interface LaunchProgress {
  readonly phase: LaunchPhase;
  readonly ratio?: number;         // 0..1，仅下载阶段有
  readonly messageKey?: string;    // i18n key —— kit 不出面向用户的文案
}

export type LaunchFailure =
  | { kind: 'network'; retryable: true; error: unknown }
  | { kind: 'needFullUpdate'; reason: string; storeUrl?: string }
  | { kind: 'maintenance'; notice: string; retryable: true }
  | { kind: 'fatal'; error: unknown };

// —— 步骤 ——
export interface LaunchContext {
  readonly config: AppConfig;
  readonly bag: Map<string, unknown>;   // 步骤间传值（APP_INFO、登录态…）
  report(p: LaunchProgress): void;
}
export interface LaunchStep {
  readonly name: string;
  readonly phase: LaunchPhase;
  /** 返回 `'halt'` = 到此为止（如 native 热更已 restart，等进程重来）。 */
  run(ctx: LaunchContext): Promise<void | 'halt'>;
}

/** 步骤主动中止并指定失败分类。用**结构标记**而非 Error 子类——跨 bundle `instanceof` 不可靠（[[adr-0001]]）。 */
export function abortLaunch(failure: LaunchFailure): never;

/** `ctx.bag` 里 AppInfo 的键：platform 步写入，compat 闸与项目自定义步骤读取。 */
export const APP_INFO = 'cck.app.info';

// —— App ——
export interface App {
  readonly config: AppConfig;
  readonly phase: LaunchPhase;
  launch(): Promise<void>;         // 从当前游标跑到底；已完成的步骤不重跑
  retry(): Promise<void>;          // = launch，游标停在失败那步
  restart(): void;
  onProgress(cb: (p: LaunchProgress) => void): Disposer;
  onFailure(cb: (f: LaunchFailure) => void): Disposer;
}

/** 依赖注入口（仅为可测；生产不传，各服务从全局取）。 */
export interface AppDeps {
  bundles?: Pick<BundleManager, 'load' | 'setVersions'>;
  assets?: Pick<IAssetLoader, 'load' | 'loadRemote' | 'release'>;
  hotUpdate?: Pick<HotUpdateService, 'check' | 'update' | 'restart'>;
  gate?: VersionGate;
  logger?: ILogger;
  restart?: () => void;            // engine 按平台注入；web 必须 location.reload()
}

export function defaultLaunchSteps(deps?: AppDeps): readonly LaunchStep[];
export function createApp(
  config: AppConfig,
  opts?: { steps?: readonly LaunchStep[]; deps?: AppDeps },
): App;

export const APP: Token<App>;
export function getApp(): App;     // 未注册直接抛（App 有必需配置，造不出无参默认）

// —— engine 半 ——
export function appModule(config: AppConfig, opts?: { steps?: readonly LaunchStep[] }): KitModule;
export function createCcBundleReloader(): IBundleReloader;
```

## 默认启动序列（`defaultLaunchSteps()`）

| # | name / phase | 做什么 | 失败时 |
|---|---|---|---|
| 1 | `platform` | 从 `stampBundle/stampPath` 读 app 戳 JSON → `AppInfo{appVersion, coreApiHash}` 写进 `bag[APP_INFO]`，随即 release 该 JSON | **缺戳不阻断**：warn 一行（只取 message 不带堆栈），闸退化为休眠 |
| 2 | `dispatch` | 配了 `config.dispatcher` 才做事：`postJson(IHttp, url, 握手包)` → 判定落 `bag[DISPATCH]` | `update` → `needFullUpdate`（带 `storeUrl`）；`maintenance` → `maintenance`（带 `notice`）；请求失败 / 信封 code 非 OK / action 未知 → 抛（默认判 network 可重试） |
| 3 | `hotupdate` | native：`check()` → `update(进度)` → `ready` 则 `restart()` 并返回 `'halt'`；web：`loadRemote(versionUrl)` → **compat 闸** → `setVersions(bundles)` | `rejected` → `needFullUpdate`；`error`/下载失败 → 抛（默认判 network 可重试） |
| 4 | `shared` | `for (b of config.shared ?? ['shared']) await bundles.load(b)` | 抛 → network |
| 5 | `lobby` | `bundles.load(lobby.bundle)` → `await config.lobby.enter()` | 抛 → network |

**`dispatch` 必须排在 `platform` 之后**：握手包里的 `capabilityStamp` 就是 `platform` 步读出的 `coreApiHash`。服务端**不解释它是怎么算出来的**，只做等值比对——这是同一套服务端能同时接 Cocos 和 Godot 客户端的关键（[[adr-0011]]）。

握手包（`HandshakeRequest` 的 proto3 JSON）：`{protoVersion, appVersion, platform, channel, capabilityStamp, deviceId}`。响应信封 `{code, msg, data}` —— **业务错误一律 HTTP 200 + body 带 code**（CDN / 渠道 SDK 代理 / 企业网关会篡改甚至吞掉 4xx/5xx），所以判定看 `code` 不看状态码。枚举名（`ACTION_PLAY`）与枚举号（`1`）、`snake_case` 与 `camelCase` 字段名**四种组合都认**：服务端换个序列化选项不该让客户端集体启动失败。

web 上 `check()` 走空后端恒返回 up-to-date，`hotupdate` 步自然退化成「只拉版本表」；native 通常不配 `versionUrl`，该步就只有 AssetsManager 那半。**同一份默认序列覆盖两个平台**，不做平台分叉。

插队写法（demo 实例）：

```ts
const steps = [...defaultLaunchSteps()];
steps.splice(steps.findIndex((s) => s.name === 'lobby'), 0, myI18nStep);  // 按名字定位，不写死下标
```

## Behavior & data flow（行为与数据流）

- **游标语义**：`cursor` 是模块级状态，`launch` 与 `retry` **是同一个函数**。成功一步 `cursor++`；失败**不推进**（`retry` 重跑失败那步）；返回 `'halt'` 也不推进（万一没真重启，`retry` 会重跑这步）。跑完全部 → `phase='running'` + `report({phase:'running'})`。
- **进度上报时机**：每步**开始时**报一次 `{phase}`（不带 ratio）；下载中由 `hotupdate` 步自己按字节比例补报 `{phase:'hotupdate', ratio, messageKey:'cck.launch.downloading'}`。
- **失败分类** `classify(e)`：先看结构标记 `e.__cckLaunchFailure`（由 `abortLaunch` 打上）；没有则**默认判 `network` 可重试**——启动期偶发失败绝大多数是网络 / IO，真是代码 bug 时重试也只是再失败一次，代价小于把可恢复失败判成 `fatal` 让用户无路可走（`ponytail:` 注释在案）。
- **回调集合快照**：`report` / `onFailure` 派发前 `Array.from(...)`，允许回调里退订自己。
- **`bag` 的用法**：`platform` 写 `APP_INFO`，`hotupdate` 的 web 分支读它做闸判定；`dispatch` 写 `DISPATCH`（**先落 bag 再判 action**，失败态的 UI 也要拿 `notice` / `storeUrl`），业务步骤读它拿 `wsUrl` 连长连接、拿 `cdnUrl` 拼版本表地址。项目自定义步骤（登录 → 拿到 token → 后面的步骤要用）走同一个 `bag`，kit 不预设键名。
- **engine 半 `appModule`**：`install` 时 ① 若容器没有 `BUNDLE_RELOADER` 则注册 `createCcBundleReloader()`；② `createApp(config, { steps, deps: { restart: platformRestart } })` → 注册 `APP`。**不调 `launch()`**。`stop` 时注销这两个 token（`BUNDLE_RELOADER` 只注销自己注册的那份），使 `shutdown()` 后能重新 `bootCoreKit`。
- **`platformRestart`**：`sys.isNative` → `getHotUpdateService().restart()`（backend 内是 `game.restart`，同进程 PID 不变）；否则 `globalThis.location?.reload()`——web **必须整页重来**，`game.restart()` 只重启引擎不重新拉脚本，而 web 的新代码在 `index.<md5>.js` 这个新 URL 里。

## Key design decisions（决策表）

| # | 维度 | 选定 | 理由 |
|---|---|---|---|
| 1 | App 归属 | core 出纯逻辑 + engine 出适配 | 与全仓一致；启动流程可脱引擎单测（14 例全在 node 跑） |
| 2 | 序列形态 | 可插拔 `LaunchStep[]`，复用 `KitModule` 的心智 | 各项目差异全在这段，固定序列必然不够 |
| 3 | 切场景接缝 | **不进 core**，由 `config.lobby.enter` 回调给出 | 对齐 engine/scene-loader「切场景是 engine 直接行为，core 不持其接缝」的既有决策 |
| 4 | 失败处理 | 四分类 + 从失败步 `retry()` | 网络重试 / 引导商店 / 等公告 / 兜底，给用户看的东西完全不同。停服维护单列一类：它可重试，但要先把公告讲清楚，否则玩家只会连点「重试」|
| 5 | 失败默认分类 | 未标记的异常一律 `network`（可重试） | 见上「失败分类」；把可恢复失败判死代价更大 |
| 6 | 中止方式 | `abortLaunch()` 抛**带结构标记的 Error**，不用自定义 Error 子类 | 跨 bundle `instanceof` 不可靠（[[adr-0001]]） |
| 7 | 启动 loading UI | kit 只出 `onProgress` 事件，界面归项目（样例：demo 的 `LaunchOverlay.prefab` + 同名薄壳脚本） | 样式是项目的事，kit 不预设任何界面。**能用 prefab**：随 Boot.scene `@property` 序列化进 main 包，启动第一帧就在手上；受限的只是 `shared`/`lobby` 这些还没加载的 bundle |
| 8 | compat 闸位置 | native 仍在 `apply` 前（AssetsManager 自带）；**web 移到 `setVersions` 前** | ADR-0001 的真实暴雷点是第一个业务 bundle 加载时；web 没有 apply 这个时机 |
| 9 | 版本表落点 | `BundleManager.setVersions`，不放 App | UIManager 打开界面时也会 load bundle，放上层会漏（见 [[bundle-manager]] 决策 #10） |
| 10 | 造与跑分离 | `appModule` 只 `createApp` 并注册，`launch()` 由调用方发起 | 进度 / 失败订阅必须先于 `launch` 挂上，否则第一批事件全丢 |
| 11 | `getApp()` 无默认 | 未注册直接抛，且抛错文案带修复指引 | App 有必需配置，造不出有意义的无参默认（与 `getLogger` 等有默认的服务不同） |

### 与提案的偏差（一处）

提案 §四 的 `App.pendingRestart`（「有已下载但需重启才生效的更新」）**实现时删去**：本版没有真实消费方——启动期热更直接 `restart()`，运行期换 bundle 由调用方按需发起，两条路径都不经过这个标志。对应的测试用例（提案 §七 第 8 条）同步删。真要做「稍后重启」的 UI 提示时再加。

## Platform considerations（全平台 / 小游戏兼容）

- **native**：`AssetsManager` + manifest（[[adr-0006]] 真机 e2e 过）。默认「下完 → `restart()`」；同进程重启 PID 不变、成本低。
- **web/H5**：无 AssetsManager，热更 = 版本表 + md5。整包更新走 `location.reload()`；单个业务 bundle 免重启换代码见 [[bundle-manager]]「免重启换代码」。**出包必须勾 MD5 Cache**。
- **小游戏**：主包代码只能走平台版本管理（`getUpdateManager`），自建热更仅覆盖分包资源。本版不实现；`IHotUpdateBackend` 已有 `sys.isNative` 守门先例，照抄即可，序列本身不用改。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测接缝**：`AppDeps` 把 4 个服务 + logger + restart 全部收窄成 `Pick<...>` 注入口，测试传记录调用的 fake；`steps` 可整体替换。全纯 TS，零 cc。
- **用例清单**（14 例，`packages/core/src/app/__tests__/app.test.ts`）：默认序列按 phase 顺序执行且逐阶段 `report`；某步抛网络错 → `phase='failed'` + `onFailure({kind:'network',retryable:true})`；`retry()` 从失败步续跑、前面步骤不重跑；compat 闸拒 → `needFullUpdate` 且**不加载 lobby**；自定义 `steps` 整体替换 / 插队按数组序；native `update` 返回 `ready` → 调 `restart` 且返回 `'halt'` 停在原地；web 拉到版本表 → `setVersions` 收到该 map；缺 app 戳 → warn 但继续；`abortLaunch` 的结构标记原样透出；`getApp` 未注册抛。
- engine 半（`appModule` / `platformRestart`）按 [[adr-0002]] 不进 cc mock，走 apps/demo 真构建 + 浏览器验证。

## 已知行为与坑

### 落地文件

- **core**：`packages/core/src/app/app.ts`（全部）、`index.ts`；core `index.ts` re-export。
- **engine**：`packages/engine/src/app-module.ts`（`appModule` + `platformRestart` + `createCcBundleReloader`）。
- **样例**：`apps/demo/assets/scenes/Bootstrap.ts`（`APP_CONFIG` + `launchSteps()` 插一步 `demo-i18n` + `@property(Prefab) launchOverlay` + 订阅 progress/failure 后 `app.launch()`）、`apps/demo/assets/scenes/LaunchOverlay.{prefab,ts}`（界面在 prefab，脚本只填文案 / 推进度 / 切失败按钮）。

### 反直觉行为 / 坑

- **`launch()` 和 `retry()` 是同一个函数**，都从当前游标跑。重复调 `launch()` 不会重跑已完成的步骤——这是特性（失败重试的实现方式），但别把它当「重新启动」用；真要从头来是 `restart()`。
- **`'halt'` 不推进游标**：native restart 后进程重来，游标随之作废；但若 `restart()` 实际没生效（比如被平台拦了），下一次 `retry()` 会**重跑热更这一步**而不是往下走——刻意如此，避免带着未应用的更新进游戏。
- **缺 app 戳只 warn 不失败**，代价是 `coreApiHash` 闸休眠（对单边缺失恒放行）。没打戳的项目每次启动都会看到这行 warn，属预期；打戳走 tools 的 `cck-manifest stamp`（[[adr-0007]]）。
- **web 上 `getHotUpdateService().restart()` 没用**：那是 `game.restart()`，只重启引擎不重新拉脚本 → 必须由 engine 注入 `location.reload()`。这也是 `AppDeps.restart` 存在的唯一理由。
- **`onProgress` / `onFailure` 必须在 `launch()` 之前挂**：`appModule` 只造不跑正是为此。挂晚了第一批事件（`platform` 阶段）直接丢。
- **失败不会抛给 `launch()` 的调用方**——`launch()` 永远 resolve，失败只经 `onFailure` 透出。不订阅就完全静默（只有一行 logger.warn）。
- **`appModule.stop` 必须注销 `APP`**：Creator 的 Game View 停止再播放**不重载 JS 上下文**，走的是「`shutdown()` → 重新 `bootCoreKit`」这条路；少了注销就撞 `DI: token "cck.app" already registered in scope "root"`，整个 kit 装不起来。也**不能**改成 `hasLocal` 守卫复用旧 `App` 了事——它的游标已停在 `running`，复用等于启动序列不再跑。真机进程全新，这个坑只在开发期显形。

### 当前限制（ponytail / YAGNI）

- 无 `pendingRestart`（见「与提案的偏差」）、无灰度 / 分渠道版本表、无启动超时兜底。
- `retry()` 无次数上限、无退避——重试节奏由 UI 层（用户点按钮）决定。
- 版本表只认「bundle → md5」的扁平映射；分包依赖、按渠道分流留给项目自己在 `versionUrl` 后面的服务里做。
