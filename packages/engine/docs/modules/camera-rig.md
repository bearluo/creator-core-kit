---
模块: camera-rig
所在包: packages/engine
状态: 已实现（kit 侧）
摘要: kit 常驻相机组——背景相机 + UI 相机固化成 persist 节点，priority/layer 双阶梯留出前景后景与 3D 世界空档；层级 root 用 RenderRoot2D + Widget；配套 resolutionModule 做「锁短边」横竖屏适配。
何时读: 接入 kit 的场景/相机骨架、要在背景与 UI 之间插相机、做多分辨率/旋转适配、或排查「预览正常真机花屏」类问题时。
日期: 2026-07-30
依赖: bootstrap（KitModule 生命周期）；cc: Camera / RenderRoot2D / Widget / UITransform / Layers / view / screen / ResolutionPolicy
---

# camera-rig 设计文档

## TL;DR

- `cameraRigModule()` 在 boot 时建**全 app 唯一、跨场景常驻**的相机组：`bg`（`SOLID_COLOR`，清色）+ `ui`（`DEPTH_ONLY`，叠上去），并给每层配好挂载 root。
- 业务场景**不再各配相机**；3D 子游戏只需把自己的 world 相机 priority 落进预留区 `1..99`，即自动盖在 2D 背景之上、UI 之下。
- `resolutionModule()` 按当前横竖屏**锁短边**切换设计分辨率与 `ResolutionPolicy`——引擎旋转时不会自己换，必须补这一步。
- 纯决策逻辑在 `src/render-policy.ts`（**零 cc**、17 条单测）；cc 薄壳在 `src/camera-rig.ts` / `src/resolution.ts`。
- 架构总述与 demo 落地见 [`apps/demo/docs/scene-and-camera-architecture.md`](../../../../apps/demo/docs/scene-and-camera-architecture.md)；「为什么不用 `Canvas`」的源码级依据见 [调研：cc Canvas vs RenderRoot2D](../../../../docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md)。

## Purpose（目标与定位）

**做什么**：把「每个可见场景都要有的相机 + UI 挂载骨架 + 分辨率适配」收成 kit 的一份常驻实现，消灭各场景重复手配、配错即真机花屏的风险。

**边界**：

- 只管**相机与层级 root** 的建立、priority/clearFlags/visibility 规格、相机随屏幕尺寸的同步，以及横竖屏下的设计分辨率切换。
- **不管**业务 UI 的开关栈、prefab 加载、界面导航 —— 那是 `UIManager`（core）的事，本模块只提供它挂载的 root。
- **不管强制旋转屏幕**：`view.setOrientation()` 按引擎注释「不会对 native 部分产生任何影响」，强制方向是原生工程 / 小游戏配置问题。kit 只负责「方向变了就正确适配」。

**YAGNI（首版故意砍掉）**：

- 只建 `bg` + `ui` 两层两台相机；`uiBack` / `uiFront` **只占 priority 与层号，不建节点**，按需开。
- 不做「自动把 world 相机塞进预留区」的 helper —— 项目用 `CAMERA_PRIORITY` 常量自取。
- 不代管 `SafeArea`（异形屏）。

## Public API（TypeScript 精确签名）

### 纯决策逻辑（`src/render-policy.ts`，零 cc）

