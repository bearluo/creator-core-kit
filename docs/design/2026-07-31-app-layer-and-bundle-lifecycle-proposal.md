---
状态: 已实施（2026-07-31）· 已封存   # 草案 → 评审中 → 已定稿 → 已实施
类型: 改造提案（过程文档，一次性）——含新模块 App。**已封存，勿再更新**：现状看 `packages/core/docs/modules/app.md` + `bundle-manager.md` + `ui-manager.md`，决策看 `docs/adr/0009`（包分层判据）与 `docs/adr/0010`（免重启换 bundle 代码）。本文保留下来只为记录改造动机与过程。
摘要: 引入 App 层（启动序列编排 + 热更闸 + 失败兜底）；把 lobby 降为 bundle、新建 shared bundle、main 包瘦身；立 BundleScope 回收契约让「免重启换业务 bundle」在正确性上成立；web/native 两条热更路径接进启动主流程。
何时读: 实施本提案时；或想知道「为什么 App 长这样、为什么 bundle 卸载要按这个顺序」时。
日期: 2026-07-31
依赖: packages/core/docs/modules/hotupdate-service.md、bundle-manager.md、ui-manager.md、docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md、docs/adr/0007-compat-stamp-runtime-readin-and-filebrowser-hosting.md、docs/design/lobby-modular-framework-overview.md
---

# App 层 + bundle 生命周期 改造提案

## 为什么要做（三条事实，不是审美）

1. **零件齐了，没有装配层**。HotUpdateService（native e2e 过）、BundleManager（引用计数 + 版本入口）、compat 闸（`coreApiHash` 已激活）、UIManager v2、DI 全部就位，但 `apps/demo/assets/scenes/Bootstrap.ts` 里是硬编码的 `bootCoreKit(modules)` + `loadScene('Lobby')`——**热更不在启动路径上**，`getHotUpdateService()` 至今只出现在 `assets/test/DemoBoot.ts` 探针里。
2. **迭代最频繁的东西锁在最难更新的层里**。大厅在主包 → 大厅改一行 = 整包重发。
3. **compat 闸摆错了位置**。它现在守「apply 之前」，但 ADR-0001 那个「AOT 缺代码、跑到那行才崩」真正暴雷的时刻是**第一个业务 bundle 加载时**——闸该挪到 `load('lobby')` 之前。

## 一、包分层

判据不是「哪个包」，是「**启动期加载且被跨模块持有引用**」：

| 层 | 内容 | 更新怎么生效 |
|---|---|---|
| **重启层** | 引擎 + AOT chunks（`@cck/core`/`@cck/engine` 全部框架代码）、main 包（`Boot.scene` + `Bootstrap.ts` + App 配置）、`settings.json` | 必须重启 |
| **启动期换** | `shared`、`lobby` | 启动序列里 load 时用的就是新版本 → **天然生效，不需要"运行中换"** |
| **运行期换** | 按需业务 bundle（shop / mini-clicker / mini-dodge …） | 见 §二 —— **免重启换代码，两平台都已跑通**：web 靠换 md5 自动触发，native 靠显式 `invalidate()` |

> `shared` 技术上可配远程包、可独立热更，但里面是 i18n 基表、公共图集、字体这类被各处持有引用的东西，运行中换收益接近零、风险不低 → 归「启动期换」。
> `lobby` 同理：启动就 load，更新在下次启动天然带上，不需要额外机制。

main 包实施后只剩：`Boot.scene` + `Bootstrap.ts` + `AppConfig`。

## 二、免重启换代码：实测结论

> ⚠️ 本节被实测改写过两次：初稿「web 靠 md5 天然免重启」——错；第二版「web 也做不到，只能重启」——
> 也错（当时只清了 3 个 module id 里的 2 个，且没注销旧类）。下面是第三版，**已在真构建产物上跑通**。
> 实验（2026-07-31，Cocos 3.8.7 web-mobile 真构建，勾 MD5 Cache）：v1 / v2 两份产物，只改 `ShopView`
> 一行代码 → shop 的 md5 变了；把 v2 的 shop 目录拷进 v1 产物（文件名带 md5，新旧天然共存），
> 挂在本机静态服务上，在跑着的 v1 页面上换版本重开商城。

