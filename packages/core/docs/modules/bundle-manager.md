---
模块: bundle-manager
所在包: packages/core（`BundleManager` + `BundleScope` + `IBundleSource`/`IBundleReloader` 接缝 + 内存 fake，零 cc）；`cc.assetManager` 适配与脚本缓存失效在 packages/engine（见文末「engine 半适配」）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 按需分包三件套——`BundleManager`（load/release 带引用计数 + 并发去重 + 版本表）、`BundleScope`（一个 bundle 注册的一切都能一行回收，顺序有语义）、`IBundleReloader`（让 bundle 脚本真正失效，免重启换代码）。core 定义接缝 + 内存 fake，engine 落到 `cc.assetManager` 与 SystemJS。
何时读: 要按需加载 / 释放一个功能 bundle 时；要接 web 版本化热更（md5）时；要让「换了 bundle 代码而不重启应用」在正确性上成立时；排查「资源换了但代码还是旧的」时。
日期: 2026-07-31
依赖: [[di-container]]（`BUNDLE_SOURCE`/`BUNDLE_MANAGER`/`BUNDLE_RELOADER` token）、[[asset-manager]]（在某 bundle 内加载资源）、[[ui-manager]]（`closeByBundle`）、[[i18n]]/[[config-table]]（scope 的对称回收）、[[logger]]。跨 bundle 单例 / AOT 约束见 [[adr-0001]]；免重启换 bundle 的机制与契约见 [[adr-0010]]；包分层判据见 [[adr-0009]]。横评见 `docs/research/2026-07-27-asset-and-bundle-survey.md`。
---

# BundleManager 设计文档

## TL;DR

三层，从下往上：

1. **`BundleManager`** —— `load(nameOrUrl, opts?)` 以 bundle 为粒度加载（本地 name 或远程 url，可带 `version`），**引用计数**（同名重复 load 只真加载一次）+ **并发去重**（共享 inflight）+ **失败回滚**；`release(name)` 计数归零才真释放。`setVersions(map)` 存一张 `bundle → 版本(md5)` 表，之后**所有** load 自动带上版本——包括 UIManager 打开界面时内部那次。
2. **`BundleScope`** —— `createBundleScope(bundle)` 让该 bundle 的 i18n / 配表 / 资源 / 任意 teardown 都登记一条对称回收，卸载只需 `await scope.dispose()`。**顺序有语义**：先 `closeByBundle` 销毁界面实例，再逆序回收，最后才 `release(bundle)`。
3. **`IBundleReloader`** —— `invalidate(bundle)` 让下一次 load 真正重新求值该 bundle 的脚本。**换代码 ≠ 换资源**，这是「免重启换 bundle」成立的另一半。

**core 零 cc**：`IBundleSource`（`loadBundle`/`releaseBundle`/`hasBundle` 三原子操作）+ `createMemoryBundleSource()` fake；engine 注册 `cc.assetManager` 适配到 `BUNDLE_SOURCE`、SystemJS 缓存失效到 `BUNDLE_RELOADER`。

## Purpose（目标与定位）

- **做什么**：运行时**按需分包**——「一个功能模块 = 一个 Asset Bundle」，控制首包体积与内存。把散落的 `assetManager.loadBundle` 收敛为一个带引用计数、并发安全、版本感知的入口，并给出「加载了什么就能回收什么」的对称契约。
- **与 [[asset-manager]] 的分工**：**BundleManager 管 bundle 粒度**（整包 load/release、远程版本），**AssetManager 管资源粒度**（在某 bundle 内 load/release 单个资源）。
- **为何引用计数到 bundle 级**：同一 feature bundle 可能被多个界面 / 系统同时依赖，先 load 的不该被后 release 的误卸。
- **为何要有 BundleScope**：i18n 表与配表是把数据**拷进 core 全局注册表**的——只 release bundle 的 JSON 资源撤不掉已注册的表。没有对称回收，「卸了 bundle 但翻译还在」是必然而非偶然。
- **YAGNI（本版砍）**：bundle 间依赖图（Cocos 自身处理）；LRU / 空闲自动卸载；预下载优先级队列；灰度 / 分渠道版本表。

