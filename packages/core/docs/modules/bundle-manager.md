---
模块: bundle-manager
所在包: packages/core（BundleManager 纯逻辑 + IBundleSource 接缝 + 内存 fake，零 cc）；cc.assetManager.loadBundle 适配走 engine（后续）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 按需分包管理 createBundleManager——load(name|url)/release(name) 以 bundle 为粒度，带引用计数 + 并发去重 + 版本/远程入口，经异步 IBundleSource 接缝落到引擎。core 定义 IBundleSource（真加载/真释放一个 bundle）+ 内存 fake；engine 后续接 cc.assetManager。
何时读: 需要运行时按需加载/释放一个功能 bundle、远程 bundle 版本化加载，或为热更留分包接缝时。
日期: 2026-07-27
依赖: di（BUNDLE_SOURCE/BUNDLE_MANAGER token + tryResolve）、logger（告警）。IBundleSource 的 cc.assetManager 适配走 engine（ADR-0002，后续）。与 [[asset-manager]] 配套（AssetManager 在某 bundle 内加载资源）。横评见 docs/research/2026-07-27-asset-and-bundle-survey.md。跨 bundle 单例/AOT 约束见 [[adr-0001]]。
---

# BundleManager 设计文档

## TL;DR

`createBundleManager({ source?, logger? })` 返回一个 `BundleManager`：`load(nameOrUrl, opts?)` 以 **bundle 为粒度**加载一个 Asset Bundle（本地 name 或远程 url，可带 `version`），返回不透明 `BundleHandle`；内部**引用计数**（同名重复 load 只真加载一次、计数 +1）+ **并发去重**（并发 load 同名共享同一 inflight Promise）；`release(name)` 计数 −1，**归零才真释放**。**core 零 cc**：定义 `IBundleSource`（异步 `loadBundle` / `releaseBundle` / `hasBundle` 三原子操作）接缝 + 自带 `createMemoryBundleSource()`（默认/测试用）；engine 后续注册 `cc.assetManager` 适配到 `BUNDLE_SOURCE`，`createBundleManager()` 自动拾取。远程/版本化只暴露「按 name/url+version 加载」的能力，**热更策略归第 3 批 HotUpdateService**，本模块只留接缝。所有失败收敛：`load→reject`（调用方 catch）、`release`/无效名→告警不崩。

## Purpose（目标与定位）

- **做什么**：运行时**按需分包**——「一个功能模块 = 一个 Asset Bundle」，控制首包体积与内存。把散落的 `assetManager.loadBundle` 收敛为一个带引用计数、并发安全、版本感知的入口。
- **定位/取舍**：与 [[asset-manager]] 分工——**BundleManager 管 bundle 粒度**（整包 load/release、远程版本），**AssetManager 管资源粒度**（在某 bundle 内 load/release 单个资源）。AssetManager 依赖本模块拿到「某 bundle 已就绪」。拆分理由见横评 D3（对齐协作约定、给 HotUpdate 留接缝）。
- **为何引用计数到 bundle 级**：同一 feature bundle 可能被多个界面/系统同时依赖，先 load 的不该被后 release 的误卸。计数归零才真释放，避免「A 还在用、B 释放把整包卸了」。
- **YAGNI（首版砍）**：热更/manifest/增量下载（归 HotUpdateService 第 3 批，本模块只留 `version` 入口）；bundle 预下载优先级队列；bundle 间依赖图（Cocos 自身处理 bundle 依赖，框架不重复建模）；LRU 自动卸载（先手动 release，需要时再加空闲回收）。

## Public API（TypeScript 精确签名）

