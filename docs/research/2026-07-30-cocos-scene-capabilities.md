---
状态: 草案（评审中）
摘要: 查清 Cocos Creator 3.8 场景（Scene）的运行时本质、单活动场景约束、切换语义、跨场景常驻、场景装进 Asset Bundle、切换时资源释放与生命周期事件，服务 apps/demo「大厅+可分包功能模块」承载方案 A（挂节点/prefab）vs C（独立场景 sceneflow）的选型。
何时读: 决定功能模块（商城/背包/子游戏/排行榜）用 node 子树/prefab 还是独立 .scene 承载，或质疑该选型时。
日期: 2026-07-30
依赖: docs/research/2026-07-27-asset-and-bundle-survey.md, docs/design/2026-07-24-architecture-overview.md, docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md
---

# Cocos Creator 3.8 场景（Scene）能力调研 —— 服务「大厅+分包模块」承载选型

## TL;DR（先给决策结论）

1. **运行时同一时刻只能有一个活动场景**，官方明文：切场景时旧场景所有节点默认被整体销毁。**这一条直接否决了「把商城/背包这种叠加在大厅之上的面板做成独立场景」**——独立场景无法叠加在大厅之上渲染，切过去大厅就没了。叠加型面板只能是 node 子树 / prefab（方案 A 的路子）。
2. 因此**混合承载**是自然结论：**全屏、可整屏替换、生命周期独立的重模块**（子游戏对局）可用独立场景（方案 C）；**叠加/半屏/需要与大厅共存的模块**（商城、背包、排行榜面板）必须走 node 子树 / prefab（方案 A）。纯 C 做不了叠加面板；纯 A 也完全可行（单引导场景 + 全部 prefab）。
3. 场景可以装进自定义 Asset Bundle，`assetManager.loadBundle` → `bundle.loadScene(name)` → `director.runScene(scene)` 按需加载切换；**放进自定义 bundle 的场景不需要登记到 build「包含场景」列表**（那个列表只管 main bundle）。prefab 走 `bundle.load(path, Prefab)` + `instantiate`。两条路都能做到「一模块一 bundle、按需加载」。
4. 方案 C「靠切场景自动回收内存」的心智省心是**有条件的**：场景资源自动释放取决于该场景 meta 的 `autoReleaseAssets` 开关，**默认关闭**，不勾就不自动释放。方案 A 全程手动管 node/bundle 生命周期。两者都需要显式的资源生命周期纪律，C 并非「免费自动回收」。
5. 框架单例 / DI 容器 / AudioSource / 网络连接等跨场景存活物，标准做法是 `director.addPersistRootNode`（**节点必须是场景根下的直接子节点**）。这是方案 C 必须配套的机制；方案 A 因为大厅场景常驻，天然不需要它。

---

## 逐条回答

> 出处标注约定：【官方文档】= 官方手册/API 明确写了；【源码 v3.8.6】= cocos-engine 源码读到；【源码推断】= 由源码行为推断；【待实测】= 建议 apps/demo 真机验证。

### 1. 场景是什么 · 运行时本质

- **定义（概念）**：场景是「游戏环境要素的抽象集合」，采用「节点树 + 节点组件系统」的自由结构；Node 管理节点树父子关系与 Transform；3D 场景必须有 Camera 组件否则「什么都看不到」。【官方文档】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/concepts/scene/index.html
- **`.scene` 资源**：是把这套「节点-组件」层级持久化存盘的资源文件，可保存/加载完整场景配置。【官方文档】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/asset/scene.html
- **运行时本质**：运行时的当前场景就是一棵挂在 `director` 下的**根节点树**（`cc.Scene`）。`director.getScene(): Scene | null` 返回当前活动场景；切场景时「该场景里所有 node 及其它实例默认被销毁」——即整棵根树被换掉。【官方文档 + 源码 v3.8.6】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/scripting/scene-managing.html ，源码 https://github.com/cocos/cocos-engine/blob/v3.8.6/cocos/game/director.ts （`getScene()` / `runSceneImmediate` 对 `oldScene`、`scene.renderScene` 的处理）
- 说明：`cc.Scene` 是 Node 体系里的根节点类型（Scene 作为节点树的根参与 director 的更新/渲染管线）；「Scene 继承自 Node」这一具体类关系【待代码验证】，但「运行时场景=一棵根节点树」由上面两处一手资料可确证。

### 2. 单活动场景约束（最关键）

- **确定结论：同一时刻只能有一个活动场景，无法让两个场景同时活动 / 叠加渲染。** 官方原文：
  > "The engine will only run one scene at the same time. When switching scenes, all nodes and other instances in the scene will be destroyed by default."
  【官方文档】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/scripting/scene-managing.html
