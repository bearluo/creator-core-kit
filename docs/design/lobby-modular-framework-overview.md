---
主题: lobby-modular-framework（大厅 + 可分包功能模块框架）
范围: 跨包（apps/demo 样例 + core: ui-manager/i18n/config-table 补缺 + engine 适配）
状态: 评审中（§9 四个 Open Question 已决议 2026-07-30；补缺+样例落地后转已实现）          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 一个「常驻框架根 + 一切功能皆可分包」的大厅框架样例。大厅/子游戏/商城等功能各是一个 Asset Bundle，
      按需 load/release；框架根节点常驻（addPersistRootNode）跨场景存活，模块按 kind 承载（面板挂常驻根、
      全屏世界用自带场景）；模块自带的 i18n/配表/音频/prefab 随 bundle 一起加载、一起释放（模块作用域资源）。
何时读: 设计/实现 apps/demo 大厅框架样例前；或需要「分包功能模块 + 模块作用域资源生命周期」范式时。
日期: 2026-07-30
依赖: [[bundle-manager]]（按需 load/release bundle）、[[ui-manager]]（open 面板，需补 bundle?）、
      [[asset-manager]]（bundle 内加载资源）、i18n（需补 removeTable）、config-table（需补 unregister）、
      DI（模块子作用域）、[[sceneflow]]（全屏世界切场景，可选）。场景能力一手调研见
      docs/research/2026-07-30-cocos-scene-capabilities.md。
---

# 大厅 + 可分包功能模块框架（overview）

## TL;DR

给 `apps/demo` 做一个**大厅框架样例**：一个常驻大厅，子游戏、商城、背包、排行榜等功能**各自是一个 Asset Bundle**，
按需 `BundleManager.load` 加载、退出 `release`。**框架根节点常驻**（`director.addPersistRootNode`），承载
kit（DI/音频/…）+ 大厅导航 UI + 模块挂载层，**跨场景存活**。模块按 `kind` 承载：
**面板类（商城）= 从模块 bundle 加载 prefab 挂到常驻根的 UI 层**（单活动场景约束下面板不能是独立场景）；
**全屏世界类（重子游戏/3D）= 用它 bundle 里自带的 `.scene`**（携带编辑器配置的 SceneGlobals/相机/环境），
`bundle.loadScene` 切过去、常驻框架在其上存活。**模块自带的 i18n/配表/音频/prefab 随 bundle 一起加载、
一起释放**（模块作用域资源）——bundle 没加载就不该有它的配置，卸载 bundle 就连配置一起下掉。为此需补三处 kit 小缺口：
`UIManager.open({bundle})`、`i18n.removeTable`、`ConfigTableManager.unregister`。

## 1. 目标与定位

- **做什么**：教一个新项目「大厅 + 一切功能皆可分包」怎么在 kit 上搭。既是 apps/demo 的接入样例，也顺带补齐
  kit 里「模块作用域资源」需要的小原语。
- **和验证探针的关系**：旧的逐模块验证探针（`DemoBoot` / `Demo.scene` / `probe-bundle`）迁进 `assets/test/`，
  与本框架样例物理隔离，互不干扰（探针继续作回归用）。
- **YAGNI（首版砍）**：模块间路由历史/返回栈（大厅→模块→模块的深层导航）；模块热更（归 HotUpdateService）；
  模块预下载优先级；模块 A 直接依赖模块 B（模块只经 catalog + 事件解耦，不互相 import）。

## 2. 架构：常驻框架根 + 模块按 kind 承载

### 2.1 常驻框架根节点（persist root）

- Boot.scene 里建一个框架根节点 `CCKApp`，`director.addPersistRootNode(CCKApp)` 提为常驻（**要求：常驻节点必须是
  场景根的直接子节点**，见调研第 4 条）。其下挂：
  - kit 组合根（`bootCoreKit` 的产物：DI 容器 / 音频 / timer / …）；
  - 大厅导航 UI（代码化 UI，列 catalog）；
  - **模块挂载层**（一个 UI 容器节点，`kind:'panel'` 模块挂这）。
- 常驻 = 跨 `loadScene` 存活。这样即便切到某个全屏世界模块的场景，大厅框架（含"返回大厅"入口）依然在其上渲染。
- **纯 A（单场景）场景下常驻并非必需**（Boot 永不卸载），但把框架根设为常驻是**统一前提**：让"全屏世界=自带场景"
  这条路（2.2）无需丢失框架，二者共用一套骨架。