## Public API（TypeScript 精确签名）

```ts
// —— ① 引擎 IO 接缝（core 定义，engine 实现）——
export interface BundleLoadOptions {
  version?: string;                                   // 远程 bundle 版本（出包 md5 等）
  onProgress?: (finished: number, total: number) => void;
}
export interface IBundleSource {
  /** name = BundleManager 统一决定的注册名；opts.url 存在则从该远程 url 取，否则按本地 name 取。 */
  loadBundle(name: string, opts?: BundleLoadOptions & { url?: string }): Promise<void>;
  releaseBundle(name: string): void;
  hasBundle(name: string): boolean;
}
export const BUNDLE_SOURCE: Token<IBundleSource>;
export function createMemoryBundleSource(preset?: { present?: string[] }): IBundleSource;

// —— ② BundleManager（core 纯逻辑）——
export type BundleHandle = { readonly name: string; readonly version?: string };  // 不透明句柄
export interface BundleInfo { readonly name: string; readonly version?: string; readonly refCount: number }
export interface BundleManagerOptions {
  source?: IBundleSource;
  /** 加载前的分包热更。默认 tryResolve(BUNDLE_UPDATER)（**每次 load 现取**）；未注册则不更新。 */
  updater?: BundleUpdater;
  logger?: ILogger;
}

export interface BundleManager {
  /** 已加载→计数+1 立即返回；并发同名→共享 inflight；失败→reject 且不留计数。
   *  未加载且有 updater → 先 `ensureLatest(name)` 再 `source.loadBundle`（远程 url 加载跳过）。 */
  load(nameOrUrl: string, opts?: BundleLoadOptions & { name?: string }): Promise<BundleHandle>;
  /** 计数−1，归零→`source.releaseBundle`；未加载名→告警 no-op。 */
  release(name: string): void;
  isLoaded(name: string): boolean;                    // 计数>0、无 inflight、且引擎侧就绪
  get(name: string): BundleHandle | undefined;
  list(): BundleInfo[];                               // name 升序快照
  /** bundle → 版本（web 出包 md5）。**整体替换不是合并**；load 时 `opts.version` 优先，否则查此表。 */
  setVersions(map: Readonly<Record<string, string>>): void;
}
export function createBundleManager(opts?: BundleManagerOptions): BundleManager;
export const BUNDLE_MANAGER: Token<BundleManager>;
export function getBundleManager(): BundleManager;    // tryResolve ?? 进程默认

// —— ③ BundleScope（对称回收契约）——
export interface BundleScope {
  readonly bundle: string;
  /** 加载本 bundle 的 i18n 表 → addTable；dispose 时按**精确键** removeTable。表须扁平且键带模块前缀。 */
  i18n(locale: string, path: string): Promise<void>;
  /** 加载本 bundle 的配表 JSON（行数组）→ register；dispose 时 unregister。 */
  table<T>(name: string, path: string, tableOpts?: TableOptions<T>): Promise<ConfigTable<T>>;
  /** 从本 bundle 加载一个资源；dispose 时按同键 release。 */
  load<T>(path: string, type?: AssetTypeToken): Promise<T>;
  /** 登记任意对称回收（DI 子作用域 dispose、事件解绑、BindingScope、定时器…）。 */
  add(teardown: () => void | Promise<void>): void;
  /** 回收全部（幂等，单条失败不阻断其余）。**async**：要 await UI 关闭。 */
  dispose(): Promise<void>;
}
export interface BundleScopeDeps {                    // 仅为可测；生产不传
  ui?: Pick<UIManager, 'closeByBundle'>;
  bundles?: Pick<BundleManager, 'release'>;
  assets?: Pick<IAssetLoader, 'load' | 'release'>;
  i18n?: Pick<I18n, 'addTable' | 'removeTable'>;
  tables?: Pick<ConfigTableManager, 'register' | 'unregister'>;
  logger?: ILogger;
}
export function createBundleScope(bundle: string, deps?: BundleScopeDeps): BundleScope;

// —— ④ 脚本失效接缝（core 定义，engine 实现）——
export interface IBundleReloader {
  /** 返回是否真的清掉了脚本缓存；`false` = 本平台 / 本时机做不到，调用方应转重启路径。 */
  invalidate(bundle: string): boolean;
}
export const BUNDLE_RELOADER: Token<IBundleReloader>;
```