- 源码印证：`director` 只持有单个当前场景，`runSceneImmediate` 里先 `oldScene.destroy()` 再激活新场景——没有「多场景并存」的运行时结构。【源码 v3.8.6】<br>出处：https://github.com/cocos/cocos-engine/blob/v3.8.6/cocos/game/director.ts
- **对决策的硬性影响**：商城/背包这种「叠加在大厅之上的面板」**不可能**做成独立场景（做成独立场景 = 大厅被销毁、无法叠加）。这类模块只能是当前场景里的 node 子树 / prefab。这是 A/C 选型里最刚性的一条约束。

### 3. 场景切换的语义与副作用

- **`director.loadScene(sceneName, onLaunched?, onUnloaded?): boolean`**：按场景资源名加载并切换；内部走 `bundle.loadScene` 拿到 scene 后调 `runSceneImmediate`。【官方文档 + 源码 v3.8.6】
- **`director.runSceneImmediate(scene: Scene | SceneAsset, onBeforeLoadScene?, onLaunched?): void`**：**立即**切换。关键副作用（源码）：
  1. `if (isValid(oldScene)) { oldScene.destroy(); }` —— **旧场景整棵树被销毁**；
  2. 随后（非编辑器构建）`releaseManager._autoRelease(oldScene, scene, this._persistRootNodes)` 处理旧场景 autoRelease 资源；
  3. 常驻节点（persist root nodes）被**重新挂载到新场景**、发 `SCENE_CHANGED_FOR_PERSISTS` 事件，不随旧场景销毁。【源码 v3.8.6】
- **`director.runScene(...)`**：`runSceneImmediate` 的延迟版，`this.once(END_FRAME, () => runSceneImmediate(...))` 推迟到帧末执行（避免在当前帧逻辑中途销毁场景）。【源码 v3.8.6】
- **语义总结**：切场景 = 旧场景**除常驻节点外全部销毁**。进子游戏后，大厅场景的节点、组件状态、内存里非常驻的东西**全没**；要保留的大厅状态必须显式存到常驻节点 / core 层数据 / 存储里，返回时重建。<br>出处：https://docs.cocos.com/creator/3.8/manual/en/scripting/scene-managing.html ，源码 https://github.com/cocos/cocos-engine/blob/v3.8.6/cocos/game/director.ts

### 4. 跨场景常驻（Persistent Root Node）

- **`director.addPersistRootNode(node: Node): void`** / **`director.removePersistRootNode(node: Node): void`**。【官方文档 API 签名】
- 作用：把节点标记为常驻，使其上组件在场景切换间持续存活、不被自动销毁、保留在内存——用于「控制所有场景加载的组件」或「跨场景传参 / 存玩家信息」。【官方文档】
- **约束（明文）**：
  > "The target node must be the root node in the hierarchy, otherwise the setting is invalid."
  即目标节点必须是**场景根下的直接子节点**（层级中的根节点），否则设置无效。`removePersistRootNode` 恢复其随场景销毁的行为，但**不会立即销毁**该节点。【官方文档】
- 源码：切场景时常驻节点被 re-parent 到新场景、保留 `DontSave` 标记。【源码 v3.8.6】
- **标准做法**：框架/DI 容器/AudioSource/网络连接这类跨场景存活物，**是**靠 persist root node（把承载它们的根节点 `addPersistRootNode`）。限制：得是场景根直接子节点；数量宜少、职责集中（通常一个「常驻管理节点」挂全部跨场景服务）。<br>出处：https://docs.cocos.com/creator/3.8/manual/en/scripting/scene-managing.html
- 注：本框架铁律是「逻辑在 core（纯 TS、零 cc）」，跨场景状态更应落在 core 的单例/DI 容器里（走 `globalThis` 注册表，见 ADR-0001），persist root node 主要承载**engine 侧**必须以节点形式存在的东西（AudioSource 节点、常驻 UI 根等）。

### 5. 场景装进 Asset Bundle

- **可以**。把 `.scene` 放进配置为 bundle 的文件夹即可（官方建议 bundle 文件夹放 Scene / Prefab 等入口资源）。【官方文档】
- **加载 API**：
  ```ts
  assetManager.loadBundle('shop', (err, bundle) => {
      bundle.loadScene('ShopScene', (err, scene) => {
          director.runScene(scene);      // loadScene 只加载不运行，需显式 runScene
      });
  });
  ```
  官方原文：`"loadScene will only load the scene from the specified bundle and will not run the scene."`【官方文档】。另：bundle 已加载后，也可直接 `director.loadScene('ShopScene')`（director 会在已加载 bundle 中查找该场景名）【源码推断/待实测】。