```ts
// —— 引擎 IO 接缝（core 定义，engine/项目实现）——
export interface BundleLoadOptions {
  version?: string;                                   // 远程 bundle 版本（md5 前缀等）
  onProgress?: (finished: number, total: number) => void;
}
export interface IBundleSource {
  // 真加载；name=BundleManager 统一决定的注册名，opts.url 存在则从该远程 url 取、否则按本地 name 取。
  loadBundle(name: string, opts?: BundleLoadOptions & { url?: string }): Promise<void>;
  releaseBundle(name: string): void;                  // 真释放整个 bundle
  hasBundle(name: string): boolean;                   // 引擎侧是否已就绪
}
export const BUNDLE_SOURCE: Token<IBundleSource>;      // engine 注册 cc.assetManager 适配
export function createMemoryBundleSource(preset?: { present?: string[] }): IBundleSource;  // 测试/默认 fake

// —— BundleManager（core 纯逻辑）——
export type BundleHandle = { readonly name: string; readonly version?: string };  // 不透明句柄；engine 按 name 反解真 Bundle
export interface BundleInfo { readonly name: string; readonly version?: string; readonly refCount: number; }
export interface BundleManagerOptions {
  source?: IBundleSource;    // 默认 DI BUNDLE_SOURCE，未注册则内存 fake
  logger?: ILogger;
}
export interface BundleManager {
  /** 加载/引用一个 bundle。nameOrUrl：本地 name 或远程 url；远程时用 opts.name 指定注册名（默认取 url 末段）。
   *  已加载→计数+1 立即返回；并发同名→共享 inflight；失败→reject（不计数）。 */
  load(nameOrUrl: string, opts?: BundleLoadOptions & { name?: string }): Promise<BundleHandle>;
  /** 释放/解引用一个 bundle。计数−1，归零→source.releaseBundle。未加载名→告警 no-op。 */
  release(name: string): void;
  isLoaded(name: string): boolean;                    // 计数>0 且引擎侧就绪
  get(name: string): BundleHandle | undefined;        // 已加载取句柄
  list(): BundleInfo[];                               // 已加载 bundle 快照（name 升序）
}
export function createBundleManager(opts?: BundleManagerOptions): BundleManager;

export const BUNDLE_MANAGER: Token<BundleManager>;
export function getBundleManager(): BundleManager;    // tryResolve(BUNDLE_MANAGER) ?? 进程默认
```

## Behavior & data flow（行为与数据流）

- **注册表**：`Map<name, { version?, refCount, inflight?: Promise<void> }>`。`name` 是解析后的 bundle 名（远程取 `opts.name ?? url 末段`）。
- **load(nameOrUrl, opts)**：解析 `name` → 查表：
  1. 已就绪（有条目且无 inflight）→ `refCount++`，返回 `{name, version}`；
  2. 正在加载（有 inflight）→ `refCount++`，`await` 同一 inflight（**并发去重 N3**），成功返回句柄；
  3. 未加载 → 建条目 `refCount=1`、`inflight = source.loadBundle(nameOrUrl, opts)`；成功 → 清 inflight、记 version、返回句柄；失败 → **回滚条目**（删表、不留计数）、`reject(err)`。
- **release(name)**：无条目 → 告警 no-op；否则 `refCount--`；`<=0` → `source.releaseBundle(name)` + 删表。（下探：release 比 load 多调不该把计数打成负，夹到 0。）
- **isLoaded**：条目存在、无 inflight、且 `source.hasBundle(name)`。
- **默认 source 解析**：`opts.source ?? getRootContainer().tryResolve(BUNDLE_SOURCE) ?? createMemoryBundleSource()` —— 同 [[save-manager]] 的接缝拾取范式。
- **与 cc 边界**：BundleManager/IBundleSource/内存 fake 全在 core（零 cc）。engine 侧实现一个 `IBundleSource`：`loadBundle`→`assetManager.loadBundle(nameOrUrl, {version}, cb)`（Promise 化）、`releaseBundle`→释放该 bundle 资源后 `assetManager.removeBundle`、`hasBundle`→`!!assetManager.getBundle(name)`——属**有状态引擎行为**，按 ADR-0002 不进 cc mock，走 apps/demo 集成验证。
- **BundleHandle 为何不透明**：core 不持真 `cc.AssetManager.Bundle`（cc 类型不进 core）。句柄只带 `name`/`version` 只读元信息；engine 侧要真 Bundle 时用 `assetManager.getBundle(name)` 按名反解。[[asset-manager]] 的 `load({bundle})` 也只传 name。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | 与 AssetManager 关系 | 合一 loader / **拆两模块** | **拆两模块**（用户定 2026-07-27） | bundle 粒度独立于资源粒度；对齐「一模块一 bundle」+ 给 HotUpdate 留接缝（横评 D3）|
| 2 | 引擎接缝 | core 直接 cc.assetManager / **IBundleSource 注入** | **IBundleSource 注入** | 守铁律 core 零 cc；测试用内存 fake，engine 接 assetManager |
| 3 | 生命周期 | 一次性 load / **引用计数** | **引用计数** | 多依赖方共享一个 bundle，归零才真卸，防误释放 |
| 4 | 并发同名 load | 各自加载 / **inflight 去重** | **inflight 去重** | 并发只真加载一次、共享 Promise，计数正确（N3）|
| 5 | 句柄形态 | 真 Bundle / **不透明 {name,version}** | **不透明** | cc 类型不进 core；engine 按 name 反解真 Bundle（Open Q2→定）|
| 6 | 远程/版本化 | 本模块管热更 / **只暴露 name+version 加载** | **只留接缝** | 三种「热」归 HotUpdateService 第 3 批统一入口（横评 D5）|
| 7 | 失败语义 | 抛到顶 / **load reject + 回滚、release 告警** | **收敛** | 加载失败不留脏计数；调用方 catch 保底 |
| 8 | DI 便捷 | 仅工厂 / **BUNDLE_SOURCE + BUNDLE_MANAGER token + getBundleManager** | **都给** | 对齐 [[timer]]/[[save-manager]] token+fallback 范式 |