## Behavior & data flow（行为与数据流）

### BundleManager

- **注册表**：`Map<name, { version?, refCount, inflight? }>`。`name` 是解析后的注册名（远程取 `opts.name ?? nameOrUrl`）。
- **load**：① 已就绪（有条目无 inflight）→ `refCount++` 返回句柄；② 加载中 → `refCount++` 并 `await` 同一 inflight；③ 未加载 → 建条目 `refCount=1`，`version = opts.version ?? versions[name]`，`inflight = source.loadBundle(...)`；成功清 inflight，失败**回滚条目**（删表、不留计数）并 reject。
- **release**：无条目 → 告警 no-op；否则 `refCount--`，`<=0` → `source.releaseBundle(name)` + 删表（计数夹 0 不为负）。
- **默认 source 解析**：`opts.source ?? tryResolve(BUNDLE_SOURCE) ?? createMemoryBundleSource()`——同 [[save-manager]] 的接缝拾取范式。
- **`setVersions` 为什么在这一层**：UIManager 打开界面时也会 load 它所属的 bundle。版本表放上层（App）就会漏掉那条路径；放这里则所有调用点零改自动带上版本。整体替换而非合并——版本表是服务器下发的一份快照，合并会让删掉的条目阴魂不散。
- **`updater` 为什么也在这一层，且为什么"现取"**：位置同 `setVersions`（所有 load 调用点在这里汇合）。但解析时机不同——`source` 建时定死，`updater` **每次 load 才 `tryResolve`**：它要带 app 戳（`coreApiHash` 闸），而戳是启动后从资源里读出来的，注册必然晚于 BundleManager 创建。定死就等于永远拿不到。
- **更新失败一起失败**：`BundleUpdater.ensureLatest` 契约是「更新不成就 reject」，这里**不吞**，原样抛给调用方（启动期 → 启动失败页·可重试；运行期 → 打开模块失败）。退回包内版本会把「CDN 少传了一个文件」这类发布事故伪装成「玩家在玩旧版」，且包内那份未必存在（从没随包发过的新模块 / 新马甲皮）。远程 url 加载（`opts.name` 形式）跳过更新：那条路径不走 manifest 热更。
- **`BundleHandle` 为何不透明**：core 不持真 `cc.AssetManager.Bundle`。句柄只带 `name`/`version`；engine 要真 Bundle 时 `assetManager.getBundle(name)` 按名反解。

### BundleScope 的回收顺序（有语义，不是随手排的）

```
1. UIManager.closeByBundle(bundle)   ← 必须最先：销毁本 bundle 的界面实例
2. 逆序执行登记的 teardown            ← i18n 反注册 / 配表反注册 / 资源 release / DI 子作用域 / 事件 / 绑定
3. bundleMgr.release(bundle)         ← 最后：前面几步还要用它的资源
```

第 1 步之所以在最前：换版本后 cc 的类表被静默替换（同 uuid 后注册者胜出），旧类的存活实例随即成为**孤儿**——`getComponent(新类)` 找不到它们，任何按类查找都会漏。晚一步就没有可靠手段找回它们了。第 2 步逆序、单条失败只 warn 不阻断其余；`dispose()` 幂等。

**不对称之处**：**load 由调用方做，release 由 scope 做**。加载是打开流程的一部分（要报进度、处理失败、决定时机），回收则是一条不该让每个调用点复述的固定链路。

各 helper 的资源处置也不同，因为持有关系不同：
- `i18n()`：数据已拷进 i18n 注册表 → **立刻 release** JSON 资源，teardown 只 `removeTable(locale, keys)`。
- `table()`：ConfigTable 持有的是 `rows` **引用** → **不 release**，让 JSON 随 bundle 一起走。
- `load()`：teardown 里按同键 release。

### 免重启换代码（`IBundleReloader`）