- **是否需登记 build「包含场景」列表**：**放进自定义 Asset Bundle 的场景不需要**登记到 Build 面板的「包含场景 / Included Scenes」；那个列表只管内置 `main` bundle 的场景。自定义 bundle 的内容在构建时按 bundle 文件夹自动收集。【官方文档（bundle 章节）+ 通用机制】【建议 apps/demo 实测确认一次】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/asset/bundle.html
- **对比方案 A（prefab 进 bundle）**：`bundle.load('prefab', Prefab, (err, prefab) => { const node = instantiate(prefab); node.setParent(container); })`。同样一模块一 bundle、按需 `loadBundle`。【官方文档】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/asset/bundle.html
- 结论：A、C 两条路**都能**满足「功能模块=一个 Asset Bundle、按需加载、退出释放」；差别只在 bundle 里装的是 `.scene` 还是 `.prefab`/node 子树，以及加载后是 `runScene` 还是 `instantiate`。

### 6. 场景切换的内存 / 资源释放

- **`autoReleaseAssets`（场景级开关）**：在 Assets 面板选中场景 → Properties 面板出现「Auto Release Assets」勾选项 → 勾选并 Apply 后，**切换该场景时其依赖资源自动释放**。**默认值 = false（不勾就不自动释放）**。【官方文档】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/asset/release-manager.html ，https://docs.cocos.com/creator/3.8/manual/en/asset/meta.html
- **`director.loadScene` 是否自动 release**：源码里 `runSceneImmediate` 会调用 `releaseManager._autoRelease(oldScene, scene, persistRootNodes)`（非编辑器构建），但**该逻辑遵循被卸载场景自身的 `autoReleaseAssets` 标记**——默认关闭时不会自动释放旧场景资源。**没有「无条件强制 releaseScene」**。【源码 v3.8.6 + 官方文档】
- **风险提示（官方）**：开了自动释放后，若脚本里持有场景资源的「特殊引用」，切场景后引用失效（资源被释放）→ 渲染问题；需 `Asset.addRef()` 保住。【官方文档】
- **引用计数**：`Asset.addRef()/decRef()`，refCount 归 0 且通过释放检查后自动销毁；释放会级联减少依赖资源的 refCount。【官方文档】（与 `2026-07-27-asset-and-bundle-survey.md` 一致）
- **bundle 资源**：`bundle.release(path, type)` / `bundle.releaseAll()`（连带 bundle 外依赖）/ `assetManager.releaseUnusedAssets()`，均为手动。【官方文档】
- **对比两方案的内存心智**：
  - 方案 C（独立场景）：**只有**给每个模块场景勾上 `autoReleaseAssets` 才有「切场景自动回收」的省心；不勾 = 和 A 一样得手动管。且 bundle 本身的 `releaseBundle`/`releaseAll` 仍需手动决定何时释放整个 bundle。
  - 方案 A（node/prefab）：全程手动 `node.destroy()` + refCount/bundle release（本仓已规划 `AssetRegistry` group 批量释放，见资源横评 D4/N7）。心智负担明确、可控、可 node 测账本逻辑。
  - 结论：C 的「自动回收」不是默认白拿的，两者都要资源生命周期纪律；A 与本框架「account-in-core / IO-in-engine + group 释放」的既定设计更贴合。

### 7. 场景生命周期事件（director）

源码/API 确认三个场景事件常量（值为字符串枚举 `DirectorEvent`）：【官方文档 API + 源码 v3.8.6】

| 事件常量 | 枚举值 | 触发时机（源码序） | 可用来做 |
|---|---|---|---|
| `Director.EVENT_BEFORE_SCENE_LOADING` | `'director_before_scene_loading'` | `loadScene` 开始加载新场景**之前** | 显示 loading 遮罩、埋点开始、暂停输入 |
| `Director.EVENT_BEFORE_SCENE_LAUNCH` | `'director_before_scene_launch'` | 旧场景已销毁、新场景**激活前** | 注入依赖、清理旧场景残留、重挂常驻服务 |
| `Director.EVENT_AFTER_SCENE_LAUNCH` | `'director_after_scene_launch'` | 新场景**激活后** | 隐藏 loading 遮罩、埋点结束、进场动画 |

