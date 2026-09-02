---
主题: lobby-modular-framework（大厅 + 可分包功能模块框架）
范围: 跨包（apps/demo 样例 + core 的 ui-manager / bundle-scope / i18n / config-table + engine 适配）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 一个「一切功能皆可分包」的大厅框架样例。大厅自己是一个 bundle，商城 / 子游戏等功能各是一个 bundle，
      按需 load / open / release；panel 类模块 = 注册进 UIManager 的界面（挂 kit 常驻相机组的层容器，跨场景存活），
      game 类 = 自带 `.scene`（经 SceneFlow 栈切过去）；模块自带的 i18n / 配表 / 资源随 bundle 一起来、
      经 `BundleScope` 一行回收。
何时读: 想照着搭「大厅 + 分包功能模块」时；或想知道 apps/demo 的大厅样例各部分职责怎么分时。
日期: 2026-07-31
依赖: [[bundle-manager]]（按需 load/release + `BundleScope` 回收契约）、[[ui-manager]]（注册表 / 变体 / `closeByBundle`）、
      [[app]]（启动序列把 lobby bundle 装起来）、[[asset-manager]]、[[i18n]]、[[config-table]]、[[di-container]]、
      [[sceneflow]]（game 类切场景）、[[camera-rig]] 与 `apps/demo/docs/scene-and-camera-architecture.md`（场景 / 相机职责）、
      [[adr-0009]]（包分层判据）。场景能力一手调研见 `docs/research/2026-07-30-cocos-scene-capabilities.md`。
---

# 大厅 + 可分包功能模块框架（overview）

## TL;DR

`apps/demo` 的大厅样例：**大厅自己是 `lobby` bundle**（[[adr-0009]] 的「启动期换」层），商城 / 点击计数器 / 躲避小游戏各是 `modules/<id>` 一个 bundle，按需加载。

- **panel 类**（商城、点击计数器）= 一个**注册进 UIManager 的界面**：清单 → `registerUI(id, {layer, bundle, prefab})`，host 只写 `open(id, ctx)`；界面脚本继承 `CCKUIView` 挂在自己 bundle 的 prefab 根上。界面被挂进 **kit 常驻相机组的层容器**（跨场景存活），大厅不自建挂载层。
- **game 类**（五个能玩的子游戏 + 一个只演示切场景的）= 用它 bundle 里**自带的 `.scene`**，经 `SceneFlow` pushdown 栈切过去；返回目标是 **`Lobby.scene`**（重新加载），不是 Boot。
- **game 类的契约是 `GameHost`**（`foundation/game/`）：panel 的上下文是 host 递进去的，game 是 `loadScene` 切过去的、递不进去，所以它**自己去取**——玩家是谁、历史最好成绩、交成绩、回大厅。回路闭在大厅按钮上的「最好 N」，而大厅不认识任何一个游戏。
- **模块作用域资源**：模块自带的 i18n / 配表 / 资源全部经 `{bundle}` 从自己 bundle 加载，登记进 kit 的 **`BundleScope`**；关闭时 host 一行 `await scope.dispose()` 全撤（`closeByBundle` → 逆序 teardown → `release(bundle)`）。
- **数据驱动**：大厅只吃 `module-catalog.ts` 一张清单。**加任何功能 = 新建一个 bundle + 清单加一行，大厅代码零改。**

## 1. 目标与定位

- **做什么**：教一个新项目「大厅 + 一切功能皆可分包」怎么在 kit 上搭。既是 `apps/demo` 的接入样例，也是 kit 里「模块作用域资源」这套原语的使用现场。
- **YAGNI（本版不做）**：模块间深层导航历史；模块 A 直接依赖模块 B（模块只经 catalog + 事件解耦，不互相 import）；模块预下载优先级。

## 2. 架构：三类场景 + 常驻相机组

场景职责三分（详见 `apps/demo/docs/scene-and-camera-architecture.md`）：

| 场景 | 职责 | 何时进入 | 内容 |
|---|---|---|---|
| `Boot.scene`（main 包） | 一次性启动：`bootCoreKit` 装配 kit → `app.launch()` 跑启动序列 | 除应用重启外不二次进入 | 一个挂 `Bootstrap` 的空节点 |
| `Lobby.scene`（`lobby` bundle） | 主场 / 大厅，也是子游戏的**返回目标** | 每次返回都**重新加载** | 一个渲染根 + `LobbyHost` |
| 模块自带 `.scene`（各自 bundle） | 全屏子游戏的世界 | `bundle.loadScene` 切过去 | 该子游戏的内容 |