**换代码 ≠ 换资源。** `releaseAll() + removeBundle()` 把资源（prefab / json / 图集 / i18n）放得干干净净，
再进模块时资源确实是新的——但**脚本模块和已注册的 cc 类都还在缓存里**，跑的仍是旧代码，且**没有任何报错**。
这是最容易误判「热更生效了」的地方：改了 prefab 或配置会看到变化，改了脚本不会。

让脚本真正失效要同时清两处，**缺一不可**：

| 清什么 | 在哪 | 只清这个会怎样 |
|---|---|---|
| 该 bundle 的全部 module 记录 | `System[REGISTRY]`（唯一的 symbol 键）**和** `System.registerRegistry`（普通实例属性）两张表 | 新模块求值了，但 `js.setClassName` 撞名不覆盖 `_registeredClassIds`，而 prefab 是按 **classId** 反序列化的 → 拿到旧类，表现为「类换了、界面没换」 |
| 该 bundle 注册的 cc 类 | `js.unregisterClass(...)` | `System.import` 命中缓存的 load 记录，declare 不再执行，类永远回不来 → prefab 反序列化报 `Can not find class`，组件被**静默丢弃**（比不清更糟） |

module id 怎么找：bundle 的入口 chunk 是 `chunks:///_virtual/<bundle>`，它的 `.d`（依赖 load 记录）
就是这个 bundle 自己的全部脚本模块；待注销的类从每个 dep 的 **namespace** 里取导出的函数。
`registerRegistry` 的条目被 `instantiate` 用过后会置 `null`，残留的 `null` 仍满足 `in` 判断 →
必须 `delete`，不能置空。

⚠️ **namespace 字段跨 SystemJS 版本会变**：3.8.7 web 产物里是 `.n`，`.C` 是 top-level completion
promise；另一些版本 namespace 在 `.C` 上。写死一个就会在另一边**静默**拿到空导出（一个类都注销不掉）
→ 实现里按形状挑（排除 thenable），不按字段名赌。

### 平台差异：什么时候**能**清

| | web / H5 | native |
|---|---|---|
| 出包 | **勾 MD5 Cache** | manifest + 覆盖 writable path 同名文件 |
| 新代码怎么到达 | `index.<新md5>.js`，**换了 URL** | 路径不变，靠 `searchPaths` 前置 |
| 能不能清 | **只有 md5 变了才能清** | 随时可清 |
| 谁来触发 | `setVersions()` 之后 `IBundleSource.loadBundle` 发现版本变了**自动清** | 热更落盘后调用方显式调 `IBundleReloader.invalidate(bundle)` |

web 的限制来自 cc 的 `downloadScript`：它按 **URL** 缓存已下载脚本（引擎内模块私有的 `downloaded[url]`，
外部够不到），同 URL 再加载**连 `<script>` 都不再插**。所以版本没变就清缓存 = 那段代码再也执行不到，
下次 `System.import` 两张表全落空、加载直接失败。native 没有这层 DOM 脚本缓存，所以能无条件清。

→ md5 的作用有三个：让新旧版本文件共存、绕开 HTTP 缓存、**给"版本变了"一个可判断的信号**。

### 实测结果（web-mobile 真构建产物）

| 做法 | 结果 |
|---|---|
| 退出模块 → 换 version → 再进（什么都不清） | 新 `index.<md5>.js` **下载并执行了**，但 `getClassByName` 仍是同一个类对象，界面还是旧文案 ❌ |
| 同上 + 只删 3 个 module id | 类对象换了，界面**还是旧文案**（classId 仍被旧类占着）❌ |
| 同上 + `unregisterClass(旧类)` | 新文案出现，0 报错，**整页未重载** ✅ |
| 接线后：只调 `setVersions()`，清缓存由 `loadBundle` 自动做 | 新文案出现，`classSwapped: true`，0 报错 ✅ |
| 版本不变、连续进出两轮 | 每次都正常打开（没有误清缓存）✅ |

由此推出的硬约束：

1. **勾 MD5 Cache 是 web 侧的前置构建约束**：不勾则文件名恒为 `index.js`，新旧无法共存、缓存拦不住、
   也判断不出「版本变了」。踩了**没有任何报错**，只是拿到旧代码。
