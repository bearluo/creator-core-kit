# apps/demo — creator-core-kit 实测工程

真实 Cocos Creator 3.8.7 工程，作两件事：**给新项目看「怎么接入 kit」的样例**，以及**在真 cc 里逐模块验证 engine 适配层**。

## 场景一览

| 场景 | 用途 | 入口脚本 |
|---|---|---|
| **`assets/scenes/Boot.scene`**（main 包） | 🌱 **一次性启动场**：装配 kit → 跑启动序列（读戳 → 热更 → `shared` → `lobby`）。除 app 重启外不二次进入 | `scenes/Bootstrap.ts` |
| **`assets/modules/lobby/Lobby.scene`**（`lobby` bundle） | 🏠 **大厅主场**，也是子游戏的返回目标（每次返回都重新加载）。大厅自己就是一个可热更的 bundle | `modules/lobby/LobbyHost.ts` |
| `assets/modules/mini-dodge/Dodge.scene` | 🎮 子游戏自带场景，在自己的 Asset Bundle 里 | `modules/mini-dodge/DodgeGame.ts` |
| `assets/modules/mini-plane/Plane.scene` | 🎮 能真玩的那个：贴图也随 bundle 走，玩法全在零 `cc` 的 `PlaneVM` | `modules/mini-plane/PlaneGame.ts` |

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
| `needFullUpdate` | 需要下载完整安装包 + 原因 | 引导去应用商店（热更换不动引擎 / AOT chunks / 主包，重试没意义） |
| `fatal` | 启动失败 + 错误信息 | 「重启应用」→ `app.restart()` |

**③ `LobbyHost.ts` + `module-catalog.ts`（怎么加功能）** —— 大厅是**数据驱动**的：加一个功能 = 新建 `assets/modules/<id>/` 一个 bundle + 在 `MODULE_CATALOG` 加一行，**大厅代码零改**。界面同样是 prefab：`LobbyPanel.prefab`（标题 + 副标题 + `Items` 容器）+ `LobbyItem.prefab`（一个入口按钮的模板），代码只负责按清单克隆模板、填标题、绑点击。两种承载：

- `kind: 'panel'` —— UI 面板，由 UIManager 按注册表加载并挂进常驻层容器；关闭时一行 `await scope.dispose()` 对称回收（关界面 → 撤 i18n / 配表 / 资源 / DI 子作用域 → `release(bundle)`）。样例：`shop`、`mini-clicker`；
- `kind: 'game'` —— 全屏子游戏，走 `SceneFlow` 切到 bundle 自带的场景；返回不 import 主包，靠 core `EventBus` emit `lobby:back` 解耦（样例：`mini-dodge` 只演示切场景；`mini-plane` 是真能玩的那个 —— 玩法在零 `cc` 的 `PlaneVM`，View 只摆位置）。

**④ 纯逻辑 ViewModel（零 `cc`）** —— 如 `modules/mini-clicker/CounterVM.ts`：状态与行为写在这，可直接 node/vitest 单测、不用开 Creator，再用 `bindText` 单向映射到 cc `Label`。这是铁律「逻辑可脱离引擎」+「数据驱动 UI」的落地。

> **UI 一律走 prefab**（`CLAUDE.md` §多人协作）：首次创建用 `scripts/prefab-gen/`（描述 JSON → 编辑器 `create-prefab`），之后改 prefab 就在编辑器里改。脚本里只留填数据 / 绑事件。
> 层的坑：UI 节点必须落在 `Layers.Enum.UI_2D` 层，否则 UI 相机 `visibility` 不含它 → 不可见且无日志。生成器已统一置好，手搭节点时要自己注意。

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

`sky.png` 是本仓生成的 8×8 纯色小图，取自 `bg.png` 的天空色 `rgb(213,237,247)`：竖屏场地比 480 高的
背景图高得多，上方拿它铺满，接缝看不出来。玩法参数同样照抄那份模板的事件表（换算表见 `PlaneVM` 的注释）。