**三个场景一律不含相机、不含 Canvas。** 相机与屏幕适配由 kit 的 `cameraRigModule` 建成常驻 `CCKRig` 跨场景存活；UIManager 的 10 档层容器就挂在它下面——所以 **panel 类模块的界面天然跨场景存活**，大厅不需要自己的「常驻框架根」。

> 早期设计里的常驻框架根 `CCKApp`（承载 kit + 大厅 UI + 模块挂载层）**已被这套取代**：常驻的是相机组与层容器，大厅内容随 `Lobby.scene` 生灭。

### 承载矩阵（按 kind）

| kind | 典型 | 承载方式 | 加载 | 卸载 |
|---|---|---|---|---|
| `panel` | 商城 / 点击计数器 | 从模块 bundle 加载 **prefab**，由 UIManager 挂进常驻层容器（叠在大厅上） | `load(bundle)` → `uiMgr.open(id, ctx)` | `scope.dispose()`（关界面 → 逆序回收 → `release(bundle)`） |
| `game` | 躲避小游戏 | 模块 bundle 里**自带的 `.scene`**（携带编辑期 SceneGlobals） | `load(bundle)` → `flow.push('game')` → `loadScene(scene, {bundle})` | `flow.pop()` → 回 `Lobby.scene` → `release(bundle)` |

- **为何面板必须挂常驻层而不是独立场景**：Cocos 运行时**同一时刻只有一个活动场景**，切场景旧场景整树销毁——「商城浮在大厅上」没有「两个场景同时在场」可言。
- **为何全屏世界可以是自带场景**：`.scene` 是**编辑期配置单元**——SceneGlobals（环境光 / 天空盒 / 雾 / 阴影 / 后处理 / 烘焙）只能在场景级配，prefab 与代码化 UI 拿不到。需要独立环境的子游戏必须走这条路。
- **不违反「一个空引导场景」铁律**：铁律本意是杜绝**共享**场景的合并冲突；每个模块自带的 `.scene` 在它自己 bundle、单人 own，零共享冲突。

### 场景导航栈

`game` 类切场景走 core `SceneFlow` 的 pushdown 栈：大厅 = 一个 state；进 game → `push('game')`（`onEnter` 里 `loadScene(scene, {bundle})`）；返回 → `pop()` → `'lobby'.onResume` → `loadScene('Lobby', {bundle:'lobby'})` 再 `release` 该 game bundle。

- **诚实语义**：单活动场景 ⇒ 栈存的是**返回目标**，`pop` 是重新加载它，不是恢复活着的旧场景。大厅状态不丢靠的是 `LobbyNav` 这个 module-level 单例（JS 模块不随 `loadScene` 重载）。
- **释放顺序有讲究**：先切完场景再 `release(bundle)`——它自带的场景还在跑时不能卸。

## 3. 模块契约 + 生命周期

panel 类模块**就是一个注册进 UIManager 的界面**。框架不定义 mount/unmount 契约，也不自建工厂注册表——prefab 里存的就是组件类，bundle 加载执行脚本时 `@ccclass` 已把它注册进 cc 类表（**引擎原生的跨 bundle 桥接**，无反射、base 友好）。

```ts
/** 框架注入给模块的运行上下文 —— 它就是 open(uiId, args) 的 args。 */
export interface ModuleContext {
  readonly container: Container;  // 模块专属 DI 子作用域（关闭即 dispose）
  readonly bundle: string;        // 本模块 bundle 名
  readonly scope: BundleScope;    // kit 的 bundle 作用域（已绑定本 bundle）
  readonly args?: unknown;
  close(): void;                  // 模块请求关闭自己
}
```

界面侧只实现 `CCKUIView` 的钩子：`onShow(args, state)`（可 async——商城要先 `await scope.i18n(...)`）、`onHide()`、可选 `saveState()`（转屏 / 换皮重建时保状态）。

**host 对一个 panel 模块的生命周期**：

