---
状态: 草案（评审中）
摘要: 横评 Cocos 3.8 资源加载 + Asset Bundle 分包体系，为 IAssetLoader / AssetManager / BundleManager 定接口形状、引用计数归属、模块拆分边界与可测接缝。
何时读: 设计资源加载/释放、按需分包、远程加载/热更接缝，或质疑相关选型时。
日期: 2026-07-27
依赖: docs/design/2026-07-24-architecture-overview.md, docs/research/2026-07-24-cocos-bundle-aot-probe.md, docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md
---

# 资源加载与分包（IAssetLoader / Bundle）横评

## 目的与范围

第 2 批设施里 **AssetManager（`IAssetLoader`）** 与 **BundleManager（按需分包）** 在 Cocos 里天然不可分——一切资源加载都发生在某个 Bundle 上下文里（`resources` 只是内置 bundle），先 `loadBundle` 再从 bundle `load` 资源。故本横评合并覆盖「资源加载 + 分包」子系统，产出：

- Cocos 3.8 原生资源体系的**事实基线**（API、引用计数、释放、缓存、远程/热更接缝）；
- 关键难点与坑（引用计数正确性、release 时机、跨 bundle 单例、AOT 缺代码——引 `bundle-aot-probe` 实证）；
- 姊妹/开源框架做法（oops-framework、bearluo `@ccc/fw`、godot-core-kit）；
- **设计候选 + 倾向性建议**（接口形状、refcount 归属、AssetManager↔BundleManager 拆分边界、释放策略、可测接缝），供后续两篇模块设计文档定稿。

> 铁律约束：`IAssetLoader` 接口进 `core`（纯 TS、零 cc、可 fake 单测）；cc 实现（包 `assetManager` / `Bundle`）进 `engine`。资源类型（`Prefab`/`SpriteFrame`/`AudioClip`…）是 cc 类型，**不得进 core 接口签名**。

## 一、Cocos 3.8 原生资源体系（事实基线）

### 1.1 三层入口

- **`resources`**：内置 bundle（`assets/resources` 目录），`resources.load(path, type, onComplete)`。最常用但**不参与按需分包**（随主包出）。
- **`assetManager`**（全局单例）：总入口。`assetManager.loadBundle(nameOrUrl, options, onComplete)`、`assetManager.loadAny`、`assetManager.loadRemote(url, options, onComplete)`（加载**非 import 的**远程图/音/视频/文本）、`assetManager.getBundle(name)`。
- **`AssetManager.Bundle`**：一个 Asset Bundle 句柄。`bundle.load(path, type, onProgress, onComplete)`、`bundle.loadDir(dir, ...)`、`bundle.preload/preloadDir`、`bundle.get(path, type)`（取已加载）、`bundle.release(path, type)`、`bundle.releaseAll()`、`bundle.releaseUnusedAssets()`。

### 1.2 回调式 API → 需 Promise 化

原生全是 `(err, asset) => void` 回调风格。框架层要包成 `Promise<T>`（async/await），并统一错误：`onComplete(err, asset)` → `reject(err) / resolve(asset)`。`onProgress(finished, total, item)` 单独作可选进度回调透出。

### 1.3 引用计数与释放（最易错）

- 每个 `Asset` 有 `asset.refCount`，`asset.addRef()` / `asset.decRef(autoRelease=true)`。
- `bundle.release(path, type)` / `assetManager.releaseAsset(asset)`：强制释放（不看 refCount）。
- `assetManager.releaseUnusedAssets()`：释放 refCount≤0 的。
- **依赖资源**：加载一个 prefab 会连带其贴图/材质等依赖；释放时若不走 refCount，直接 `releaseAsset` 可能误删仍被别处引用的依赖 → 黑图/崩溃。**正确姿势是 refCount：加载方 `addRef`，用完 `decRef`**，让引擎按引用计数回收依赖。
- **场景切换自动释放**：`director.loadScene` 默认会 `releaseSceneOnLoad`（释放上一场景 autoRelease 资源）。可用 `assetManager.cacheAsset` / bundle 配置 `autoReleaseAssets` 调整。
- **native 缓存**：原生平台有 `assetManager.cacheManager`（下载文件缓存、LRU），Web 无。

### 1.4 资源类型系统（core 的边界痛点）

`bundle.load(path, type?, ...)` 的 `type` 是 cc 的 `Constructor<Asset>`（如 `Prefab`、`SpriteFrame`、`JsonAsset`）。**这些类型不能进 core**。含义：`IAssetLoader` 的泛型 `T` 只能是**调用方（engine/view 侧）提供**的类型参数，type token 要么在 engine 实现里传 cc 类，要么 core 用**不透明 token**（字符串/opaque handle）由 engine 映射回 cc 类。

### 1.5 分包（Asset Bundle）事实