- **Boot 空引导 + CCKApp 承载全部 + 幂等 bootstrap（关键）**：Boot.scene 做成**空引导场景**（无相机/无 UI，只一个 bootstrap 节点）；
  相机 / Canvas / kit / 大厅 UI / 模块挂载层**全部建在常驻 `CCKApp` 上，只在首次启动 boot 一次**。从 game 场景返回时
  `loadScene(Boot)` → Boot 仍是空的、`CCKApp` 常驻还在 → bootstrap **幂等**（检测到 `CCKApp` 已存在就跳过 `bootCoreKit`/建 UI，
  只重新显示大厅）→ **杜绝二次启动 kit**。这把「一个空引导场景，其余全部 prefab+代码加载」铁律落到字面。
- **多相机共存**：进 game 场景时其自带相机渲染世界，`CCKApp` 的 UI 相机在其上渲染大厅覆盖层（返回入口等）；返回空 Boot 时仅 UI 相机活动。属常规 3D+UI 相机分层。

### 2.2 承载矩阵（按 kind）

| kind | 典型 | 承载方式 | 加载 | 卸载 |
|---|---|---|---|---|
| `panel` | 商城 / 背包 / 排行榜 | 从模块 bundle 加载 **prefab**（或代码化 UI），**挂到常驻根的模块挂载层**（叠加在大厅上） | `load(bundle)` → `uiMgr.open(id, {bundle})` / 代码建 UI | close → 销毁挂载子树 + `release(bundle)` |
| `game` | 全屏子游戏（3D/重场景） | 用模块 bundle 里**自带的 `.scene`**（携带编辑器 SceneGlobals/相机/环境），常驻框架在其上存活 | `load(bundle)` → `bundle.loadScene(sceneName)` | 返回 → `loadScene(base)` + `release(bundle)` |

- **为何面板必须是 A（挂常驻根）不是独立场景**：Cocos 运行时**同一时刻只有一个活动场景**（调研第 2 条，官方明文），
  切场景旧场景整树销毁——叠加面板（商城浮在大厅上）根本没有"两个场景同时在场"可言，**只能是当前（常驻）层的 node 子树/prefab**。
- **为何全屏世界可以是 C（自带场景）**：靠常驻框架根，`loadScene` 到世界场景时框架不丢；世界场景带上自己在编辑器里配好的
  环境（见 2.3）。轻量子游戏（2D、无特殊环境）也可直接走 `panel` 式挂常驻根，不必非得开场景。
- **不违反「一个空引导场景」铁律**：铁律本意是杜绝**共享**场景的合并冲突；每个世界模块自带的 `.scene` 在它自己 bundle、
  单人 own，零共享冲突——恰是"feature-based，一模块一 bundle 一目录"的落地。

### 2.3 场景 = 编辑期配置单元（不是可有可无的节点树）

cc 的 `.scene` 不只是运行时一棵根节点树，它在**编辑器里承载可配置属性**并序列化进文件：

- **SceneGlobals**（选中场景根在 Inspector 配）：环境光 ambient、天空盒/IBL skybox、雾 fog、阴影 shadows、
  后处理 post-process、光照探针 / 烘焙 bake、octree 剔除等——**这些只能在场景级配置，prefab 与纯代码 UI 拿不到**。
- 编辑器可视化编排的**节点层级 + 组件属性值**（拖拽搭场景 / 连引用）。
- **含义**：需要独立环境/相机/光照的**全屏世界模块**，做成自带 `.scene` 才能吃到这套编辑期配置（故 2.2 的 `game` 走 C）；
  而叠加面板（商城）在共享常驻层上，用 prefab 承载其编辑期编排即可（prefab 也有编辑期属性，但没有场景级 SceneGlobals）。
- 待补：调研文档 `2026-07-30-cocos-scene-capabilities.md` 的「场景是什么」目前偏运行时定义，后续补一节 SceneGlobals/编辑期属性。

### 2.4 场景导航栈（用 core SceneFlow，Q4 决议）

`game` 类模块切场景走 **core `SceneFlow` 的 pushdown 栈**（`push`/`pop`/`onPause`/`onResume`，已实现、MAX_STACK=32，demo 迄今未用）：
大厅 = 一个 state；进 game → `push(gameState)`（`onEnter` 里 `bundle.loadScene`）；返回 → `pop`（切回 Boot）。

- **诚实语义**：Cocos 单活动场景 → 栈存的是**返回目标场景名**，`pop` = 重新 `loadScene` 该目标，**不是恢复活着的旧场景**；
  live 状态保持靠常驻 `CCKApp`（大厅状态天然不丢）。样例 mini-dodge 深度=1，栈到位但只演示一层；`game→game` 多级不堵路。
- **为何不裸切**：栈机制零新写（复用 sceneflow）、满足返回栈诉求、顺带展示 sceneflow 模块。

## 3. FeatureModule 契约 + 生命周期