1. `await bundleMgr.load(bundle)`；
2. 造 `ModuleContext`：DI 子作用域 + `createBundleScope(bundle)` + close 回调，并把 `container.dispose()` 也 `scope.add` 进同一条回收链（调用点只记一笔账）；
3. `await getUIManager().open(id, ctx)`——prefab 与层来自注册表，UIManager 负责加载 / 挂层 / 调 `onShow`；打开失败则回滚（同样一行 `scope.dispose()`）；
4. 关闭：`await ctx.scope.dispose()` 一行全撤。

> ⚠️ **界面自己不要 `dispose`**：`dispose` 的第一步就是 `closeByBundle` 关掉本 bundle 的界面——也就是调起 `onHide` 的那一步，界面在 `onHide` 里反手 dispose 会自递归。所有权在 host 手里。

### game 类的契约：`GameHost`

panel 类的上下文是 host **递进去的**（它就是 `open(id, ctx)` 的 `args`）。game 类没有这个机会——它是 `loadScene` 切过去的，场景里的组件由引擎 `new` 出来，**没有任何东西被递进去**。所以 game 类需要一份**自己去取**的契约：

```ts
// assets/foundation/game/host.ts —— 住在地基包（priority 6），谁都能 import
export interface GameHost {
  readonly player: GamePlayer;               // 谁在玩（id / 显示名，取自登录态）
  exit(): void;                              // 回大厅
  best(gameId: string): number;              // 这个游戏的历史最好成绩（同步）
  submit(gameId: string, score: number): boolean;  // 交成绩；破纪录返回 true
}
export function getGameHost(): GameHost;                                  // 游戏侧
export function scoreboardFor(gameId: string, host?: GameHost): GameScoreboard;  // 喂给 VM
```

**为什么住在地基而不是大厅**：跨包 `import` 只许指向优先级更高的包。模块（1）→ 大厅（3）虽然合法，但方向反了——子游戏不该依赖「大厅」这个具体实现（换一个大厅、或者深链直接进某个游戏就全断）。放地基（6）= 谁都能用，且随地基热更。地基 `boot` 的最后一步 `installGameHost()` 把它装进 DI 根容器（排在认证之后，`playerId` 才有）。

**成绩为什么是同步的**：`IStorage` 是异步的，而游戏第一帧就要把「最好 12」画出来。启动时一次性读进内存，`best()` 同步返回，`submit()` 同步更新内存 + 异步写回。丢一次写盘最多丢掉这一局的纪录，换来游戏侧一个 `await` 都不用写。

**VM 拿到的不是 host，是 `GameScoreboard`**（`best()` / `submit()` 两个方法的零依赖小接口，住在 `foundation/game/scoreboard.ts`）。VM 零 `cc`、node 直跑，不该认识一条挂到 DI 容器和 `IStorage` 的链子；单测塞一份 `memoryScoreboard()` 就能跑：

```ts
// 运行期（View 里）                          // 单测里
new BrickVM({ scoreboard: scoreboardFor('mini-brick') })   new BrickVM({ scoreboard: memoryScoreboard(50) })
```

**回路是闭的、且看得见**：游戏结束 `submit` → 回大厅（`Lobby.scene` 重新加载 → 重建按钮）→ 按钮上多出「最好 N」。**大厅不认识任何一个游戏**，它只按 id 读一个数，不知道那分是打砖块还是吃硬币来的。

配套的建场小工具在 `foundation/game/stage.ts`（`gameNode` / `gameSprite` / `gameLabel` / `loadGameArt` / `exitButton` / `fieldByHeight` / `fieldByWidth`）——六个 game 模块共用的那十几行，不含任何美术资产。

### 接入一个新子游戏要做的事

1. 新建 `assets/modules/<id>/`（目录 meta 置 `isBundle: true, priority: 1`），里头放 `<X>VM.ts`（零 `cc` 的玩法）、`<X>Game.ts`（薄壳 View）、`<X>.scene`、`art/`；
2. `foundation/catalog.ts` 的 `MODULE_CATALOG` 加一行 `{ id, title, bundle, kind: 'game', scene }`；
3. View 里三句话接上契约：`scoreboardFor(BUNDLE)` 喂给 VM、`exitButton(this.node)` 放返回键、`releaseGameArt(BUNDLE)` 在 `onDestroy` 里还引用；
   贴图走 `const frames = await loadGameArt(this.node, BUNDLE, ART); if (!frames) return;` —— 第一个参数是**宿主节点**，加载期间被切走就返回 `undefined`（类型带 `| undefined`，忘了判 `pnpm typecheck` 当场红）；