- 3.x 用 Asset Bundle（替代 2.x subpackage）：内置 / 远程 / 分模块 / 小游戏分包。一个 bundle 可配优先级、压缩、是否远程。
- **构建模式决定跨 bundle 代码/单例行为**（`bundle-aot-probe` 实证）：普通模式共享代码提升 AOT 单份；单 bundle 模式各内联一份 → 静态单例分裂。**⇒ 框架单例必走 `globalThis` 注册表（ADR-0001 已定铁律），不靠 import 的 static。**
- **AOT tree-shake 缺代码**（probe Q4）：跨版本热更「新 bundle 引用主包已裁 API」会**运行到调用点才 `TypeError`**——BundleManager/HotUpdate 设计必须带**版本绑定校验 + core 公共 API 强引用白名单**（ADR-0001）。

## 二、关键难点清单

| # | 难点 | 影响设计处 |
|---|---|---|
| N1 | 引用计数正确性（依赖资源误释放→黑图/崩） | 释放策略 D4：优先 refCount，慎用强制 release |
| N2 | 回调→Promise、进度回调、取消（cc 无原生 cancel） | 接口 D1：Promise + 可选 onProgress；取消用 inflight 去重 + 忽略结果 |
| N3 | 同一资源并发重复加载 | core 侧 inflight 去重账本（纯逻辑，可测）|
| N4 | 跨 bundle 单例分裂 / AOT 缺代码 | BundleManager + HotUpdate 走 globalThis 注册表 + 版本校验（ADR-0001）|
| N5 | 远程 bundle / 版本化（Web/小游戏无 native AssetsManager）| D5：BundleManager 统一本地/远程 loadBundle，版本入口留给 HotUpdate |
| N6 | 资源类型不能进 core | D1：泛型 T + 不透明 type token |
| N7 | 批量释放（一个界面/一局游戏的资源一次性回收）| D4：resource group / scope 归组释放（借鉴 oops）|

## 三、姊妹 / 开源框架横评

- **oops-framework（dgflash，最主流参考）**：`oops.res` 封 `assetManager`。要点可借鉴：① Promise 化的 `load/loadDir/loadRemote`；② **资源组（group）**——按 key 归组，一键 `releaseGroup` 批量释放（对应 N7，界面/关卡级生命周期）；③ 内部维护 refCount 账本，release 走计数而非无脑强删；④ bundle 感知（load 时可指定 bundleName）。是「AssetManager+BundleManager 合一 + group 释放」范式的活样板。
- **bearluo `@ccc/fw`（同作者 Cocos 姊妹框架，见 [[ccc-framework-monorepo-reference]]）**：分层含 `res` 模块。**定稿前应 cross-check 其 `res` 的接口形状与 refcount/bundle 做法**（该仓处迁移中间态，以实际代码为准）。
- **godot-core-kit（同作者 Godot 姊妹，见 [[godot-core-kit-reference]]）**：对标其 ResourceLoader 的接口命名与 DI 挂载方式（KitContext），保持姊妹框架 API 直觉一致。
- **Cocos 官方最佳实践**：`resources` 仅放少量公共资源，其余走 bundle；释放优先 refCount；远程 bundle 版本化用 `loadBundle(url, {version})`。

## 四、设计候选与决策点

### D1 · `IAssetLoader` 接口形状（core）
候选接口（Promise、泛型、零 cc 类型）：
```ts
// core：type 用不透明 token，engine 实现映射回 cc 的 Constructor<Asset>
export type AssetTypeToken = string; // 或 opaque symbol；engine 侧维护 token→cc 类映射
export interface LoadOptions { bundle?: string; type?: AssetTypeToken; onProgress?: (finished: number, total: number) => void; }
export interface IAssetLoader {
  load<T = unknown>(path: string, opts?: LoadOptions): Promise<T>;
  loadDir<T = unknown>(dir: string, opts?: LoadOptions): Promise<T[]>;
  preload(path: string, opts?: LoadOptions): Promise<void>;
  loadRemote<T = unknown>(url: string, opts?: LoadOptions): Promise<T>;
  release(path: string, opts?: { bundle?: string; type?: AssetTypeToken }): void;
  releaseGroup(group: string): void;         // 批量释放（见 D4）
  addToGroup(group: string, path: string, opts?: { bundle?: string }): void;
}
```
**倾向**：Promise 化 + 泛型 `T`（调用方定）+ 字符串 `AssetTypeToken`（engine 侧建 token↔cc 类映射表，如 `'prefab'→Prefab`）。避免 core 出现任何 cc 类型。