2. 清缓存踩的是 SystemJS 与 CCClass 的**私有内部结构**，跨引擎版本可能失效 → 实现里逐层
   feature-detect，取不到就返回 `false`（退化成需重启），不抛异常。
3. **销毁存活实例是正确性要求，不是卫生要求**——两条独立理由都指向同一个契约（BundleScope）：
   - 换代码后旧类的实例成孤儿，`getComponent(新类)` 找不到；
   - 就算完全不换代码，`release(bundle)` 卸掉 prefab / 纹理之后，还挂在场景里的界面就在用已卸资源。

⚠️ 类表撞 uuid（复制 prefab / 脚本忘改 meta）时，后加载的会**无声覆盖**先加载的，没有任何警告。

## 三、变更总览（7 处）

| # | 变更 | 落点 | 解决 |
|---|---|---|---|
| 1 | App 层：`AppConfig` + 可插拔 `LaunchStep` + 状态机 + 失败分类 | core（纯逻辑）+ engine（适配） | 没有装配层 |
| 2 | `BundleScope` 回收契约（demo 的 `ModuleResourceScope` 上升进 core 并补全） | core | 孤儿实例 = 免重启换代码的正确性 |
| 3 | `BundleManager.setVersions(map)` 版本表 | core | web 热更；且 UIManager 内部 load bundle 也自动带版本 |
| 4 | `IBundleReloader` 接缝（`invalidate(bundle): boolean`）+ engine 侧真实现 | core 接口 + `invalidateBundleScripts`（见 §二） | 免重启换代码：web 由 `loadBundle` 按版本变化自动调，native 由调用方热更后显式调 |
| 5 | `UIManager.closeByBundle(bundle)` | core | 换 bundle 前保证 UI 实例清空（否则孤儿） |
| 6 | compat 闸移到「加载第一个业务 bundle 之前」 | core（App 的 lobby step） | ADR-0001 的真实暴雷点 |
| 7 | lobby 降 bundle + 新建 `shared` bundle + main 瘦身 + `LobbyApp` 改名让位 | apps/demo | 大厅可热更；概念不撞车 |

## 四、目标 API

### App（`packages/core/src/app/`）

```ts
export interface AppConfig {
  readonly appId: string;
  readonly version: string;                       // 客户端版本，喂 compat 闸的 AppInfo
  readonly channel: string;                        // 渠道 / 分发标识
  readonly env: 'dev' | 'staging' | 'prod';        // 决定 manifestUrl / CDN base
  /** 启动期必须加载的共享 bundle（按序），默认 ['shared']。 */
  readonly shared?: readonly string[];
  readonly lobby: { readonly bundle: string; readonly scene: string };
}

export type LaunchPhase =
  | 'idle' | 'platform' | 'hotupdate' | 'shared' | 'lobby' | 'running' | 'failed';

export interface LaunchProgress {
  readonly phase: LaunchPhase;
  readonly ratio?: number;        // 0..1，仅下载阶段有
  readonly messageKey?: string;   // i18n key，UI 自己译（kit 不出文案）
}

/** 失败分类——三种给用户看的东西完全不同，不能糊成一个 Error。 */
export type LaunchFailure =
  | { kind: 'network'; retryable: true; error: unknown }          // 重试
  | { kind: 'needFullUpdate'; reason: string }                    // 引导去商店 / 整包更新
  | { kind: 'fatal'; error: unknown };                            // 兜底

export interface LaunchContext {
  readonly config: AppConfig;
  report(p: LaunchProgress): void;
  /** 步骤间传值（登录态、服务器下发的版本表等）。 */
  readonly bag: Map<string, unknown>;
}

/** 可插拔启动步骤：项目插自己的登录 / SDK 初始化 / 公告 / 隐私协议。 */
export interface LaunchStep {
  readonly name: string;
  readonly phase: LaunchPhase;
  run(ctx: LaunchContext): Promise<void>;
}

export interface App {
  readonly config: AppConfig;
  readonly phase: LaunchPhase;
  /** 是否有已下载但需重启才生效的更新（native 默认路径 / reloader 失败时置位）。 */
  readonly pendingRestart: boolean;
  launch(): Promise<void>;
  /** 失败后从**失败那一步**继续，不从头。 */
  retry(): Promise<void>;
  restart(): void;
  onProgress(cb: (p: LaunchProgress) => void): Disposer;
  onFailure(cb: (f: LaunchFailure) => void): Disposer;
}

export function createApp(config: AppConfig, opts?: { steps?: readonly LaunchStep[] }): App;
export function getApp(): App;

/** kit 的默认步骤序列，项目可整体替换或插队。 */
export function defaultLaunchSteps(): readonly LaunchStep[];
```