```ts
/** priority 阶梯：值越小越先渲染 → 越大越叠在上层。`1..99` 预留给场景自带的 3D/特效相机。 */
export const CAMERA_PRIORITY: { readonly bg: 0; readonly uiBack: 100; readonly ui: 200; readonly uiFront: 300 };

/** 相机组层级标识。`ui` 用内置 `UI_2D`，其余见 CCK_LAYERS。 */
export type CameraRigLayer = keyof typeof CAMERA_PRIORITY;   // 'bg' | 'uiBack' | 'ui' | 'uiFront'

/** kit 自定义层：须先在 Project Settings → Layers 以指定 bit 注册（引擎只允许 bit 0–19）。 */
export const CCK_LAYERS: {
  readonly bg:      { readonly name: 'BG';       readonly bit: 0 };
  readonly uiBack:  { readonly name: 'UI_BACK';  readonly bit: 1 };
  readonly uiFront: { readonly name: 'UI_FRONT'; readonly bit: 2 };
};

export type Orientation = 'portrait' | 'landscape';
export interface DesignResolution {
  readonly orientation: Orientation;
  readonly width: number;
  readonly height: number;
  /** shell 映射：width → FIXED_WIDTH、height → FIXED_HEIGHT。 */
  readonly lockAxis: 'width' | 'height';
}
/** 锁短边：竖屏锁宽、横屏锁高；短边恒 shortSide 设计单位不裁切。非法尺寸退化为竖屏。 */
export function pickDesignResolution(
  windowWidth: number, windowHeight: number, shortSide?: number /* 1080 */, longSide?: number /* 1920 */,
): DesignResolution;

export interface OrthoHeightInput {
  readonly windowHeight: number;      // screen.windowSize.height
  readonly scaleY: number;            // view.getScaleY()
  readonly hasTargetTexture: boolean; // camera.targetTexture 非空
  readonly visibleRectHeight: number; // view.getVisibleSize().height
}
/** 照抄 canvas.ts::_onResizeCamera（含 targetTexture 分支）；scaleY<=0/NaN 时回退，不产出 Infinity。 */
export function computeOrthoHeight(i: OrthoHeightInput): number;

/**
 * 相机世界 XY —— **不是 (0,0)**：UI 坐标系原点在可视区左下角（`view.ts::_updateAdaptResult()`
 * 硬置 `vb.x=0; vb.y=0`），Widget 的 isRoot 分支按 `visibleRect.left.x/right.x` 把层级 root
 * 拉到 `[0,w]×[0,h]` → 节点落 `(w/2, h/2)`。相机留在世界原点会与内容错开半屏。
 */
export function computeCameraCenter(
  visibleWidth: number, visibleHeight: number,
): { readonly x: number; readonly y: number };

export interface ClearFlagsHolder { clearFlags: number }
export interface ClearOwnershipDeps {
  readonly background: { readonly node: { active: boolean } };
  readonly solidColor: number;  // Camera.ClearFlag.SOLID_COLOR，由 shell 注入
  readonly depthOnly: number;   // Camera.ClearFlag.DEPTH_ONLY
}
export interface ClearOwnership {
  claim(cam: ClearFlagsHolder): void;  // 幂等；换人会先归还前一台
  release(): void;                     // 无借用方时 no-op
  owner(): ClearFlagsHolder | undefined;
}
/** 清色职责移交状态机，守「任一时刻 priority 最低的活动相机必须 SOLID_COLOR」。 */
export function createClearOwnership(deps: ClearOwnershipDeps): ClearOwnership;
```

### 相机组（`src/camera-rig.ts`，cc 薄壳）

```ts
export interface CameraRigOptions {
  readonly clearColor?: Color;                      // 默认 Color(28,30,40,255)
  readonly layers?: readonly CameraRigLayer[];       // 默认 ['bg','ui']；必须含 'bg'
}

export interface CameraRig {
  readonly root: Node;                              // 常驻根（已 addPersistRootNode）
  /** ⚠️ 挂上去的节点跨场景存活——只放全局 loading/toast/断线提示；场景 UI 留在场景里。 */
  layerRoot(layer: CameraRigLayer): Node;           // @throws 该层未启用
  camera(layer: CameraRigLayer): Camera;            // @throws 该层未启用
  claimClear(cam: Camera): void;                    // 「故意不要背景」时用
  releaseClear(): void;
  dispose(): void;                                  // 解监听 + 释放借用 + 销毁常驻根
}

export const CAMERA_RIG: Token<CameraRig>;
export function createCameraRig(opts?: CameraRigOptions): CameraRig;   // 直建（测试/特殊编排）
export function cameraRigModule(opts?: CameraRigOptions): KitModule;   // 常规用法
export function getCameraRig(): CameraRig;
```

### 横竖屏适配（`src/resolution.ts`，cc 薄壳）

```ts
export interface ResolutionOptions {
  readonly shortSide?: number;   // 默认 1080
  readonly longSide?: number;    // 默认 1920
  readonly onOrientationChange?: (orientation: Orientation) => void;
}
/** 按当前横竖屏「锁短边」自动切换设计分辨率与 ResolutionPolicy。锁单一方向的项目不必装。 */
export function resolutionModule(opts?: ResolutionOptions): KitModule;
```