```ts
/** 框架注入给模块的运行上下文。 */
export interface ModuleContext {
  readonly root: Node;            // 模块挂载根（常驻框架下的一个容器节点；panel 用；game 走场景时可空）
  readonly container: Container;  // 模块专属 DI 子作用域（卸载即 dispose，隔离模块单例）
  readonly bundle: string;        // 本模块 bundle 名，模块用它加载自带资源（i18n/config/audio/prefab）
  readonly args?: unknown;        // 打开传参
  close(): void;                  // 模块请求关闭自己 → 框架走 unmount + 释放
}

/** 一切可分包功能模块的统一契约（type-only，编译期擦除，模块 bundle 不产生对主包的运行时依赖）。 */
export interface FeatureModule {
  /** 挂载：加载自带资源（{bundle} 作用域）、建 UI/进场景、挂到 ctx.root。可 async。 */
  mount(ctx: ModuleContext): void | Promise<void>;
  /** 卸载：与 mount 对称回收——撤自带 i18n 表、反注册配表、销毁 UI、释放 asset。可 async。 */
  unmount(): void | Promise<void>;
}
```

**大厅 host 对一个 `panel` 模块的生命周期**（`game` 类同，mount/unmount 换成 `bundle.loadScene` / 切回 base）：

1. `await bundleMgr.load(bundle)`（引用计数 + 并发去重，已实现）；
2. 从已加载 bundle 取模块入口（见 Open Q1：注册表自登记 vs `js.getClassByName`）；
3. 造 `ModuleContext`：DI 子作用域 + 常驻根下新建挂载容器 + bundle 名；
4. `await module.mount(ctx)`；
5. close 时：`await module.unmount()` → dispose 模块 DI 子作用域 → 销毁挂载容器 → `bundleMgr.release(bundle)`。

## 4. 模块作用域资源（核心约束）

> **bundle 没加载，就不该有它的 i18n / 配表 / 音频 / prefab；卸载 bundle，就连它们一起下掉。**（用户 2026-07-30 定）

- 模块的自带资源**全部经 `{bundle: ctx.bundle}` 从模块自己的 bundle 加载**，在 `mount` 里发起：
  - i18n：`loadLocaleTable(locale, path, { bundle })`（已支持 bundle）；
  - 配表：`loadTable(name, path, { bundle })`（已支持 bundle）；
  - 面板 prefab：`uiMgr.open(id, { bundle })`（**待补 bundle?**，见 §5）；
  - 音频 clip / 其它资源：`getAssetLoader().load(path, { bundle })`（已支持 bundle）。
- `unmount` 里**对称回收**。难点：i18n/config 是把数据**拷进 core 全局注册表**的，仅 `bundleMgr.release` 释放 bundle 的
  JSON 资源**撤不掉已注册的表**——必须显式反注册（**待补 i18n.removeTable / config.unregister**，见 §5）。
- **推荐实现**：给模块一个 `ModuleResourceScope`（仿 `BindingScope`）——mount 里所有 `load*` 经它登记，`unmount` 一行
  `scope.dispose()` 反做全部（removeTable / unregister / release / unbind）。模块作者不用手写逐条回收。
- **命名空间约定**：模块 i18n 键、配表名建议带模块 id 前缀（如 `shop.title` / 表名 `shop.goods`），避免跨模块撞名，也让
  removeTable/unregister 能按前缀精确撤。

## 5. 需要补的 kit 缺口（小、TDD、随文档）

| # | 模块 | 现状 | 补什么 | 影响文件 |
|---|---|---|---|---|
| 1 | ui-manager | `open` / `IUIView`/`UIViewSpec` 无 bundle | `UIOpenOptions.bundle?` → `UIViewSpec.bundle?` → engine `cc-ui.ts create` 透传给 `load(prefab,{bundle})` | core `ui-manager.ts`/`ui-view.ts`、engine `cc-ui.ts`、`ui-manager.md`、+1 core 单测 |
| 2 | i18n | 只有 `addTable`，无移除 | `removeTable(locale, table?)`（或按键前缀移除）——卸载模块撤其翻译 | core `i18n.ts`、i18n 模块文档、+单测 |
| 3 | config-table | 只有 `register`/`clear`（清全部） | `ConfigTableManager.unregister(name)`——卸载模块撤其配表 | core `config-table.ts`、config 模块文档、+单测 |
| 4 | engine scene-loader | `loadScene(name)` 只走 `director.loadScene`（主包/build 列表） | `loadScene(name, { bundle? })`——bundle 内场景走 `assetManager.getBundle(bundle).loadScene`（`game` 类模块场景在自带 bundle） | engine `scene-loader.ts`、sceneflow/loader 文档、apps/demo 真机验证 |

