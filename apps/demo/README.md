# apps/demo — creator-core-kit 实测工程

真实 Cocos Creator 3.8.7 工程，作两件事：**给新项目看「怎么接入 kit」的样例**，以及**在真 cc 里逐模块验证 engine 适配层**。

## 场景一览

| 场景 | 用途 | 入口脚本 |
|---|---|---|
| **`assets/scenes/Boot.scene`** | 🌱 **一次性启动场**：装配 kit → 进第一个场景。除 app 重启外不二次进入 | `scenes/Bootstrap.ts` |
| **`assets/scenes/Lobby.scene`** | 🏠 **大厅主场**，也是子游戏的返回目标（每次返回都重新加载） | `lobby/LobbyHost.ts` |
| `assets/modules/mini-dodge/Dodge.scene` | 🎮 子游戏自带场景，在自己的 Asset Bundle 里 | `modules/mini-dodge/DodgeGame.ts` |
| `assets/test/Demo.scene` | 🔬 逐模块验证探针（狂打 `[CCK-DEMO]` 日志，无可见 UI） | `test/DemoBoot.ts` |

**`Boot` / `Lobby` / `Dodge` 都不含相机、不含 Canvas** —— 相机由 kit 的常驻相机组（`cameraRigModule`）在 Boot 阶段建好并跨场景存活。原理与约束见下方设计文档。（`Demo.scene` 是只打日志的探针，本来就不需要相机；它自己起 kit、不走 Boot。）

## 接入样例怎么读

**① `Bootstrap.ts`（怎么起）** —— 一句 `bootCoreKit({ modules })` 装配项目要用的 cc 适配模块，然后 `loadScene(firstScene)`。要加/减能力就动这个数组：

```ts
await bootCoreKit({
  modules: [
    resolutionModule({ shortSide: 1080, longSide: 1920 }), // 横竖屏锁短边适配
    cameraRigModule(),                                     // 常驻背景 + UI 相机
    ccAssetModule(), ccBundleModule(), ccStorageModule(), ccAudioModule(), ccUIModule(),
  ],
});
```

**② `LobbyHost.ts` + `module-catalog.ts`（怎么加功能）** —— 大厅是**数据驱动**的：加一个功能 = 新建 `assets/modules/<id>/` 一个 bundle + 在 `MODULE_CATALOG` 加一行，**大厅代码零改**。两种承载：

- `kind: 'panel'` —— UI 面板，挂进大厅场景，`load bundle → mount → unmount → release` 对称回收（样例：`shop`、`mini-clicker`）；
- `kind: 'game'` —— 全屏子游戏，走 `SceneFlow` 切到 bundle 自带的场景；返回不 import 主包，靠 core `EventBus` emit `lobby:back` 解耦（样例：`mini-dodge`）。

**③ 纯逻辑 ViewModel（零 `cc`）** —— 如 `modules/mini-clicker/CounterVM.ts`：状态与行为写在这，可直接 node/vitest 单测、不用开 Creator，再用 `bindText` 单向映射到 cc `Label`。这是铁律「逻辑可脱离引擎」+「数据驱动 UI」的落地。

> 代码建 UI 的坑：UI 节点必须落在 `Layers.Enum.UI_2D` 层，否则 UI 相机 `visibility` 不含它 → 不可见。见 `LobbyHost.makeLabel`。

## 设计文档

- [`docs/scene-and-camera-architecture.md`](docs/scene-and-camera-architecture.md) —— **场景三分职责**（Boot 一次性引导 / Lobby 主场 / 子游戏自带场景）、**相机组规格**（背景 + UI 两台，priority 与 layer 双阶梯）、**多分辨率与转屏适配**，以及开发期踩坑清单。
- kit 侧实现见 [`packages/engine/docs/modules/camera-rig.md`](../../packages/engine/docs/modules/camera-rig.md)。

## 跑起来

用 Cocos Creator 3.8.7 打开本工程，双击 **`Boot.scene`**，点编辑器顶部 ▶ 预览。

⚠️ 改了 `packages/engine` 的代码后：先 `pnpm build`，再**切一次 browser 预览**强制 Creator 重打包（它不监视 `node_modules/`），否则预览还在跑旧 dist。详见设计文档 §7 末尾的踩坑一节。