用法：

```ts
await bootCoreKit({
  modules: [resolutionModule({ shortSide: 1080, longSide: 1920 }), cameraRigModule(), /* ... */],
});
```

## Behavior & data flow（行为与数据流）

### 建组（`start`）

1. **校验 `layers` 含 `'bg'`** —— 它是唯一清色相机，缺了真机颜色缓冲未定义。
2. **全量校验自定义层**再动手建节点（避免建一半失败留残根）：读 `Layers.Enum[name]`，未注册或 bit 不符即抛可操作错误（含"去 Project Settings → Layers 把 bit N 命名为 X"）。**不做 `Layers.addLayer` 运行时兜底**（决策 #5）。
3. **建常驻根**：若场景里已有 `CCKRig`（开发期热重载重跑模块顶层的典型情形）→ `removePersistRootNode` + `destroy` 换新的，不复用旧代码建的树；然后 `new Node('CCKRig')` → `scene.addChild` → `director.addPersistRootNode`（须为场景根直接子节点）。

   > ⚠️ **`CCKRig` 绝对不能挂 `UITransform`。** 层级 root 的 `Widget` 靠 `widget-manager.ts:64` 的
   > `useGlobal = target instanceof Scene || !target.getComponent(UITransform)` 走 `isRoot` 分支、对齐 `visibleRect`（全屏）。
   > 一旦 `CCKRig` 有了 `UITransform`，`useGlobal` 变 `false` → Widget 改为对齐其 `contentSize`（默认 100×100）
   > → **全部 UI 缩成 100×100**。详见 [调研 §7](../../../../docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md)。

4. **逐层建**：
   - 相机节点：`Camera`，`projection = ORTHO`、`priority = CAMERA_PRIORITY[layer]`、`visibility = 本层掩码`（只渲本层 → 多台 UI 相机不会把同一批节点渲两遍）、`bg` 用 `SOLID_COLOR` + `clearColor`，其余 `DEPTH_ONLY`。
   - 层级 root：`UITransform` + `RenderRoot2D` + `Widget`（四边全 0，`alignMode = ON_WINDOW_RESIZE`）。
5. **首次 `syncCameras()`** + 挂 `view.on('canvas-resize' | 'design-resolution-changed')`。

| layer | priority | clearFlags | visibility |
|---|---|---|---|
| `bg` | 0 | `SOLID_COLOR` | 自定义 `BG` |
| `uiBack` | 100 | `DEPTH_ONLY` | 自定义 `UI_BACK` |
| `ui` | 200 | `DEPTH_ONLY` | 内置 `UI_2D` |
| `uiFront` | 300 | `DEPTH_ONLY` | 自定义 `UI_FRONT` |

### 相机随屏幕同步（`syncCameras`）

照抄 `canvas.ts::_onResizeCamera()`。所有 UI 相机全屏同参数 → `orthoHeight` 是**同一个值**，一次循环设完，**不需要「每层一个同步组件」**；Z 恒 1000（UI 视距范围 -999..1000，Canvas 源码同样硬编码 1000）。

⚠️ **XY 不是 (0,0)，是可视矩形中心 `(w/2, h/2)`**（`computeCameraCenter`）。UI 坐标系原点在**可视区左下角**——`view.ts::_updateAdaptResult()` 硬置 `vb.x = 0; vb.y = 0`，`visibleRect` 恒为 `[0,w] × [0,h]`；`widget-manager.ts::align()` 的 `isRoot` 分支拿 `visibleRect.left.x / right.x` 当边界，锚点 0.5 → 层级 root 落 `(w/2, h/2)`；编辑器默认的 Canvas 同样放在 `(w/2, h/2)`，其相机作为子节点跟着偏移。相机若留在世界原点，视野 `[-w/2,w/2] × [-h/2,h/2]` 与内容整整错开半屏（实测表现：界面挤到右上角、大半不可见）。

**禁止移动层级 root 节点**（要位移就动其子节点），否则相机与内容错位。