默认序列（`defaultLaunchSteps()`）：

```
1. platform    读 cck-app-compat.json → AppInfo（version / coreApiHash）
2. hotupdate   native : check → [update-available] update(进度) → ready → restart
               web    : 拉版本表 → bundleMgr.setVersions(map)
3. shared      for (b of config.shared) bundleMgr.load(b)
4. lobby       compat 闸判定 → load(lobby.bundle) → loadScene(lobby.scene, { bundle })
```

### BundleScope（`packages/core/src/bundle/`）

demo 的 `ModuleResourceScope` 上升进 core（`IAssetLoader` 是泛型的，纯 core 可实现），补上「先关 UI」这一环：

```ts
export interface BundleScope {
  readonly bundle: string;
  /** 加载模块 i18n 表（键带模块前缀）；dispose 时按精确键 removeTable。 */
  i18n(locale: string, path: string): Promise<void>;
  /** 加载配表 → register；dispose 时 unregister。 */
  table<T>(name: string, path: string, opts?: TableOptions<T>): Promise<ConfigTable<T>>;
  /** 从本 bundle 加载资源；dispose 时 release。 */
  load<T>(path: string, type?: AssetTypeToken): Promise<T>;
  /** 登记任意对称回收（BindingScope.dispose、事件解绑、定时器…）。 */
  add(teardown: () => void | Promise<void>): void;
  /** 逆序回收（幂等，单条失败不阻断其余）。**async**：要 await UI 关闭。 */
  dispose(): Promise<void>;
}
export function createBundleScope(bundle: string): BundleScope;
```

**回收链的顺序有意义**，不是随手排的：

```
1. UIManager.closeByBundle(bundle)   ← 必须最先：销毁旧类的存活实例，避免孤儿
2. 逆序执行登记的 teardown           ← DI 子作用域 dispose / 事件退订 / 定时器 / 绑定
3. i18n.removeTable(locale, keys)    ← 按精确键，不误伤同 locale 其它模块
4. configTables.unregister(name)
5. assetLoader.release(...)
6. bundleMgr.release(bundle)         ← 最后：前面还要用它的资源
```

第 1 步之所以在最前：`setClassId` 静默替换后旧实例即成孤儿，晚一步就没有可靠手段找到它们了。

### 版本表与 reloader（`packages/core/src/bundle/`）

```ts
export interface BundleManager {
  // …既有
  /** 设置 bundle → 版本（web md5）映射。load 时 opts.version 优先，否则查此表。 */
  setVersions(map: Readonly<Record<string, string>>): void;
}

/**
 * 让「下一次 loadBundle 真的重新求值该 bundle 的脚本」。
 * - web  ：no-op 返回 true —— 版本表已保证新 URL，模块 id 天然不同。
 * - native：默认返回 false → App 置 pendingRestart；魔改引擎的项目注入真实现返回 true。
 */
export interface IBundleReloader {
  invalidate(bundle: string): boolean;
}
export const BUNDLE_RELOADER: Token<IBundleReloader>;
```

### UIManager 增补（`packages/core/src/ui/`）

```ts
export interface UIManager {
  // …既有
  /** 关闭所有「按当前变体解析后 bundle === 该名」的界面。换 bundle 前的正确性保障。 */
  closeByBundle(bundle: string): void;
}
```

## 五、决策表