触发顺序：`loadScene` 发 `BEFORE_SCENE_LOADING` → `runSceneImmediate` 内发 `BEFORE_SCENE_LAUNCH` → 激活 → 发 `AFTER_SCENE_LAUNCH`。【源码 v3.8.6】<br>出处：https://github.com/cocos/cocos-engine/blob/v3.8.6/cocos/game/director.ts ，API：https://docs.cocos.com/creator/3.8/api/en/class/Director
> 注：这些是**方案 C 专属**的接缝（切场景才触发）；方案 A 里 loading 遮罩/埋点得自己在 `loadBundle`/`instantiate` 前后手动埋点，没有引擎级统一事件。

### 8. node 子树 / prefab 承载 vs 独立场景

**加载与挂载**：`bundle.load(path, Prefab, cb)` → `instantiate(prefab)` 得到 Node → `node.setParent(container)` / `addChild` 挂到当前（大厅）场景；退出 `node.destroy()`。【官方文档】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/asset/bundle.html

**生命周期回调**（组件）：【官方文档】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/scripting/life-cycle-callbacks.html
- `onLoad()`：节点**首次激活**时（instantiate 后挂到已激活父节点、或 `node.active` 首次转 true）触发一次。
- `onEnable()`：`active`/`enabled` 由 false→true 时（**每次**，含反复显隐）。
- `start()`：首次 `update` 前一次。
- `onDisable()`：`active`/`enabled` 由 true→false。
- `onDestroy()`：`destroy()` 调用后（帧末回收前）。
- 关键差异：**node 子树反复 `active` 显隐只走 `onEnable/onDisable`，不重跑 `onLoad/start`**；而独立场景每次切入都是全新 instantiate（重跑 `onLoad`）+ 切出整树销毁（走 `onDestroy`）。→ 面板类模块用 node 子树可「隐藏而非销毁」做缓存复用，独立场景做不到（切走即销毁）。

**渲染 / 隔离性**：
- node 子树：所有模块子树共存于**同一场景、同一 Canvas / Camera 体系**，靠兄弟节点层级（sibling index）/ 独立 Camera 分层做叠加与遮挡——**叠加面板天然可行**（商城浮在大厅上）。但**无隔离**：共享全局事件、同名节点/查找、update 循环全跑；多个模块子树相互可见、可能互相干扰（命名冲突、全局监听器串扰、Z 序打架）。
- 独立场景：**强隔离**（切过去只有它自己），但受第 2 条约束——**不能叠加**、切入即销毁大厅。

**内存回收**：
- node 子树：手动 `node.destroy()` + refCount/bundle release；本框架靠 core `AssetRegistry` 的 group 批量释放收口（资源横评 D4）。
- 独立场景：靠 `autoReleaseAssets`（默认关，见第 6 条）+ `releaseBundle`。

**坑**：
- prefab 子树挂到「未激活」父节点时 `onLoad` 不触发，直到父链激活——挂载顺序要注意。【源码推断/待实测】
- 多模块子树共存时全局单例/事件总线要有作用域，否则退出模块得逐一反注册（本仓 EventBus + core 生命周期可覆盖）。
- 独立场景切换的「大厅状态全丢」（第 3 条）需要额外的状态持久化设计。

### 9. 顺带（preloadScene / getScene / frameRate）

- **`director.preloadScene(sceneName, onLoaded?)`（及带 onProgress 的重载）**：后台**预加载场景资源但不切换、不改变当前场景**；之后 `loadScene` 秒切；`loadScene` 早于预载完成调用也安全（预载完成即运行）。【官方文档 + 源码 v3.8.6】<br>出处：https://docs.cocos.com/creator/3.8/manual/en/scripting/scene-managing.html —— 对方案 C 有用：进子游戏前预载其场景消除卡顿。
- **`director.getScene(): Scene | null`**：取当前活动场景。【官方文档 API】
- **`game.frameRate` / 持久化**：与 A/C 选型无实质关联，略。持久化跨场景数据的正解是 persist root node（第 4 条）+ core 层数据/`IStorage`。

---

## 对本框架 A vs C 的影响

### 利弊映射表