> **为什么不用管层级 root 自己的尺寸**：源码里 `Canvas` 组件**从不碰自己节点的 contentSize**——`_onResizeCamera` 只改相机。「尺寸跟随屏幕」是 `Widget` 干的（`canvas.ts:173-180`）。我们照此挂 Widget 即可，零代码。

### 横竖屏切换（`resolutionModule`）

**为什么必须有**：引擎旋转时**不会**交换设计分辨率。`view.ts::_updateAdaptResult()` 收到 `screen` 的 `window-resize` 后，只是拿**原样** design resolution + **原** policy 重算一遍（`setDesignResolutionSize(w, h, this._resolutionPolicy)`）。固定 1080×1920 + `FIXED_WIDTH` 转横屏后仍锁宽 1080 → 可视高度缩到约 600 设计单位，UI 全挤没。

**锁短边规则**：

| 方向 | 设计分辨率 | policy |
|---|---|---|
| 竖屏（w ≤ h） | 1080 × 1920 | `FIXED_WIDTH` |
| 横屏（w > h） | 1920 × 1080 | `FIXED_HEIGHT` |

即**短边恒 1080 设计单位、永不裁切**，长边随实际屏幕比例延展（多出的空间由 Widget 锚定填充）。

**触发与去重**：同时听 `screen.on('orientation-change')`（引擎自己没订，`view.init` 只订了 `window-resize`/`fullscreen-change`）与 `view.on('canvas-resize')`，取先到者；内部按 `orientation` 去重，同方向内的尺寸变化交给引擎按现有 policy 重算。`applying` 标志防重入（`setDesignResolutionSize` 会 emit `design-resolution-changed`）。

**与相机组的协作是隐式的**：`resolutionModule` 改分辨率 → 引擎 emit `design-resolution-changed` → camera-rig 的 `syncCameras` 自动重算 `orthoHeight`。两模块零直接耦合。

⚠️ **两个方向的设计分辨率不同 → UI 必须用 Widget 锚定做响应式布局**，不能硬编码坐标。

### 清色职责移交

内部只记一个 `_clearOwner`，两个方法对称；`dispose()` 时先 `release()`，不把被改过 `clearFlags` 的外部相机留在借用态。

### core / engine 分工

本模块整体属 engine。core 侧不感知相机；`UIManager`（core）经 `IUIView`（engine `cc-ui.ts`）拿挂载 root —— 落地时把 `cc-ui.ts` 的 root 解析改为优先取 `getCameraRig().layerRoot('ui')`，保留现有兜底。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 相机归属 | 各场景自配 / **kit 常驻** | **kit 常驻** | 全 app 一份，「每场景须有清色相机」一次满足，杜绝配错 |
| 2 | 层级 root 载体 | Canvas-per-camera / **`RenderRoot2D`** | **`RenderRoot2D`** | 它才是 2D 渲染入口；相机配对靠 `layer × visibility`，不需要 `Canvas.cameraComponent` |
| 3 | 节点尺寸适配 | 自研同步组件 / **引擎 `Widget`** | **`Widget`**（四边 0，`ON_WINDOW_RESIZE`） | 与引擎默认 Canvas 完全同法，零代码；源码证实 Canvas 自己也靠 Widget |
| 4 | 相机 orthoHeight | 每层一个组件 / **相机组一个方法** | **一个方法循环设** | 全屏同参数正交相机的 orthoHeight 是同一个值 |
| 5 | 自定义层注册 | 运行时 `addLayer` 兜底 / **只校验并报错** | **只校验** | 运行时注册与 Project Settings 不一致会让场景里存的 layer 值错位，静默出诡异 bug |
| 6 | 重复建组 | 直接建 / 复用旧根 / **销毁旧根重建** | **销毁重建** | 热重载后旧根是**旧代码**建的，复用比重建更危险；观察上仍是「恰好一个 rig」 |
| 7 | 「不要背景」 | 业务自改两字段 / **封 `claimClear`** | **封成原子方法** | 两处须同改，漏一处只在真机显形（overdraw 或花屏），预览查不出 |
| 8 | 前景/后景层 | 一并建好 / **只占号，按需开** | **只占号** | YAGNI；priority 与 bit 已留，加时不动 kit 数值 |
| 9 | 常驻服务节点 | 相机组兼作服务容器 / **不兼** | **不兼** | BGM 已有自己的 `CCK_Audio` persist 节点；ticker 订阅 `director` 事件、不需节点 |
| 10 | 每层几个 root | 一个 / 多个 | **一个** | 同相机内多个 `RenderRoot2D` 的绘制序取决于 `node.siblingIndex`（`batcher-2d.ts:982`），单 root 免掉隐式耦合 |
| 11 | 横竖屏适配归属 | 塞进相机组 / **独立 `resolutionModule`** | **独立** | 设计分辨率是**项目级**决策；锁单方向的项目不装即可；两者经 `design-resolution-changed` 隐式协作、零耦合 |
| 12 | 旋转时怎么变 | 只换 policy / **换 policy + 换设计分辨率** | **两者都换（锁短边）** | 只换 policy 仍会让横屏可视短边缩水；锁短边保证短边永不裁切 |
| 13 | 强制旋转屏幕 | kit 封装 / **不做** | **不做** | `view.setOrientation` 原生无效（引擎注释明说），属平台工程配置 |
| 14 | 相机 XY 参照系 | 世界原点 / **可视矩形中心** | **可视矩形中心** | UI 坐标系原点在可视区左下（`vb.x=0`），Widget 把 root 拉到 `[0,w]×[0,h]`；相机留原点会错开半屏（本轮实测踩到） |

