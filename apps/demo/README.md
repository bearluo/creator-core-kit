# apps/demo — creator-core-kit 实测工程

真实 Cocos Creator 3.8.7 工程，作两件事：**给新项目看「怎么接入 kit」的样例**，以及**在真 cc 里逐模块验证 engine 适配层**。

## 场景一览

| 场景 | 用途 | 入口脚本 |
|---|---|---|
| **`assets/scenes/Boot.scene`**（main 包） | 🌱 **一次性启动场**：装配 kit → 跑启动序列（读戳 → 热更 → `shared` → `lobby`）。除 app 重启外不二次进入 | `scenes/Bootstrap.ts` |
| **`assets/modules/lobby/Lobby.scene`**（`lobby` bundle） | 🏠 **大厅主场**，也是子游戏的返回目标（每次返回都重新加载）。大厅自己就是一个可热更的 bundle | `modules/lobby/LobbyHost.ts` |
| `assets/modules/mini-dodge/Dodge.scene` | 🎮 子游戏自带场景，在自己的 Asset Bundle 里（**只演示切场景，没有玩法**） | `modules/mini-dodge/DodgeGame.ts` |
| `assets/modules/mini-plane/Plane.scene` | 🎮 飞机穿岩：玩法（含**像素级碰撞**）全在零 `cc` 的 `PlaneVM` | `modules/mini-plane/PlaneGame.ts` |
| `assets/modules/mini-brick/Brick.scene` | 🎮 打砖块：反弹角挂在击球点偏移上 | `modules/mini-brick/BrickGame.ts` |
| `assets/modules/mini-shooter/Shooter.scene` | 🎮 太空射击：速度按场高推导，换屏幕不改手感 | `modules/mini-shooter/ShooterGame.ts` |
| `assets/modules/mini-hop/Hop.scene` | 🎮 平台跳跃：**关卡烘成纯数据**，VM 与单测读同一份 | `modules/mini-hop/HopGame.ts` |
| `assets/modules/mini-cards/Cards.scene` | 🎮 骰子卡牌：没有 `update()`、没有记分板，演示 `GameHost` 的另外两件事 | `modules/mini-cards/CardsGame.ts` |
| `assets/modules/mini-fish/Fish.scene` | 🎮 捕鱼：**ECS + 四道联网接缝 + 图集 + 横屏**，本工程唯一的经济型玩法 | `modules/mini-fish/FishGame.ts` |

其中五款移植自 Kenney 的 Construct 2 模板包（CC0）。每一款都是 **VM（零 `cc`，node 直跑）+ 薄壳 View + 自带 `.scene` + 镜像单测**，接入大厅只经 `foundation/game/` 那一份契约（见下）。

**`Boot` / `Lobby` / `Dodge` 都不含相机、不含 Canvas** —— 相机由 kit 的常驻相机组（`cameraRigModule`）在 Boot 阶段建好并跨场景存活。原理与约束见下方设计文档。

## 接入样例怎么读

**① `Bootstrap.ts`（怎么起）** —— 一句 `bootCoreKit({ modules })` 装配项目要用的 cc 适配模块，再 `app.launch()` 跑启动序列。要加/减能力就动这个数组；要往启动里插登录 / SDK / 公告，就往 `launchSteps()` 里插一步：

```ts
await bootCoreKit({
  modules: [
    resolutionModule({ shortSide: 1080, longSide: 1920 }), // 横竖屏锁短边适配
    cameraRigModule(),                                     // 常驻背景 + UI 相机
    ccAssetModule(), ccBundleModule(), ccStorageModule(), ccAudioModule(), ccUIModule(),
    appModule(APP_CONFIG, { steps: launchSteps() }),       // 启动序列（只造不跑）
  ],
});
const app = getApp();
const overlay = createLaunchOverlay(app);                  // 启动界面（见 ②）
app.onProgress(overlay.onProgress);                        // 订阅必须在 launch 之前挂，否则漏掉前几个阶段
app.onFailure(overlay.onFailure);
await app.launch();                                        // platform → hotupdate → shared → lobby → running
```

**② `LaunchOverlay.prefab` + `LaunchOverlay.ts`（热更 / 启动期给用户看什么）** —— kit 只出 `onProgress` / `onFailure` 事件，界面归项目。**界面在 prefab，脚本只是薄壳**（填文案 / 推进度 / 切失败按钮），字号颜色布局都在编辑器里改。