4. `test/modules/<id>/<X>VM.test.ts` 写玩法判据（`pnpm check:vm-tests` 强制）。

**大厅代码零改**，依赖表（`foundation/bundles.ts`）按 catalog 现推也零改。

## 4. 模块作用域资源

> **bundle 没加载，就不该有它的 i18n / 配表 / 资源；卸载 bundle，就连它们一起下掉。**

难点在于 i18n 表与配表是把数据**拷进 core 全局注册表**的——只 release bundle 的 JSON 资源撤不掉已注册的表。这套对称回收已沉淀成 kit 的 **`BundleScope`**（[[bundle-manager]] §BundleScope），大厅样例直接用：`scope.i18n(locale, path)` / `scope.table(name, path)` / `scope.load(path, type)` / `scope.add(teardown)` 登记，`scope.dispose()` 反做全部。

**命名空间约定**：模块 i18n 键与配表名带模块 id 前缀（`shop.title` / 表名 `shop.goods`）——既避免跨模块撞名，也让按精确键回收成立（`BundleScope` 只按顶层键 `removeTable`，**表必须扁平**）。

## 5. 本样例用到的 kit 能力（均已落地）

| 能力 | 落点 |
|---|---|
| `UIManager` 注册表 + `{bundle}` 加载 + 变体换 view | [[ui-manager]]（v2） |
| `i18n.removeTable(locale, keys)` / `ConfigTableManager.unregister(name)` | [[i18n]] / [[config-table]] |
| `loadScene(name, { bundle })`（bundle 内场景走 `bundle.loadScene`） | engine `scene-loader.ts` |
| `BundleScope` 对称回收 + `UIManager.closeByBundle` | [[bundle-manager]] / [[ui-manager]] |
| 启动序列把 `shared` + `lobby` 装起来 | [[app]] |

## 6. 目录结构（apps/demo/assets）

```
apps/demo/assets/
├─ boot/                       main 包（重启层）：只剩启动
│  ├─ Boot.scene               空引导场景，一个挂 Bootstrap 的节点
│  ├─ Bootstrap.ts             AppConfig + 装配 kit + 插自定义启动步 + app.launch()
│  └─ foundation-api.ts        主包够到地基的唯一接缝（import type + js.getClassByName）
├─ foundation/                 地基 bundle（priority 6）：跨模块契约，可热更、不重启
│  ├─ Foundation.ts            地基入口（依赖表 → 清单 → 连接 → 认证 → GameHost）
│  ├─ catalog.ts               模块清单 + registerCatalogUIs() + 换皮解析
│  ├─ bundles.ts               bundle 依赖表（装卸跟随 + 资源边界）
│  ├─ events.ts                跨包事件名（零依赖小文件）
│  ├─ ModuleContext.ts         **panel 类**的运行上下文契约（= open 的 args 形状）
│  ├─ game/                    **game 类**的契约（见 §3）
│  │  ├─ host.ts               GameHost：player / exit / best / submit + installGameHost
│  │  ├─ scoreboard.ts         GameScoreboard（零依赖）：VM 只认这两个方法
│  │  └─ stage.ts              建场小工具（gameNode / gameSprite / exitButton / fieldBy*）
│  ├─ net/                     协议 / 连接 / 认证 / 网关搬家
│  └─ login/                   登录闸门的 VM 与 View（脸在皮包里）
├─ shared/                     shared bundle：跨模块公共资源（全局 i18n 基表…）
├─ skins/<马甲>/               各层的「脸」，一个跟随者一个皮包（本身不是 bundle）
└─ modules/                    一切可分包的功能，一个一 bundle 一目录（本身不是 bundle）
   ├─ lobby/       Lobby.scene + LobbyHost.ts（catalog → load/open/release，骨架脸在皮包）
   ├─ shop/        ShopView.ts + Shop.prefab / Shop_land.prefab / shop-i18n.json   kind:panel
   ├─ mail/        MailView.ts（换皮：脸在 skin-<马甲>-mail）                      kind:panel
   ├─ mini-clicker/ClickerView.ts + CounterVM.ts + Clicker.prefab                  kind:panel
   ├─ mini-dodge/  DodgeGame.ts + Dodge.scene（只演示切场景，没有玩法）            kind:game
   ├─ mini-plane/  PlaneVM.ts + collision-masks.ts + PlaneGame.ts + Plane.scene    kind:game
   ├─ mini-brick/  BrickVM.ts + BrickGame.ts + Brick.scene + art/                  kind:game
   ├─ mini-shooter/ShooterVM.ts + ShooterGame.ts + Shooter.scene + art/            kind:game
   ├─ mini-hop/    HopVM.ts + level.ts（烘出来的关卡）+ HopGame.ts + Hop.scene     kind:game
   └─ mini-cards/  CardsVM.ts + CardsGame.ts + Cards.scene + art/（66 张）         kind:game
```