## Platform considerations（全平台 / 小游戏兼容）

- **`screen.windowSize` / `view.getScaleY()` / `view.getVisibleSize()`**：Web / 原生 / 小游戏均可用。`view.getVisibleSize()` 与引擎内部 `visibleRect` 同源（都取 `_visibleRect`）——后者不在公开 cc 声明里，故用前者。
- **`screen.on('orientation-change')`**：`PalScreenEvent` 三个合法值之一（`"window-resize" | "orientation-change" | "fullscreen-change"`）。各平台由 pal 层适配。
- **`SafeArea`**（异形屏）：内部依赖 `sys.getSafeAreaRect()`，仅 iOS/Android 有实际效果。**不挂层级 root**（会把全屏背景/遮罩也收进安全区），应挂交互内容容器。业务侧选择，本模块不代劳。
- **清色相机与移动端闪屏**：引擎在 `Canvas.renderMode` 注释里明说「场景里的相机必须有一个 ClearFlag 选 `SOLID_COLOR`，否则在移动端可能会出现闪屏」。这是 `claimClear` 存在的根本原因，且**只在真机显形**。
- **三种「热」**：*线上热更* —— 相机组在主包 engine 里，换 bundle 不影响；*运行时分包* —— 模块 bundle 只往层级 root 挂内容，不碰相机；*开发期热重载* —— 靠决策 #6 的销毁重建兜住。

## Testable seams + test plan（可测接缝 + vitest 用例）

**分工遵 ADR-0002 决策 3**：`Node/Camera/Widget/布局计算` 等**需要真实引擎行为的 API 禁止进 cc mock**。故：

- **纯决策逻辑 → node 单测**（`src/render-policy.ts` 零 cc import，测试也不 import cc）：
  `packages/engine/src/__tests__/render-policy.test.ts`，**20 条，全绿**：
  - `pickDesignResolution` 7 条：竖屏/横屏/正方形/极端宽屏/自定义边长/传反归一化/非法尺寸不抛错。
  - `computeOrthoHeight` 3 条：无 targetTexture 公式、有 targetTexture 分支、`scaleY` 为 0/-1/NaN 时回退且有限。
  - `createClearOwnership` 5 条：claim/release 双向、重复 claim 幂等、A→B 换人时 A 归还且背景仍关、未 claim 就 release 与重复 release 均 no-op。
  - 常量阶梯 2 条：priority 递增且 `bg`→`uiBack` 间留有空档、自定义层 bit 落在 0..19 且互不重叠。
  - `computeCameraCenter` 3 条（**回归用例**，决策 #14）：竖屏落 `(540,960)`、横屏落 `(960,540)`、绝不等于世界原点。
- **cc 薄壳 → apps/demo 集成/预览验证**（不靠 mock）。`tsc -b` 对**官方 `@cocos/creator-types/engine` 全量真类型**通过，是签名层的第一道把关。