### D2 · 引用计数归属：cc 原生 vs 框架自建
- **A：全靠 cc 原生**（engine 实现里 `addRef/decRef`，core 只转发）——简单，但 refCount 逻辑不可 node 测。
- **B：core 建纯 refcount/inflight 账本**（path→{refCount, group, inflightPromise}），engine 只做真加载/真释放的原子操作——**可 node 单测**（N1/N3/N7 的账本逻辑脱离 cc 验证），符合铁律「逻辑可测」。
- **倾向 B（account in core, IO in engine）**：core 侧 `AssetRegistry`（纯逻辑：引用计数、inflight 去重、group 归组、决定"何时真的调 engine release"），engine 侧 `CcAssetLoader` 只实现「真加载一个 / 真释放一个」两个原子 IO。这样最大化可测面，也最贴「core 逻辑 / engine 薄壳」。

### D3 · AssetManager ↔ BundleManager 拆分边界
- **合一（oops 式）**：一个 loader，load 时传 bundleName。简单但 bundle 生命周期（load/release 整个 bundle、远程版本）被埋没。
- **拆二（架构总纲 §7 列法）**：
  - **BundleManager**：bundle 粒度——`loadBundle(name|url, opts): Promise<BundleHandle>`、`releaseBundle(name)`、`getBundle`、版本/远程入口。对应「一模块一 bundle」。
  - **AssetManager（IAssetLoader）**：资源粒度——在某 bundle 内 load/release/group，依赖 BundleManager 拿 bundle 句柄。
- **倾向拆二**：与「feature = 一个 bundle」的协作约定对齐，且 BundleManager 是 HotUpdate（第 3 批）的接缝点。BundleHandle 在 core 侧是不透明句柄（engine 持真 `Bundle`）。

### D4 · 释放策略
- refCount 为主（N1）；**group/scope 批量释放为标配**（N7：一个 UI 关闭、一局结束一次性回收）；场景切换的 cc autoRelease 保留但不作唯一手段。core 账本记录 group 归属，`releaseGroup` 遍历 decRef。

### D5 · 远程加载 / 版本化 与 HotUpdate 接缝
- BundleManager 的 `loadBundle(url, {version})` 统一本地/远程；**版本化与三种"热"归 HotUpdateService（第 3 批）统一入口**，本子系统只暴露「按 name/url+version 加载 bundle」的能力，不自己管热更策略。留接缝、不越界。

### D6 · 可测接缝
- **core（node/vitest，fake）**：`AssetRegistry` 的 refCount/inflight/group 账本——用 fake「原子 IO」（记录 load/release 调用）验证「并发去重只真加载一次」「refCount 归零才真释放」「releaseGroup 批量 decRef」。
- **engine（cc mock 封顶，见 ADR-0002）**：`CcAssetLoader` 薄壳只测「调用转发 + Promise 化 + 错误映射」；**真实资源加载/释放/依赖回收走 apps/demo 集成验证**（真 cc），不 mock 引擎资源行为（防 mock creep）。

## 五、倾向性建议（供设计定稿）

1. **拆两个模块**：`BundleManager`（bundle 粒度、含远程/版本入口）+ `AssetManager`/`IAssetLoader`（资源粒度、依赖前者）。
2. **account-in-core / IO-in-engine**：core 持 `AssetRegistry`（refCount + inflight 去重 + group）纯逻辑可测；engine `CcAssetLoader`/`CcBundleManager` 薄壳包 `assetManager`/`Bundle`，只做原子 IO + Promise 化 + 错误映射。
3. **接口零 cc 类型**：泛型 `T` + 字符串 `AssetTypeToken`（engine 侧 token↔cc 类映射）+ 不透明 `BundleHandle`。
4. **释放：refCount 为主 + group 批量**；远程/版本化留给 HotUpdate（第 3 批），本子系统只留接缝。
5. **单例走 globalThis 注册表**（ADR-0001），BundleManager 版本绑定校验待 HotUpdate 落地时接上。

## Open Questions（留给设计文档 / 定稿前确认）

1. `AssetTypeToken` 用**字符串枚举**（`'prefab'|'spriteFrame'|...`）还是让 engine 侧直接收 cc `Constructor`（core 接口用 `unknown` 占位、仅在 engine 泛型收窄）？前者 core 可读性好、后者更贴 cc 原生。
2. `BundleHandle` 在 core 侧的最小形状——纯 opaque（`symbol`/id 字符串）还是带 `name`/`version` 只读元信息？
3. 是否首版就做 **group 批量释放**，还是先只做 refCount、group 留到 UIManager 落地时按真实需求补？
4. 与 **UIManager**（下游，加载 prefab）、**AudioService**（加载 clip）的接缝：它们直接依赖 `IAssetLoader`，还是各自再包一层？建议直接依赖，避免重复封装。
5. cross-check **bearluo `@ccc/fw` 的 `res` 模块**实际接口，定稿前对齐命名/refcount 做法。
6. `resources` 内置 bundle 是否显式建模为 BundleManager 里一个 name=`'resources'` 的特殊 bundle（统一入口），还是单独留 `resources` 快捷方法？