prefab 随 Boot.scene 的 `@property` 序列化进 **main 包**，启动第一帧就在手上——不用路径加载、不依赖任何 bundle，正好覆盖「`shared` 都还没加载」的空窗期。运行时挂在常驻相机组的 `ui` 层 root 上跨场景存活，跑到 `running` 自毁。

失败按分类给**不同的出路**——这正是 `LaunchFailure` 分三类的意义：

| 分类 | 界面 | 动作 |
|---|---|---|
| `network` | 网络异常，启动失败 | 「重试」→ `app.retry()`，从**失败那一步**续跑，前面不重跑 |
| `needFullUpdate` | 需要下载完整安装包 + 原因 | 引导去应用商店（引擎指纹变了，或兼容闸不过——重试没意义） |
| `fatal` | 启动失败 + 错误信息 | 「重启应用」→ `app.restart()` |

**③ `LobbyHost.ts` + `module-catalog.ts`（怎么加功能）** —— 大厅是**数据驱动**的：加一个功能 = 新建 `assets/modules/<id>/` 一个 bundle + 在 `MODULE_CATALOG` 加一行，**大厅代码零改**。界面同样是 prefab：`LobbyPanel.prefab`（标题 + 副标题 + `Items` 容器）+ `LobbyItem.prefab`（一个入口按钮的模板），代码只负责按清单克隆模板、填标题、绑点击。两种承载：

- `kind: 'panel'` —— UI 面板，由 UIManager 按注册表加载并挂进常驻层容器；关闭时一行 `await scope.dispose()` 对称回收（关界面 → 撤 i18n / 配表 / 资源 / DI 子作用域 → `release(bundle)`）。样例：`shop`、`mini-clicker`；
- `kind: 'game'` —— 全屏子游戏，走 `SceneFlow` 切到 bundle 自带的场景；跟外面的往来只经 `foundation/game` 的 `GameHost`（见下节），不 import 大厅、不认识 EventBus。

**④ 纯逻辑 ViewModel（零 `cc`）** —— 如 `modules/mini-clicker/CounterVM.ts`：状态与行为写在这，可直接 node/vitest 单测、不用开 Creator，再用 `bindText` 单向映射到 cc `Label`。这是铁律「逻辑可脱离引擎」+「数据驱动 UI」的落地。

**⑤ `foundation/game/`（子游戏怎么跟大厅打交道）** —— 见下节「子游戏 ↔ 大厅」。

> **UI 一律走 prefab**（`CLAUDE.md` §多人协作）：首次创建用 `scripts/prefab-gen/`（描述 JSON → 编辑器 `create-prefab`），之后改 prefab 就在编辑器里改。脚本里只留填数据 / 绑事件。
> 层的坑：UI 节点必须落在 `Layers.Enum.UI_2D` 层，否则 UI 相机 `visibility` 不含它 → 不可见且无日志。生成器已统一置好，手搭节点时要自己注意。

## 子游戏 ↔ 大厅：接进来要做什么、能拿到什么

panel 类模块打开时由大厅**递一份上下文进去**（`ModuleContext`，就是 `open(id, args)` 的 `args`）。
game 类没有这个机会 —— 它是 `loadScene` 切过去的，场景里的组件由引擎 `new` 出来，**递不进任何东西**。
所以 game 类有一份自己去取的契约：`foundation/game/host.ts` 的 **`GameHost`**。

```ts
const host = getGameHost();
host.player;                    // 谁在玩（id / 显示名，取自登录态；子游戏不必认识 auth 那一层）
host.exit();                    // 回大厅（以前每个游戏各写一遍的 emit('lobby:back')）
host.best('mini-brick');        // 历史最好成绩，**同步**（启动时一次性读进内存）
host.submit('mini-brick', 42);  // 交成绩；破纪录返回 true → 游戏弹「新纪录！」
```

VM 拿到的不是 host，而是把 gameId 绑死之后的 **`GameScoreboard`**（只有 `best()` / `submit()` 两个方法，
住在零依赖的 `foundation/game/scoreboard.ts`）。VM 零 `cc` 要在 node 里直跑，不该认识一条挂到
DI 容器和 `IStorage` 的链子：