- 四处均**加法、向后兼容**（可选字段 / 新方法），不动既有签名。
- 均守铁律：core 侧改（#1~#3）零 cc、TDD 补测；engine 改（#1 cc-ui 透传、#4 scene-loader）走 apps/demo 真机验证。

## 6. 目录结构（apps/demo/assets）

```
apps/demo/assets/
├─ scenes/Boot.scene         大厅引导场景：建常驻框架根 CCKApp + 挂 LobbyHost
├─ lobby/                    常驻框架 + 契约（主包/首包）
│  ├─ LobbyHost.ts           bootCoreKit → 提常驻根 → 读 catalog → 导航 UI → 按需 load/mount/release
│  ├─ FeatureModule.ts       FeatureModule + ModuleContext 契约（type-only）
│  ├─ ModuleResourceScope.ts 模块作用域资源登记/一键回收（§4）
│  └─ module-catalog.ts      { id, title, bundle, kind:'panel'|'game', entry }[]
├─ modules/                  一切可分包功能（一模块一 bundle 一目录）
│  ├─ shop/        ShopModule.ts (+ 可选 Shop.prefab / shop-i18n.json)   kind:panel
│  ├─ mini-clicker/ ClickerGame.ts + CounterVM.ts                        kind:panel（轻量，挂常驻根）
│  └─ mini-dodge/  DodgeGame.ts (+ 可选 Dodge.scene)                     kind:game（演示自带场景/C）
├─ resources/                【彻底删除】fixtures 迁入 test/（§附）
└─ test/                     旧验证探针集中
   ├─ Demo.scene · DemoBoot.ts
   └─ fixtures-bundle/       test-config/i18n-en/heroes/cck-app-compat/DemoPanel + probe.json（自定义 bundle）
```

## 7. 数据驱动 catalog

大厅只吃 `module-catalog.ts` 一张清单：`{ id, title, bundle, kind, entry }[]`。**加任何功能 = 新建一个
`modules/xxx` bundle + catalog 加一行，大厅代码零改** → 多人协作零冲突（一模块一 bundle 一目录，专人 own）。

## 8. 验证计划（真 cc，funplay MCP）

- 门禁：core 三处补缺 `pnpm test`/`-r typecheck`/`lint`/相关包 `build` 全绿。
- 真机（Creator 3.8.7 gameView 预览 + `[CCK-LOBBY]` 日志 + 截图）：
  1. 大厅渲染、列出 catalog；
  2. 点商城 → `load('shop')` 真加载 → 面板挂常驻根上屏 → 其 i18n/配表已就绪（且**加载前查不到**，证模块作用域）；
  3. 关商城 → unmount → i18n 表/配表**已撤**、`release('shop')` → `isLoaded=false`；
  4. 点子游戏（game/C）→ `bundle.loadScene` 切世界场景、常驻框架存活、返回回大厅；
  5. 【待实测】自定义 bundle 里的 `.scene` 不进 build「包含场景」列表即可 `bundle.loadScene`（调研标注项，此处坐实）。

## 9. Open Questions（已决议 · 2026-07-30 用户定）

1. **模块入口获取方式**：✅ **(a) 模块自登记**——模块脚本顶层 `registerModule(id, factory)` 写进框架注册表，host 加载 bundle 后按 id 取。
   无 cc 类名反射依赖、AOT 友好。
2. **框架 host 归属**：✅ **全作 apps/demo 样例**（host/契约/ResourceScope 都在 apps/demo）；kit 只补 §5 的 4 处通用小原语。沉淀进 kit 留后续独立决策。
3. **mini-dodge 的 kind**：✅ **做成 `game`（自带 `.scene`/C）**，完整演示「bundle 内自带场景 + 切场景 + 常驻框架存活」路。mini-clicker 仍 `panel`（轻量挂常驻根）。
4. **场景导航 + base 场景**：✅ **走 core `SceneFlow` pushdown 栈**（见 §2.4），返回目标 = **Boot（空引导场景）**；Boot 幂等 bootstrap（见 §2.1），常驻 `CCKApp` 承载全部、只 boot 一次。不裸切、不另建 base 场景。

## 附：旧测试探针迁 test/ 的处置

- `Demo.scene` / `DemoBoot.ts` / `probe-bundle` → `assets/test/`（asset-db `move-asset` 保 uuid/引用）。
- `resources/` 5 个 fixture（test-config/i18n-en/heroes/cck-app-compat/DemoPanel.prefab）→ 并入 `test/fixtures-bundle/`
  自定义 bundle；改 `DemoBoot` 加载调用加 `{bundle:'fixtures-bundle'}`（DemoPanel 依赖 §5#1 的 `uiMgr.open({bundle})`）。
  → `resources/` 彻底删除，无尾巴。
- 旧 `GameBoot.ts` 计数器退役（逻辑并入 `modules/mini-clicker`）。