> `lobby` 和功能模块**同住 `modules/` 但不同层**：`lobby` 是「启动期换」（启动序列里 load，更新下次启动天然生效），`shop` 等是「运行期换」。目录只表达「是不是一个可独立加载的包」，分层判据在 [[adr-0009]]——**别用目录反推层**。
> `modules/` 自己**不能标 bundle**（Cocos 不允许 bundle 嵌套）；它只是个普通目录。

## 7. 数据驱动 catalog

大厅只吃 `foundation/catalog.ts` 一张清单：`{ id, title, bundle, kind, prefab?, prefabLand?, layer?, scene?, skinned? }[]`。

- `registerCatalogUIs()` 把 panel 项登记进 UIManager；填了 `prefabLand` 的登记成 **resolver**（转屏时 UIManager 只重建这一类界面，其余零成本）。
- **加任何功能 = 新建一个 `modules/xxx` bundle + 清单加一行，大厅代码零改** → 多人协作零冲突（一模块一 bundle 一目录，专人 own）。依赖表（`bundles.ts`）按这张清单**现推**，也不用改。
- 清单在**地基**而不是大厅包里：它是跨模块契约（大厅按它画按钮、UIManager 按它解析 prefab），且随地基热更——上线一个新模块只要热更地基 + 那个模块，不必发新包、不必动大厅。

## 8. 验证记录

- **Game View 预览全流程 0 error**：Boot → kit → Lobby → panel 模块 mount / unmount / release → game 模块切场景 → `lobby:back` 回 Lobby + release。
- **模块作用域成立**：打开商城前 `getI18n().t('shop.title')` 查不到 `shop.*`；关闭后翻译已撤、`isLoaded=false`。
- **转屏真换 view**：`Shop → Shop_land`；未登记横屏变体的界面 `sameInstance=true` 零重建。
- **web-mobile 真构建 + 浏览器 e2e**：完整启动序列 0 error；`scope.dispose` 卸载链在构建产物里成立；换 `shop` 版本后**免重启换代码**生效（见 [[adr-0010]]）。
- **自定义 bundle 里的 `.scene` 不进 build「包含场景」列表也能 `bundle.loadScene`**（调研标注项，已坐实）。
- **`GameHost` 回路 web 真产物 e2e**（2026-08-25）：打砖块打掉 8 块 → 掉球结算「新纪录！」→ 返回大厅按钮变成「🎮 打砖块  最好 8」→ 再玩另外三款，`localStorage` 里 `cck-demo.cck.gameBest={"mini-brick":8,"mini-shooter":4,"mini-hop":90,"mini-plane":1}`（**带 appId 前缀**，两个马甲不串）。平台跳跃自动驾驶跑完整关（`phase=won`、90 分），骰子卡牌桌上写着 `player.name`。控制台除 favicon 404 外零错误。

- **入口列表横竖屏网格 + 滚动 web 真产物 e2e**（2026-08-28）：竖屏 1080×1954 → 2 列 5 行、`vertical` 滚；转横屏 2025×1080 **不重进大厅**实时重排成 2 列 7 行、`horizontal` 滚；**横屏下第 10 个入口「🎮 捕鱼」落在屏内 (535, 291) 并点进 `Fish.scene`**（改之前它掉在屏外）；返回大厅后网格按横屏重建、10 个入口全在；把 `content` 临时撑高后拖动真滚起来（207 → 516）且**拖完大厅还在**（`cancelInnerEvents` 生效，没有误开模块）。本次 navigation 控制台 0 error。