| 维度 | 方案 A（挂节点 · 单引导场景 · prefab/node 子树） | 方案 C（独立场景 · sceneflow 切） |
|---|---|---|
| **叠加面板（商城/背包浮在大厅上）** | ✅ 天然支持（同场景兄弟节点/多 Camera 分层） | ❌ **硬性做不到**（单活动场景，切过去大厅即销毁）——第 2 条 |
| **大厅状态保持** | ✅ 大厅场景常驻，状态不丢 | ⚠️ 切子游戏后大厅整树销毁，需显式持久化 + 返回重建 |
| **模块隔离性** | ⚠️ 弱：共享场景/Canvas/全局事件，需作用域纪律 | ✅ 强：切过去只有它自己 |
| **生命周期复用（隐藏而非销毁）** | ✅ `active` 显隐复用，不重跑 onLoad | ❌ 切入即全新 instantiate、切出即销毁 |
| **一模块一 Bundle 按需加载** | ✅ `bundle.load(Prefab)`+`instantiate` | ✅ `bundle.loadScene`+`runScene`（均不需进 build 包含场景列表） |
| **内存自动回收** | ⚠️ 全手动（node.destroy + refCount/group + releaseBundle） | ⚠️ 半自动：需逐场景勾 `autoReleaseAssets`（默认关），否则同样手动 |
| **引擎级切换接缝** | ❌ 无统一事件，loading/埋点自己埋 | ✅ 三个 `EVENT_*_SCENE_*` 事件天然做遮罩/埋点/清理 |
| **跨场景常驻服务** | ✅ 大厅常驻，通常不需 persistRootNode | ⚠️ 必须 addPersistRootNode（节点须为场景根直接子节点）+ core globalThis 单例 |
| **与本框架铁律契合** | ✅ 逻辑在 core、engine 薄壳挂 prefab、group 释放，路径一致 | ⚠️ 场景=编辑器产物，易把逻辑沉到场景里，违「消灭 scene 合并冲突/代码化 UI」约定 |
| **协作冲突面** | ✅ 单引导场景 + prefab，符合 CLAUDE.md「一个空引导场景」 | ❌ 多 `.scene` 文件，回到 scene 合并冲突老路 |

### 关键判断

- **单活动场景约束（第 2 条）是选型的地基**：只要存在「叠加在大厅之上的面板」（商城、背包、排行榜这类半屏/浮层几乎必然如此），**这些模块就不能用独立场景**，只能 node 子树/prefab。纯方案 C 无法覆盖叠加面板，直接出局。
- **本框架 CLAUDE.md 已定调偏 A**：「一个空引导场景，其余全部 prefab + 代码加载 → 从源头消灭 scene 合并冲突」「代码化 UI 优先」——这与方案 A 完全一致，与方案 C 直接冲突。
- **推荐：以 A 为默认承载，C 作为「全屏重对局」的可选特例**。即大厅常驻单场景，商城/背包/排行榜/大部分功能 = bundle 里的 prefab/node 子树按需 `instantiate`；仅当某子游戏是**完全全屏、生命周期彻底独立、且不需与大厅叠加**的重场景时，才考虑用独立 `.scene` + `director.loadScene` 切过去（并配 `preloadScene` 消卡顿、`autoReleaseAssets` 或手动 `releaseBundle` 收内存、persistRootNode 保住跨场景服务）。这既守住铁律与协作约定，又不放弃独立场景在「重对局强隔离/整屏回收」上的优势。

---

## 参考链接清单（一手）

官方手册（3.8）：
- 场景概念：https://docs.cocos.com/creator/3.8/manual/en/concepts/scene/index.html
- 场景资源：https://docs.cocos.com/creator/3.8/manual/en/asset/scene.html
- 加载与切换场景（**单活动场景/切换/常驻/preload 权威页**）：https://docs.cocos.com/creator/3.8/manual/en/scripting/scene-managing.html
- Asset Bundle（场景/prefab 进 bundle、loadScene/load、release）：https://docs.cocos.com/creator/3.8/manual/en/asset/bundle.html
- 资源释放（autoReleaseAssets、refCount、切场景释放）：https://docs.cocos.com/creator/3.8/manual/en/asset/release-manager.html
- meta 文件（场景 autoReleaseAssets 默认值）：https://docs.cocos.com/creator/3.8/manual/en/asset/meta.html
- 组件生命周期回调：https://docs.cocos.com/creator/3.8/manual/en/scripting/life-cycle-callbacks.html
- Prefab：https://docs.cocos.com/creator/3.8/manual/en/asset/prefab.html

API 参考：
- Director（loadScene/runScene/runSceneImmediate/preloadScene/addPersistRootNode/getScene/EVENT_*）：https://docs.cocos.com/creator/3.8/api/en/class/Director

cocos-engine 源码（tag v3.8.6）：
- `cocos/game/director.ts`（切换语义、oldScene.destroy、_autoRelease、常驻节点重挂、场景事件）：https://github.com/cocos/cocos-engine/blob/v3.8.6/cocos/game/director.ts

本仓关联：
- docs/research/2026-07-27-asset-and-bundle-survey.md（资源加载/分包横评，refCount/group 释放/BundleManager 拆分）
- docs/adr/0001-cross-bundle-singleton-and-aot-hotupdate.md（跨 bundle 单例走 globalThis）