```ts
new BrickVM({ scoreboard: scoreboardFor('mini-brick') })   // View 里
new BrickVM({ scoreboard: memoryScoreboard(50) })          // 单测里
```

**回路是闭的**：游戏结束 `submit` → 返回大厅（`Lobby.scene` 重新加载 → 重建按钮）→ 按钮上多出「最好 N」。
大厅只按 id 读一个数，**不认识任何一个游戏**。

### 接一款新子游戏：四步

| 步 | 做什么 |
|---|---|
| 1 | 新建 `assets/modules/<id>/`（目录 meta 置 `isBundle: true, priority: 1`），放 `<X>VM.ts`（零 `cc` 玩法）、`<X>Game.ts`（薄壳 View）、`<X>.scene`、`art/` |
| 2 | `foundation/catalog.ts` 的 `MODULE_CATALOG` 加一行 `{ id, title, bundle, kind: 'game', scene }` |
| 3 | View 里三句接上契约：`scoreboardFor(BUNDLE)` 喂 VM、`exitButton(this.node)` 放返回键、`onDestroy` 里 `releaseGameArt(BUNDLE)` |
| 4 | `test/modules/<id>/<X>VM.test.ts` 写玩法判据（`pnpm check:vm-tests` 强制每个 `*VM.ts` 都有） |

**大厅代码零改**；bundle 依赖表（`foundation/bundles.ts`）按 catalog 现推，也零改。

建场的十几行公共代码在 `foundation/game/stage.ts`：`gameNode`（**必须置 `UI_2D` 层**，不置就黑屏且无日志）/
`gameSprite` / `gameLabel` / `loadGameArt`（按 `group=bundle` 统一登记；**第一个参数是宿主节点**，加载期间被切走返回 `undefined`，
忘了判类型就红 —— 顺带把「取消」和「失败」分开：宿主已死不抛，宿主还活着的失败照抛）/ `releaseGameArt` / `exitButton` /
`fieldByHeight`、`fieldByWidth`（场地按高还是按宽定尺 —— 砖墙那种横向摆死的必须按宽，否则竖屏放不下）。
它**不含任何美术资产**：地基「只有逻辑、没有脸」说的是资产不许住这层，代码工具不在此列。

## 设计文档

- [`docs/ui-style-guide.md`](docs/ui-style-guide.md) —— **界面视觉风格**（明亮休闲卡通）：调色板、造型语言、「同界面多状态不换皮」规则，以及当前只用内置资源能落地到哪一步。做任何界面前先看这个。
- [`docs/scene-and-camera-architecture.md`](docs/scene-and-camera-architecture.md) —— **场景三分职责**（Boot 一次性引导 / Lobby 主场 / 子游戏自带场景）、**相机组规格**（背景 + UI 两台，priority 与 layer 双阶梯）、**多分辨率与转屏适配**，以及开发期踩坑清单。
- [`docs/design/lobby-modular-framework-overview.md`](../../docs/design/lobby-modular-framework-overview.md) —— 大厅框架范式：承载矩阵（panel / game）、模块契约、模块作用域资源、catalog。
- kit 侧实现见 [`camera-rig.md`](../../packages/engine/docs/modules/camera-rig.md)、[`app.md`](../../packages/core/docs/modules/app.md)（启动序列）、[`bundle-manager.md`](../../packages/core/docs/modules/bundle-manager.md)（`BundleScope` + 免重启换代码）。

> **包分层**：main 包（Boot + Bootstrap + AppConfig）必须重启才更新；`shared` / `lobby` 在启动序列里 load，更新下次启动天然生效；`modules/*` 可运行期换。判据见 [`ADR-0009`](../../docs/adr/0009-bundle-layering-criterion.md)。

## 跑起来

用 Cocos Creator 3.8.7 打开本工程，双击 **`Boot.scene`**，点编辑器顶部 ▶ 预览。

⚠️ 改了 `packages/engine` 的代码后：先 `pnpm build`，再**切一次 browser 预览**强制 Creator 重打包（它不监视 `node_modules/`），否则预览还在跑旧 dist。详见设计文档 §7 末尾的踩坑一节。

## 第三方美术资源