**预览实测结果**（2026-07-30，apps/demo Game View，0 error / 0 warning）：

| # | 项 | 结果 |
|---|---|---|
| 1 | 相机 + `RenderRoot2D` 在 persist 节点上跨 `loadScene` 持续渲染 | ✅ Lobby → Dodge → Lobby 全程 `CCKRig` 存活并正常出图 |
| 2 | **场景内** `RenderRoot2D` 子树被**常驻**相机按 layer 渲染 | ✅ Lobby / Dodge 两场景均无自带相机，内容由常驻 `uiCamera` 渲出 |
| 3 | 层级 root 的 `Widget` 在裸 `Node` 父级下拉满 `visibleRect` | ✅ 大厅内容水平居中、随窗口重排 |
| 4 | 旋转时 `resolutionModule` 换分辨率 → 相机跟上 | ⚠️ **未实测**（见下） |
| 5 | `claimClear` 后背景消失且无花屏 | ⚠️ **未实测**（demo 无「故意不要背景」的场景可借用） |

第 4 项为何未实测：Game View 的「设计分辨率」模式把画布**钉在项目设计分辨率**上，改编辑器窗口尺寸不会让 `screen.windowSize` 变横向；面板的旋转开关是 panel 局部 UI，`Editor.Profile` 里改 `preview.preview.rotate` 不触发它，也没有对应的 `Editor.Message`。要实测须**真机转屏**或浏览器预览手动改窗口比例。纯逻辑侧（`pickDesignResolution` × 7、`computeCameraCenter` 横屏用例）已单测覆盖，未覆盖的只剩 6 行事件订阅接线。

## Open Questions（待用户拍板）

1. 是否给 `cc-ui.ts`（`IUIView`）加「按层挂载」参数，让 `UIManager.open` 能指定挂 `uiFront`（弹窗）而非 `ui`？首版可不做。

---

## 实现记录

- **最终 API 与设计偏差**：
  - `CAMERA_PRIORITY.background` → **`.bg`**，与 `CameraRigLayer` / `CCK_LAYERS` 键名统一。
  - 新增 `createCameraRig()`（不经 KitModule 直建，便于特殊编排）。
  - 新增独立的 **`resolutionModule`**（`src/resolution.ts`）——本轮新增需求「竖屏大厅旋转成横屏游戏」的落地，决策 #11~13。
  - `visibleRect` **不在公开 cc 声明里**，改用等价的 `view.getVisibleSize().height`。
  - 决策 #6 从「幂等复用同名根」改为「**销毁旧根重建**」——复用旧代码建的节点树更危险。
  - `computeOrthoHeight` 比 Canvas 源码多一个 `scaleY <= 0/NaN` 的 guard（`ponytail:` 注明），挡住 Infinity/NaN 进渲染管线。
  - 层校验错误信息带上「去 Project Settings → Layers 把 bit N 命名为 X」的可操作指引。
  - **新增 `computeCameraCenter`（决策 #14）**：首版把相机放在世界 `(0,0)`，预览实测发现界面整体偏到右上角、大半不可见。查源码坐实 UI 坐标系原点在可视区左下（`view.ts` 硬置 `vb.x=0; vb.y=0`），Widget 的 isRoot 分支把层级 root 拉到 `[0,w]×[0,h]`。改为把相机摆到可视矩形中心，并补 3 条回归单测。
- **测试结果**：`render-policy.test.ts` **20 条全绿**；全仓 `vitest run` **410 tests / 27 files 全绿**；`tsc -b --force` 对官方真 cc 类型 exit 0；`eslint .` 0 warning；`pnpm build` 成功。
- **预览实测（apps/demo）**：Boot → kit(含 `resolution` + `camera-rig`) → `loadScene('Lobby')` → panel 模块 shop mount/unmount/release → game 模块 mini-dodge 切 `Dodge.scene` → `lobby:back` 切回 `Lobby.scene` + release，**全程 0 error / 0 warning**。逐项结果见上方测试计划表。
- **commit / PR**：待提交。
- **遗留 Minors**：
  - 测试计划表第 4 / 5 项未实测（转屏须真机；`claimClear` demo 里无场景可借用）。
  - Open Question 1（`IUIView` 按层挂载参数）仍未做。