| # | 维度 | 选择 | 理由 |
|---|---|---|---|
| 1 | 平台范围 | native + web/H5；小游戏本版不做但接缝不挡死 | 用户定 |
| 2 | 业务 bundle 生效 | **免重启换，两平台都是**（清模块缓存 + 注销类；取不到内部结构则退化为重启） | 实测两轮修正（§二）：md5 换 URL 不等于换 module id，光换版本没用；但把该 bundle 的 module 记录与 cc 类一起清掉就成立，已在真构建产物上跑通 |
| 3 | res 包形态 | 自建 `shared` bundle，不用内置 `resources` | 能配远程包、能拆多份、首包体积可控；内置 resources 与主包绑死 |
| 4 | 分层判据 | 「启动期加载且被跨模块持有引用」 | 比「哪个包」准确；`shared` 可远程但仍按下次启动生效 |
| 5 | App 归属 | core 出纯逻辑 + engine 出适配 | 与全仓一致；启动流程可脱引擎单测 |
| 6 | 启动序列 | 可插拔 `LaunchStep`，复用 `KitModule` 的心智 | 各项目差异全在这段（登录 / SDK / 公告），固定序列必然不够 |
| 7 | 启动 loading UI | kit 只出 `onProgress` 事件，UI 由项目实现 | 这阶段 lobby 未加载、用不了任何 prefab，只能代码化；样式是项目的事 |
| 8 | 失败处理 | 三分类 + 从失败步 `retry()` | 网络重试 / 引导商店 / 兜底，给用户看的东西完全不同 |
| 9 | 版本表落点 | `BundleManager.setVersions`，不放 App | UIManager 内部也 load bundle，放 App 会漏；放这里所有调用点零改 |
| 10 | reloader 粒度 | 单方法 `invalidate(bundle): boolean`，engine 出真实现 | 接口再大都是空转。web 侧由 `loadBundle` 按「版本变了」自动调，用不上这个接口；它存在的理由是 **native 原地覆盖同名文件、版本号看不出变化**，自动路径识别不到，只能由调用方热更落盘后显式调 |
| 11 | compat 闸位置 | 移到 `load(lobby)` 之前 | ADR-0001 的真实暴雷点是第一个业务 bundle 加载时 |
| 12 | 资源默认 bundle | `DEFAULT_BUNDLE` 保持 `'resources'` 不动，**约定所有 `load` 显式带 `bundle`** | 内置 resources 已弃用；隐式默认更难查——忘带就静默走到不存在的 bundle，不如让调用点自己说清楚 |

## 六、平台差异

- **native**：走已有 `AssetsManager` + manifest（ADR-0006 真机 e2e 过）。默认「下完 → `restart()`」，同进程重启 PID 不变、成本低。要免重启换某个 bundle 的代码：热更落盘后显式调 `IBundleReloader.invalidate(bundle)`，再 `release` + 重新 `load`。
- **web/H5**：无 AssetsManager。热更 = 拉版本表 → `setVersions` → 之后的 `load` 自动带新 md5；**已加载过的 bundle 也能免重启换代码**——`loadBundle` 发现版本变了会自动清模块缓存 + 注销旧类（§二 实测）。**必须勾 MD5 Cache**，否则新旧同名文件无法共存、也判断不出版本变化。
- **小游戏**：主包代码只能走平台版本管理（`getUpdateManager`），自建热更仅覆盖分包资源。本版不实现，`IHotUpdateBackend` 已有 `sys.isNative` 守门先例，照抄即可。

## 七、测试计划（core 纯逻辑先行，可脱引擎）

App：
1. 默认序列按 phase 顺序执行，`report` 逐阶段透出
2. 某步抛网络错 → `phase='failed'`、`onFailure({kind:'network',retryable:true})`
3. `retry()` 从失败步继续，前面步骤不重跑
4. compat 闸拒 → `{kind:'needFullUpdate'}`，**不加载 lobby**
5. 自定义 `steps` 整体替换生效；插队步骤按数组序执行
6. native 路径：`update` 返回 `ready` → 调 `restart`（用 fake 断言被调）
7. web 路径：拉到版本表 → `setVersions` 收到该 map
8. ~~`reloader.invalidate` 返回 false → `pendingRestart === true`~~ **本版未做**：`pendingRestart` 无真实消费方（启动期热更直接 restart，运行期换 bundle 本版不自动化），实现时删去

BundleScope：
9. `dispose()` 严格按 §四 的 6 步顺序（用记录调用序的 fake 断言）
10. 单条 teardown 抛错 → 其余照常执行，整体不 reject
11. `dispose()` 幂等，二次调用 no-op
12. i18n 按精确键移除，不误伤同 locale 其它模块的键

BundleManager / UIManager：
13. `setVersions` 后 `load(name)` 带上表里的 version；`opts.version` 显式传入时优先
14. `closeByBundle` 只关解析后 bundle 命中的界面，其余不动
15. `closeByBundle` 对变体 resolver 型 def 按**当前变体**解析