> 机制的完整实证与平台差异见 [[adr-0010]]。这里只给使用契约。

**换代码 ≠ 换资源。** `releaseAll() + removeBundle()` 把资源（prefab / json / 图集 / i18n）放得干干净净，再进模块时资源确实是新的——但**脚本模块和已注册的 cc 类都还在缓存里**，跑的仍是旧代码，**且没有任何报错**。这是最容易误判「热更生效了」的地方：改了 prefab 或配置会看到变化，改了脚本不会。

两条路径：

| | web / H5 | native |
|---|---|---|
| 新代码怎么到达 | `index.<新md5>.js`，**换了 URL** | 路径不变，靠 `searchPaths` 前置 |
| 谁触发失效 | `setVersions()` 之后 `IBundleSource.loadBundle` 发现版本变了**自动清**，调用方无须显式调 `invalidate` | 版本号看不出变化，自动路径识别不到 → 热更落盘后**调用方显式**调一次 `invalidate(bundle)` |
| 出包约束 | **必须勾 MD5 Cache** | manifest + 覆盖 writable path |

⚠️ **别在版本没变时调 `invalidate`**：web 的引擎按 URL 缓存已下载脚本（`downloadScript` 内模块私有的 `downloaded[url]`），清了缓存那段代码就再也执行不到，下次 load 直接失败。native 无此限制。

完整的「换一个业务 bundle」姿势：

```ts
await scope.dispose();                 // 关界面 → 反注册 → release（正确性的一半）
bundles.setVersions({ shop: newMd5 }); // web：换版本；native：热更落盘后 reloader.invalidate('shop')
await bundles.load('shop');            // 版本变了 → loadBundle 自动清模块缓存 + 注销旧类
```

## Key design decisions（决策表）

| # | 维度 | 选定 | 理由 |
|---|---|---|---|
| 1 | 与 AssetManager 关系 | **拆两模块** | bundle 粒度独立于资源粒度；对齐「一模块一 bundle」+ 给 HotUpdate 留接缝 |
| 2 | 引擎接缝 | `IBundleSource` 注入 | 守铁律 core 零 cc；测试用内存 fake |
| 3 | 生命周期 | **引用计数** | 多依赖方共享一个 bundle，归零才真卸 |
| 4 | 并发同名 load | **inflight 去重** | 并发只真加载一次、共享 Promise，计数正确 |
| 5 | 句柄形态 | 不透明 `{name, version}` | cc 类型不进 core；engine 按 name 反解 |
| 6 | 远程 / 版本化 | 只暴露 name+version 加载 | 三种「热」的策略归 [[hotupdate-service]] 统一入口 |
| 7 | 失败语义 | load reject + 回滚；release 告警不崩 | 加载失败不留脏计数 |
| 8 | DI 便捷 | token + `getBundleManager()` 回退 | 对齐 [[timer]]/[[save-manager]] 范式 |
| 9 | 回收契约落点 | **`BundleScope` 进 core**（原是 demo 的 `ModuleResourceScope`） | `IAssetLoader`/`I18n`/`ConfigTableManager` 都是 core 接口，纯 core 可实现；且它是免重启换代码的正确性前提，不该留在样例里 |
| 10 | 版本表落点 | `BundleManager.setVersions`，不放 App | UIManager 内部也 load bundle，放上层会漏；放这里所有调用点零改 |
| 11 | 版本表语义 | **整体替换**，不合并 | 服务器下发的是一份快照；合并会让被删条目阴魂不散 |
| 12 | 脚本失效粒度 | 单方法 `invalidate(bundle): boolean` | 接口再大都是空转；web 走自动路径用不上它，它存在的理由是 native 原地覆盖同名文件（见 [[adr-0010]]） |
| 13 | 失效失败时 | 返回 `false` 而非抛 | 踩的是 SystemJS / CCClass 的私有内部结构，跨引擎版本可能失效 → 逐层 feature-detect，取不到就退化成「需重启」 |
| 14 | i18n 回收粒度 | 按**顶层键**精确 `removeTable` | 不误伤同 locale 其它模块；代价是表必须扁平（非字符串值会 warn，见「坑」） |