## 9. 已知行为与坑

- **直接播放 `Lobby.scene` 会全黑**：预览起始场景取「当前在编辑器里打开的场景」，跳过 Boot 就没有 kit、没有相机组。`LobbyHost` 已对这种情况打一条指路的 `console.error`——验证启动流程前先打开 `Boot.scene`。
- **导航状态跨场景常驻靠 DI 根容器，不是模块级单例**：`Lobby.scene` 会被 game 场景顶掉再重新加载，导航状态不能跟着走 —— 但**也不能写成 `static instance`**（bundle 卸载不卸脚本、编辑器 stop→play 保留 JS 上下文，都会拿到脏的旧实例）。`LobbyNav` 注册在 `getRootContainer()` 的 `LOBBY_NAV` token 上、一个 kit 一份；场景内节点（大厅 UI）则随场景销毁重建。
- **kit 换了要整套重建导航状态**：编辑器 Game View 重播走 `shutdown → reboot`，上一轮的 EventBus / SceneFlow 已作废，旧订阅永远收不到事件 → `LobbyNav` 记住自己是绑在哪个 `Kit` 上建的，kit 变了就重建订阅。
- **UI 节点必须置 `Layers.Enum.UI_2D`**，否则 UI 相机 `visibility` 不含它 → 不可见且无日志。prefab 生成器（`apps/demo/scripts/prefab-gen/`）已统一置好；手搭节点或运行时 `new Node` 时要自己注意。
- **大厅界面是 prefab 不是代码，且从皮包按路径取**：`LobbyPanel.prefab`（布局）+ `LobbyItem.prefab`（入口按钮模板）住在 `skin-<马甲>-lobby` 里，由 `currentSkinBundle('lobby')` 运行时解析 —— **不是 `@property(Prefab)`**（那是编辑器期绑定，绑死在 `lobby` 包里，马甲换不掉）。代码只按 `MODULE_CATALOG` 克隆模板、填标题、绑点击。**节点名 `Items` / `Label` 是契约**，改 prefab 时别改，否则代码静默取不到（只打一条 error）。
- **入口列表按横竖屏排网格，装不下才滚**：`Items` 在 prefab 里是个**空容器**（条目一个都没有，位置就是设计者指定的「第一个条目中心」），运行时就地装成 `Mask` + `ScrollView`，内容节点由代码建。**竖屏先填满一行再往下、上下滚；横屏先填满一列再往右、左右滚** —— 行列数按可用区现算（十个入口：竖屏 2 列 5 行、横屏 2 列 7 行），**装得下时视口贴着内容收窄、根本不滚**，滚动是加到第十几个模块才用得上的兜底。转屏走 `view.on('canvas-resize')` 实时重排，不必重进大厅。
  - 排布算式在 `modules/lobby/grid.ts`（**零 `cc`**，11 例单测）而不是 `cc.Layout` 的 GRID 模式：条目位置本来就是清单驱动算出来的，而 `Layout` 的 `startAxis` / `constraint` / `constraintNum` 得在编辑器里配、还得两个马甲各配一遍，配错了只有真机上看得出来。
  - **两套皮的坐标体系不同**（base 是 600×520 的面板、`Items` 在 y=60；vest 是 1080×1920 满屏、`Items` 在 y=520），所以列表区上沿**读 prefab 里 `Items` 的位置**、不硬编码；同时夹在屏内（`min(itemsTop, halfH - 40)`），否则竖屏 prefab 的坐标在横屏 1080 高的屏上是屏外，列表整个看不见。
  - **拖动不会误开模块**：`ScrollView.cancelInnerEvents` 默认 `true`，滚起来就把子节点的触摸取消掉（触点几乎没动才照常派发 `TOUCH_END`）。条目用的是裸 `node.on(TOUCH_END)` 而不是 `Button`，这条同样成立。
- **面板打开失败要走同一条回滚链**（`scope.dispose()`），否则 bundle 计数与 DI 子作用域会泄漏。