## 八、实施步骤

1. **core（TDD）**：`BundleScope` + `BundleManager.setVersions` + `IBundleReloader` token + `UIManager.closeByBundle`
2. **core（TDD）**：App 层（`createApp` / `defaultLaunchSteps` / 状态机 / 失败分类 / `retry`）
3. **engine**：`appModule()`（装 reloader 默认实现 + `restart` 适配）；`restart` 走 `game.restart()`，web 分支用 `location.reload()`
4. **apps/demo**：`assets/shared/` 建 bundle；`Lobby.scene` + `lobby/*` 挪进 `assets/lobby/` 并标 bundle；`Bootstrap.ts` 改走 `createApp(...).launch()`；`LobbyApp` → `LobbyNav`
5. ~~**验证（浏览器预览）**~~ → **已做（2026-07-31，web-mobile 真构建 + 本机静态托管 + Playwright 驱动）**：
   - ✅ 完整启动序列 0 error（`platform → hotupdate → shared → demo-i18n → lobby → running`）
   - ✅ BundleScope 卸载链路在构建产物里成立（`onHide` → `scope.dispose` → `isLoaded=false`）
   - ✅ **运行期换代码成立**（第二轮修正）：只调 `setVersions({shop:'<新md5>'})` 再进模块 → 新文案出现、
     `classSwapped: true`、0 报错、整页未重载。清缓存由 `IBundleSource.loadBundle` 自动做
   - ✅ 版本不变连续进出两轮不误清缓存（`downloadScript` 的 URL 缓存回归）
   - ✅ 启动期换版本表 + reload → 新代码生效（页面只请求 `index.<新md5>.js`）
   - 🐞 顺带炸出全仓 24 处 **babel loose spread 坑**（`[...set]` → `[].concat(set)`），已全改 `Array.from` 并加 lint 硬规则挡回归。**预览走原生 ESM 不降级 → 这类问题只有真构建能发现**
   - 🧰 托管踩坑：filebrowser 的公开分享**当不了网页服务器**（`attachment` + `octet-stream` + `nosniff` +
     `CSP script-src 'none'`，v2 硬编码无开关）→ 另起了共用同一托管根的静态服务（见 skill `filebrowser-cdn`）
6. ~~**文档收尾**~~ → **已做（2026-07-31）**：新建 `packages/core/docs/modules/app.md`；`bundle-manager.md` 整体改写为现状（含 `BundleScope` / `setVersions` / `IBundleReloader`）；`ui-manager.md` 补 `closeByBundle`；ADR **0009**（包分层判据）+ **0010**（免重启换 bundle 代码）；`progress.md` 更新；本文标「已实施」封存

## 九、仍 YAGNI（本版不做）

- 旧 md5 模块的内存回收（见 Open Q1）
- 小游戏平台适配
- 灰度 / AB / 分渠道版本表
- 断点续传、差量包（AssetsManager 自带的够用）
- 启动 loading 的 kit 内置 UI（只出事件）

## Open Questions

1. ~~**旧 md5 模块要不要清？**~~ **已定（2026-07-31 实测）**：换版本时 `loadBundle` 会把旧 md5 那份的
   module 记录与类一并清掉，不会并存两份。旧脚本本身留在 `downloadScript` 的 URL 缓存里（模块私有、够不到），
   但那只是一份已执行过的 `<script>` 文本，无引用可达、不构成泄漏。
4. ~~**`IBundleReloader` 留还是删？**~~ **已定：留（2026-07-31 实测后）**。它不再是空壳——engine 侧有真实现
   （`invalidateBundleScripts`）。web 用不上它（`loadBundle` 按版本变化自动清），但 **native 原地覆盖同名文件、
   版本号看不出变化**，自动路径识别不到，只能由调用方热更落盘后显式调。见决策 #10。
2. ~~`IAssetLoader` 的 `DEFAULT_BUNDLE` 怎么办？~~ **已定（2026-07-31）**：保持 `'resources'` 不动，**约定所有 `load` 显式带 `bundle`**（见决策 #12）。
3. **`shared` 要不要一开始就拆多份？** 首版单个 `shared`；等首启体积真成问题再拆 `shared-ui` / `shared-config`。