## Platform considerations（全平台 / 小游戏兼容）

- core 三件套纯 TS，全平台无差异。
- engine `IBundleSource` 适配按平台：本地 bundle `assetManager.loadBundle(name)`；远程 `loadBundle(url, {version})`；微信 / 抖音小游戏**分包**由平台 + Cocos 分包机制承载，`loadBundle` 语义一致。
- **无 native AssetsManager 的平台（Web / 小游戏）** 的线上热更 = 远程 bundle 版本化加载 = `setVersions` + md5。
- `invalidate` 的 cc 实现依赖 SystemJS 与 `cc.js` 的内部结构，**web 与 native 同一套代码**（都是 SystemJS 运行时）；小游戏未验证，取不到结构会返回 `false` 而不是崩。
- 跨 bundle 共享 BundleManager 走全局 `BUNDLE_MANAGER` token（[[adr-0001]]）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc。`createMemoryBundleSource()` 作 `IBundleSource` 替身（记录调用、可延迟 / 可抛错）；`BundleScopeDeps` 把 5 个服务收窄成 `Pick<...>` 注入口，用记录**调用序**的 fake 断言回收顺序。
- **BundleManager**（19 例，`__tests__/bundle-manager.test.ts`）：新 load 真调一次 / 同名重复只真调一次 / **并发共享 inflight** / release 计数递减与归零真释放 / 多余 release 夹 0 告警 / 未加载名告警 no-op / load 失败回滚可重试 / 远程 url + `opts.name` / `list` 升序 + 快照 / 默认 source 解析优先级 / `getBundleManager` token 优先与回退 / inflight 期间 `isLoaded=false` / **`setVersions` 后 load 带上表里 version、`opts.version` 显式传入时优先、整体替换语义**。
- **BundleScope**（10 例，`__tests__/bundle-scope.test.ts`）：`dispose()` **严格按 3 段顺序**（调用序 fake 断言 `closeByBundle` 最先、`release(bundle)` 最后）/ teardown **逆序** / 单条抛错其余照常且整体不 reject / **幂等**二次调用 no-op / i18n 按精确键移除不误伤 / 嵌套表 warn / 配表不 release JSON、资源按同键 release / `add` 的任意 teardown 参与逆序。
- engine 侧（`cc.assetManager` 行为、SystemJS 缓存失效）按 [[adr-0002]] 决策 3 **不进 cc mock**，走 apps/demo 真机 / 真构建验证（见下）。

---

## 已知行为与坑

### 落地文件

- **core**：`packages/core/src/bundle/bundle-source.ts`（`IBundleSource` + `BUNDLE_SOURCE` + 内存 fake）、`bundle-manager.ts`（`createBundleManager` + token + `getBundleManager`）、`bundle-scope.ts`（`createBundleScope`）、`bundle-reloader.ts`（`IBundleReloader` + `BUNDLE_RELOADER`）、`index.ts`。
- **engine**：`packages/engine/src/bundle-source.ts`（`createCcBundleSource` + `ccBundleModule` + `invalidateBundleScripts`）、`app-module.ts`（`createCcBundleReloader` 注册）。
- **样例**：`apps/demo/assets/modules/lobby/ModuleContext.ts`（host 把 scope 注入功能模块）、`LobbyHost.ts`（打开 / 关闭时建 scope 与 dispose）。

### engine 半适配

- **`createCcBundleSource`**：`loadBundle`→`assetManager.loadBundle(opts.url ?? name, opts.version ? {version} : null, cb)`（callback promisify）；`releaseBundle`→`getBundle(name)` 后 `bundle.releaseAll()` + `assetManager.removeBundle(bundle)`；`hasBundle`→`!!assetManager.getBundle(name)`。**`onProgress` 忽略**（`ponytail:`）——cc `loadBundle` 不暴露 bundle 级进度，需要进度走 [[hotupdate-service]] 的 AssetsManager backend。
- **版本变化自动失效**：`loadBundle` 内记 `loadedVersions.get(name)`，与本次 `opts.version` **不同**才调 `invalidateBundleScripts(name)`；相同则绝不清（`downloadScript` 的 URL 缓存，见上）。
- **`invalidateBundleScripts(name)`**：从 `System[REGISTRY]`（唯一 symbol 键）取入口 chunk `chunks:///_virtual/<name>`，顺其 `.d` 收集本 bundle 的脚本模块 → 从每个模块的 namespace 取导出的函数（= 它注册的类）→ `js.unregisterClass(...)` → 把每个模块 id 连同 `chunks:///_virtual/<name>` 与 `virtual:///prerequisite-imports/<name>` 从 `System[REGISTRY]` **和** `System.registerRegistry` 两张表里 `delete`。任一层取不到就 `return false`（退化成需重启），不抛。