## Platform considerations（全平台 / 小游戏兼容）

- core（BundleManager/内存 fake）纯 TS，全平台无差异。
- engine `IBundleSource` 适配按平台：原生/Web 本地 bundle 用 `assetManager.loadBundle(bundleName)`；远程 bundle 用 `loadBundle(url, {version})`；微信/抖音小游戏**分包**由平台 + Cocos 分包机制承载，`loadBundle` 语义一致。
- **无 native AssetsManager 的平台（Web/小游戏）** 的线上热更 = 远程 bundle 版本化加载——由本模块 `version` 入口 + 第 3 批 HotUpdateService 组合实现。
- 跨 bundle 共享 BundleManager 走全局 `BUNDLE_MANAGER` token（[[adr-0001]] 全局根容器）；单例分裂/AOT 缺代码约束见 ADR-0001。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；`createMemoryBundleSource()` 作 IBundleSource 替身（记录 loadBundle/releaseBundle 调用、可配可延迟/可抛错），注入 fake logger 断言告警。
- **用例清单**（规划）：
  1. load 新 bundle → 真调 source.loadBundle 一次、返回句柄、isLoaded=true；
  2. 同名重复 load → source.loadBundle **只调一次**、refCount=2；
  3. **并发** load 同名（两个未 await 的 Promise）→ 共享 inflight、source 只调一次、两者都 resolve；
  4. release 一次 refCount=2→1 不真释放；再 release→0 真调 source.releaseBundle + 删表；
  5. release 多于 load → 计数夹 0、告警、不负；
  6. release 未加载名 → 告警 no-op；
  7. load 失败（source 抛错）→ reject、**不留条目/计数**、可重试；
  8. 远程 url + opts.name → 以 name 注册、句柄带 version；
  9. list 升序 + refCount 快照；get 有/无；
  10. 默认 source 解析：DI BUNDLE_SOURCE 优先、未注册退内存 fake；
  11. getBundleManager token 优先/回退；
  12. isLoaded 在 inflight 期间为 false、就绪后 true。

## Open Questions（已决议 · 2026-07-27 定稿）

1. **拆两模块**：✅（用户定）。
2. **BundleHandle 形态**：✅ 不透明 `{name, version}` 只读元信息（Open Q2→定）。
3. 远程 bundle 的默认注册名：取 `opts.name ?? url 末段`；跨平台 url 末段解析细节留实现期按真实 url 形态调。
4. bundle 级 LRU/空闲回收：YAGNI，先手动 release。

---

## 实现记录

- **落地文件**：`packages/core/src/bundle/bundle-source.ts`（`IBundleSource` + `BundleLoadOptions` + `BUNDLE_SOURCE` + `createMemoryBundleSource`）、`bundle-manager.ts`（`createBundleManager` + `BundleManager`/`BundleHandle`/`BundleInfo`/`BundleManagerOptions` + `BUNDLE_MANAGER` + `getBundleManager`）、`index.ts`；core `index.ts` re-export（`export * from './bundle'`）。
- **最终 API 与设计偏差**：`IBundleSource.loadBundle` 由设计初稿的 `loadBundle(nameOrUrl, opts)` 调整为 **`loadBundle(name, opts & { url? })`**——名义（name）由 BundleManager 统一决定（本地=nameOrUrl，远程=opts.name）并传入 source 的三个方法，`url` 仅远程加载作 fetch 提示。收益：内存 fake 与 manager 一致按 name 记账，不必重复 name 派生逻辑。其余按定稿（引用计数 + inflight 去重 + 失败回滚 + token/fallback）。
- **测试结果 / 覆盖率**：`bundle-manager.test.ts` **16 用例全绿**；`bundle-source.ts`、`bundle-manager.ts` 均 **100% Stmts/Branch/Funcs/Lines**（全量 232 passed）。
- **commit / PR**：待提交（与 [[asset-manager]] 同批）。
- **遗留 Minors**：engine 侧 `IBundleSource` 的 `cc.assetManager`（`loadBundle`/`getBundle`/`removeBundle`）适配 + 注册 `BUNDLE_SOURCE`（随 apps/demo 集成）；远程 bundle 命名与真实 url 末段解析、版本绑定校验随 HotUpdateService（第 3 批）。