| 资源 | 来源 | 许可 |
|---|---|---|
| `assets/modules/mini-plane/art/*.png`（`sky.png` 除外） | [Kenney](https://www.kenney.nl/) 的 Construct 2 模板 `tappyplane.capx` | **CC0**（公共领域，商用无需署名；这里署名是出于礼貌） |
| `assets/modules/mini-brick/art/*.png` | 同上，`paddleball.capx` | CC0 |
| `assets/modules/mini-shooter/art/*.png` | 同上，`spaceshooter.capx` | CC0 |
| `assets/modules/mini-hop/art/*.png` + `level.ts` | 同上，`platformer.capx`（关卡由 `scripts/gen-hop-level.mjs` 烘出） | CC0 |
| `assets/modules/mini-cards/art/*.png` | 同上，`dicecards.capx` | CC0 |
| `assets/modules/mini-fish/art/textures.{png,plist}` + `seabed.jpg` | GitHub [`fylz1125/CCFish`](https://github.com/fylz1125/CCFish)（Cocos Creator 2.2.2 工程） | ⚠️ **原始版权归属不明** —— 该仓**没有 LICENSE 文件**，README 自述「仿照官方在线游戏」，无任何素材来源说明；图集里的鱼、炮台、UI 大概率源自某款商业捕鱼游戏。**不标 CC0**，仅作本仓 demo 的占位素材，商用前必须换掉 |

上表这一行的标签必须写准，否则其余五款的 CC0 声明也跟着不可信 —— 一张表里混进一条「按 CC0 处理」
的来路不明素材，整张表就只是装饰。`mini-fish` 用它是因为**这一刀验的是图集流水线本身**
（2MB 图集怎么打进 bundle、归属会不会漂、卸得干不干净），素材换成别的照样成立。

那套模板包里还有一个 `rpg.capx`，**没有移植**：它的事件表是空的、布局里只有三层瓦片和零个对象 ——
它是一张静态图，不是游戏，照搬过来只会多一个「打开看一眼就返回」的入口。

`sky.png` 是本仓生成的 8×8 纯色小图，取自 `bg.png` 的天空色 `rgb(213,237,247)`：竖屏场地比 480 高的
背景图高得多，上方拿它铺满，接缝看不出来。玩法参数同样照抄那份模板的事件表（换算表见 `PlaneVM` 的注释）。

## 像素级碰撞：美术在源码期烘成纯数据

`mini-plane` 的判定是**逐像素**的 —— 两张贴图的 alpha 真有实心像素叠在一起才算撞。这在「VM 零 `cc`」
的前提下有个坎：VM 拿不到 `Texture2D`、`readPixels`，node 单测里更没有引擎。解法是把「形状」这件事
挪到**源码期**：

```
art/*.png ──[ pnpm gen:masks ]──> collision-masks.ts   （位图数字数组，勿手改）
                                        ↓
                          PlaneVM.crashed()  ←→  node 单测   读同一份数据
```

于是判定跨平台逐位一致，且在 vitest 里能把飞机和岩石摆到精确坐标上问「这样算不算撞」。
代价是多了一份要跟美术同步的生成物，`pnpm check:masks`（第八道门）挡住「改了图没重烘」。

为什么值得：这套美术里**岩石是根锥子**，尖端只有 8px 宽，矩形近似却按 108 全宽算 —— 贴着缝边擦过去时
整个机身宽度都落在假判定里。逐像素之后致命窗口从对称的 ±85 收成实测的 `dx ∈ [-55, +23]`
（不对称是因为锥尖在贴图里偏右 11px）。判定分三层——宽相包围盒 → 每世界行折算一次贴图行（岩石是纵向
拉伸的）→ 逐像素，命中岩石才把该点逆旋转进机身局部查机身。实测每帧最坏 4.5µs，一帧预算的 0.03%。

`mini-hop` 的关卡走的是**同一条路**：原模板那 108 个手摆的实例经 `scripts/gen-hop-level.mjs` 烘成
`level.ts`（87 块实心砖 + 12 个装饰 + 6 枚硬币 + 2 只藤壶 + 出生点 + 终点），**VM 和单测读同一份** ——
于是「这级 70 高的台阶跳不跳得上去」「头顶那块砖挡不挡人」在 vitest 里就问得死，不用开 Creator 一遍遍试跳。
区别是它**没有 `--check` 闸**：源 `.capx` 不在本仓，CI 拿不到就没法比对，所以那份生成物一次烘出之后
当手写文件维护（脚本留着只为记清出处与坐标换算）。