### 反直觉行为 / 坑

- **资源换了 ≠ 代码换了**：`release` + 重新 `load` 之后 prefab / 配置 / i18n 都是新的，脚本却还是旧的，**没有任何报错**。这是本模块最贵的一个坑，机制见 [[adr-0010]]。
- **两张表缺一不可**：只清 `System[REGISTRY]` 不清 `registerRegistry`（或反过来）都会失败，且失败形态不同（一个是「类换了界面没换」，一个是 `Can not find class` + 组件被静默丢弃）。`registerRegistry` 的条目被 `instantiate` 用过后会置 `null`，**残留的 `null` 仍满足 `in` 判断 → 必须 `delete` 不能置空**。
- **`virtual:///prerequisite-imports/<bundle>` 要按名字单独删**：它是 cc 真正 import 的入口，但依赖方向是「它 → 入口 chunk」，顺 `.d` 走**到不了**它。不删它则 `System.import` 直接命中缓存返回，底下清得再干净也白清。
- **namespace 字段跨 SystemJS 版本会变**：3.8.7 web 产物里是 `.n`（`.C` 是 top-level completion promise），另一些版本 namespace 在 `.C` 上。写死一个字段名会在另一边**静默**拿到空导出（一个类都注销不掉）→ 实现按**形状**挑（排除 thenable），不按字段名赌。
- **类表撞 uuid**（复制 prefab / 脚本忘改 meta）时，后加载的会**无声覆盖**先加载的，没有任何警告。
- **i18n 表必须扁平**：scope 只按顶层键回收，嵌套表被 `addTable` 拍平成 `a.b` 后顶层键删不掉它们 → 显式 warn（`ponytail:`，别静默泄漏）。真要支持嵌套得复刻 i18n 的拍平逻辑。
- **`dispose()` 是 async 的**：因为要 await UI 关闭与可能异步的 teardown。功能模块的 `onHide` 由 `closeByBundle` 调起，**别在 `onHide` 里反手 `dispose`**（会自递归）——回收由 host 统一发起。

### 验证记录

- **四门全绿**（typecheck / build / test / lint）。
- **真机 gameView 预览（Creator 3.8.7）**：`BUNDLE_SOURCE (cc) registered = true` → `load('probe-bundle')` 后 `isLoaded=true` → 在具名 bundle 内加载资源读出全字段 → `release` 后 `isLoaded=false`（`releaseAll`+`removeBundle` 真释放）。
- **web-mobile 真构建 + 浏览器 e2e（2026-07-31）**：`scope.dispose()` 卸载链在构建产物里成立（`onHide` → `isLoaded=false`）；只调 `setVersions({shop:'<新md5>'})` 再进模块 → 新代码生效、`classSwapped: true`、**0 报错、整页未重载**；版本不变连续进出两轮不误清缓存。详见 [[adr-0010]]。

### 当前限制（ponytail / YAGNI）

- `onProgress` 在 cc source 里是空转（引擎不给 bundle 级进度）。
- 无 LRU / 空闲自动卸载、无预下载队列、无 bundle 依赖图。
- `invalidate` 只清脚本与类，**不回收旧 md5 那份 `<script>` 文本**（在引擎模块私有的 URL 缓存里，够不到；无引用可达，不构成泄漏）。
- 版本表只认扁平 `bundle → md5`；分渠道 / 灰度由项目在 `versionUrl` 背后的服务里做。
