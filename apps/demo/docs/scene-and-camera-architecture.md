# demo · 场景与相机架构

> **状态**：已实现（2026-07-30，Game View 预览实测通过；转屏与 `claimClear` 两项待真机）
> **摘要**：定义**场景三分职责**（Boot 一次性引导 / Lobby 主场 / 子游戏自带场景）与 **kit 常驻相机组**规格——背景相机 + UI 相机固化成常驻节点，priority 与 layer 双阶梯留出前景/后景与 3D 世界空档，层级 root 用 `RenderRoot2D` 而非 Canvas。
> **何时读**：动 `apps/demo` 的场景结构、相机、层、UI 挂载点，或往新项目搬这套骨架时。
> **依赖**：`docs/design/2026-07-24-architecture-overview.md`（总纲）、`apps/demo/README.md`（工程导览）、`docs/research/*场景架构*`（scene vs prefab 选型调研）
> **实现归属**：相机组是 **kit 能力**，实现落 `packages/engine`（cc 适配层）；本文档记架构与 demo 落地方式。

---

## 1. 场景三分职责

| 场景 | 职责 | 生命周期 | 内含 |
|---|---|---|---|
| **`Boot.scene`**（main 包） | **一次性启动场**：Bootstrap 脚本 `bootCoreKit()` 装配 kit（含 **kit 常驻相机组**）→ `app.launch()` 跑启动序列（读戳 → 热更 → `shared` → `lobby`），进大厅由序列末尾的 `lobby.enter` 回调发起 | **除 app 重启外不二次进入** | 一个挂 Bootstrap 脚本的空节点 |
| **`Lobby.scene`**（`lobby` bundle） | **主场 / 大厅**，也是子游戏的**返回目标**。大厅自己是一个 bundle（可热更），场景也在包内，切回来要带 `{bundle:'lobby'}` | 每次返回大厅都**重新加载** | **只有大厅自己的内容**（无相机——相机常驻） |
| 子游戏 `<module>/<Game>.scene` | 全屏子游戏，在自己 bundle 内 | 进入时加载、返回时卸载 | 自己的内容；**3D 子游戏额外加一台 world 相机** |

**为什么 Boot 不兼任返回目标**：常驻相机组用 `addPersistRootNode` 注册，而它在 Boot 里建。若 Boot 同时是返回目标，每次返回重载 Boot 就会**再建一份常驻组叠在已存活的那份上** → 双份相机。「一次性启动场」与「可反复重载的主场」拆开，这个冲突从结构上消失。

### 持久 vs 场景所有

| 归属 | 内容 | 谁建 |
|---|---|---|
| **持久**（`addPersistRootNode`，Boot 里建一次） | **相机组 `CCKRig`** + **各层级 root**（`RenderRoot2D`） | **kit**（`packages/engine`，见 [camera-rig](../../../packages/engine/docs/modules/camera-rig.md)） |
| **场景所有** | 场景自己的内容：大厅 UI、子游戏内容、3D world 相机 | 场景 / 业务 |

**跨场景服务不需要新的常驻节点——两样都已就位**（核对过实现，不必并进相机组根）：

| 服务 | 现状 | 出处 |
|---|---|---|
| **BGM 跨场景续播** | 音频宿主节点 `CCK_Audio` **已经** `addPersistRootNode` | `packages/engine/src/cc-audio.ts` `ensureHost()` |
| **全局 ticker** | 订阅 `director.on(Director.EVENT_AFTER_UPDATE)`，`director` 是全局单例、**不依赖任何节点**，天然跨场景 | `packages/engine/src/bootstrap.ts` `driveWithDirector()` |

所以 app 里会有**两个各管各的 persist 根**（`CCK_Audio` + `CCKRig`）——引擎允许多个，且比塞进一个更内聚，不动已经工作的音频。

⚠️ **常驻层级 root 下挂的东西会跨场景存活。** 所以场景自己的 UI **不要**直接挂常驻 root（切场景不销毁 → 泄漏叠加）。场景内容放在**场景自己的节点**上（加自己的 `RenderRoot2D`、层设成对应层）——相机按 **layer** 渲染、不看层级归属，照样渲得到，且随场景销毁。常驻层级 root 只留给**真正需要跨场景的 UI**：全局 loading、toast、断线提示，以及有意跨场景存活的模块 panel。

kit 的纯**状态**（货币、进度）本就靠 JS 模块单例跨场景存活，连节点都不需要。

---

## 2. kit 常驻相机组（CameraRig）

**全 app 一组，常驻，所有场景共用。** 当前固化 **2 台**相机，priority 留出前景/后景与 3D 世界空档。

| # | 相机 | priority | `clearFlags` | projection | visibility（层） | 归属 |
|---|---|---|---|---|---|---|
| 1 | **Background** | `0` | `SOLID_COLOR` | `ORTHO` | `BG`（自定义） | **kit 常驻** |
| — | *（预留）* | `1..99` | **`DEPTH_ONLY`** | `PERSPECTIVE` / 按需 | `DEFAULT` 等 | **场景自带**：3D 世界相机、特效相机 |
| — | *（预留）* | `100` | `DEPTH_ONLY` | `ORTHO` | `UI_BACK`（自定义） | kit 常驻（暂不建） |
| 2 | **UI** | `200` | `DEPTH_ONLY` | `ORTHO` | `UI_2D`（内置） | **kit 常驻** |
| — | *（预留）* | `300` | `DEPTH_ONLY` | `ORTHO` | `UI_FRONT`（自定义） | kit 常驻（暂不建） |

```ts
/** kit 相机阶梯：priority 值越小越先渲染 → 越大越叠在上层。空档留给项目自己插相机。 */
export const CAMERA_PRIORITY = {
  background: 0,   // kit 常驻，全场唯一清色的那台
  // 1..99   预留：场景自带的 3D 世界 / 特效相机（必须 DEPTH_ONLY）
  uiBack: 100,     // 预留：UI 后景
  ui: 200,         // kit 常驻，主 UI
  uiFront: 300,    // 预留：UI 前景
} as const;
```

### 铁律：清色职责归「最底层的活动相机」

> **不变式：任一时刻，priority 最低的活动相机必须 `SOLID_COLOR`，其余全部 `DEPTH_ONLY`。**

官方在 `Canvas` 文档里点明了下限：「场景里的相机（包括 Canvas 内置的相机）必须有一个的 ClearFlag 选择 `SOLID_COLOR`，否则在移动端可能会出现闪屏」。⚠️ **这个坑只在真机 / 移动端显形，编辑器预览看不出来**。

默认态：Background（prio 0）就是最底层，由它清色；**背景色 = 它的 `clearColor`**（UI 相机是 `DEPTH_ONLY`，其 `clearColor` 不生效）。

在此之上，「要不要显示背景」是一个**旋钮**，两种意图都正当：

| 意图 | 做法 | 结果 |
|---|---|---|
| **3D 内容盖在 2D 背景之上**（背景透上来） | world 相机 `DEPTH_ONLY`，priority 落 `1..99` | 自动叠在背景之上、UI 之下，**无需其他处理** |
| **故意不要背景**（全屏不透明 3D 场景 / 子游戏自带整屏画面） | **清色职责移交**：关掉 Background 相机 **+** world 相机设 `SOLID_COLOR` | world 相机成为最低活动相机，不变式仍成立 |

移交这件事必须**两处同改**，漏一处的后果不对称：

- ❌ **只把 world 相机设 `SOLID_COLOR`，留着 Background 开着**：画面正确、不变式没破，但**背景整屏白画一遍后被完全覆盖** —— 多一次全屏 clear + 整批背景 drawcall 纯 overdraw，移动端 tiled GPU 上是实打实的带宽浪费。
- ❌ **只关 Background，world 相机仍是 `DEPTH_ONLY`**：没有相机清色 → 颜色缓冲内容未定义 → **真机花屏 / 残影**，而预览正常，最难查。

因为它是「两处必须同改、漏一处在真机上才炸」的配对操作，**kit 相机组把它封成一对原子方法** `claimClear(cam)` / `releaseClear()`（见 §7），业务不手动碰这两个字段。

最后：**不用「关掉某台相机让位」做场景切换**。相机组常驻不动，画面分层由 priority + layer 决定；相机开关只用于上述清色移交与同场景内的显隐编排。

### 「2D 还是 3D」由什么决定（易错点）

- **`Layers.Enum.UI_2D` 只是分类标签 / 过滤位**，不含 2D/3D 语义。引擎不阻止把 mesh 打成 `UI_2D`、把精灵打成 `DEFAULT`。
- 真正决定画面的是 **`Camera.projection`（`ORTHO`/`PERSPECTIVE`）** 与 **`Camera.visibility`（渲哪些层）**。「UI 相机 = `ORTHO` + visibility 含 `UI_2D`」是约定组合，不是层名自带的性质。
- 一台相机只有一个 projection，无法同时透视渲世界 + 正交渲 UI ——「3D 世界 + 2D HUD」本来就必须多相机叠加，正是上表的形态。

---

## 3. 层阶梯 + `RenderRoot2D`（不用 Canvas-per-camera）

### 3.1 为什么层也要留空间

若两台 UI 相机的 `visibility` 都含 `UI_2D`，同一批节点会被**渲两遍**（多一遍 drawcall + 半透明叠色异常）。所以 priority 阶梯必须配一套**专属层**：

| 层 | 来源 | 归属相机 | 层级 root |
|---|---|---|---|
| `BG` | 自定义 bit **0** | Background | `BGRoot`（常驻，`RenderRoot2D`） |
| `DEFAULT` | 内置（高位保留） | 场景自带 world 相机 | 无需（mesh 直接摆） |
| `UI_BACK` | 自定义 bit **1** | 预留：UI 后景 | `UIBackRoot`（预留） |
| `UI_2D` | 内置（高位保留） | UI | `UIRoot`（常驻，`RenderRoot2D`） |
| `UI_FRONT` | 自定义 bit **2** | 预留：UI 前景 | `UIFrontRoot`（预留） |

- 自定义层**只能用 bit 0–19**（其余引擎保留）；在 Project Settings → Layers 配，或 `Layers.addLayer(name, bitNum)`。
- 掩码组合用 `Layers.makeMaskInclude([...])` / `makeMaskExclude([...])`。
- **当前 demo 一个自定义层都没配**（`settings/v2/packages/project.json` 仅有版本号）——实现时需新增。

### 3.2 层级 root 用 `RenderRoot2D`，不塞进 Canvas

`Canvas extends RenderRoot2D`。真正让 2D 内容可渲染的是 **`RenderRoot2D`**——官方定义：「2D 对象数据收集的入口节点，**所有的 2D 渲染对象需在 RenderRoot 节点下才可以被渲染**」。Canvas 只是 `RenderRoot2D` **加**了两件事：

| | `RenderRoot2D` | `Canvas`（= RenderRoot2D + 以下） |
|---|---|---|
| 2D 渲染入口 | ✅ | ✅ |
| `cameraComponent`（绑定一台相机） | ❌ | ✅（一对一） |
| `alignCanvasWithScreen`（尺寸跟随屏幕 + 同步相机） | ❌ | ✅ |

**结论**：每个层级 root 挂 `RenderRoot2D` 即可，**不必给每台相机配一个 Canvas**。相机与内容的配对完全由 **node `layer` × camera `visibility`** 完成，不依赖 `Canvas.cameraComponent` —— `batcher-2d.ts:260-270` 的 `getFirstRenderCamera()` 实现就是纯 `camera.visibility & node.layer` 循环，全文不读 `cameraComponent`。官方也已把相机叠加顺序从 Canvas 手上收走：`Canvas.renderMode` 自 v3.0 起 deprecated，注明「请使用 `Camera.priority` 控制相机间的叠加」——正是本设计采用的机制。

> 📎 完整的源码级清算（Canvas 比 `RenderRoot2D` 究竟多了什么、渲染路径对 `cc.Canvas` 零依赖的证据、绘制顺序的两级机制）见 **[调研：cc Canvas vs RenderRoot2D](../../../docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md)**。

> 顺带：Canvas 类注释记「UI 的视距范围是 -999 ~ 1000」，这是 UI 相机 z 取 1000 的由来（源码 `_onResizeCamera` 里硬编码 `setWorldPosition(x, y, 1000)`）；Canvas 的 `anchorPoint` 只支持 (0.5, 0.5)。

---

## 3.3 多分辨率适配

> **源码结论（`cocos/2d/framework/canvas.ts`）：`Canvas` 组件根本不维护自己节点的尺寸。**
> `_onResizeCamera()` 全文只做两件事——设相机 `orthoHeight`、把相机挪到 Canvas 节点的世界坐标 + z=1000，**完全没碰 `this.node` 的 contentSize**。
> 「Canvas 尺寸跟随屏幕」实际是 **`Widget`** 干的：`__preload()` 里 `const widget = this.getComponent('cc.Widget'); if (widget) widget.updateAlignment();`——引擎默认建的 Canvas 节点上就挂着一个四边全 0 的 Widget。（编辑器里另有 `fitDesignResolution_EDITOR` 兜底，仅编辑期生效。）

所以适配这件事**一分为二**，两半都比预想的省：

### ① 节点尺寸跟随屏幕 —— 零代码，用引擎自带 `Widget`

每个层级 root 挂 `RenderRoot2D` + `UITransform`（`@requireComponent` 自动带）+ **`Widget`**（上下左右全 0，`alignMode = ON_WINDOW_RESIZE`）。这与引擎默认 Canvas 的做法**完全一致**，Widget 系统负责把它拉满屏幕。父节点尺寸正确了，子节点的 Widget 锚定自然工作 —— 原先担心的「Widget 取到错误尺寸」不存在。

**为什么挂在裸 `Node` 下也能拉满屏**：`widget-manager.ts:64` 的判定是
`useGlobal = target instanceof Scene || !target.getComponent(UITransform)`
—— **两个条件择一即可**。引擎默认 Canvas 命中前者（父是 Scene），我们的层级 root 命中后者（父是无 `UITransform` 的 `CCKRig`），**走同一条 `isRoot` 分支、同样对齐 `visibleRect`**。

> ⚠️ 由此得出一条硬约束：**常驻根 `CCKRig` 绝不能挂 `UITransform`**。一旦挂了，`useGlobal` 变 `false` → Widget 改为对齐 `CCKRig.contentSize`（默认 100×100）→ **全部 UI 缩成 100×100**。已落成 camera-rig 的实现约束 + 单测。

`Widget.AlignMode`：`ONCE=0`（对齐一次后自禁用）/ `ALWAYS=1`（每帧对齐）/ `ON_WINDOW_RESIZE=2`（先对齐一次，之后窗口尺寸变化时重对齐）。层级 root 用 **`ON_WINDOW_RESIZE`**——不用 `ALWAYS`，避免每帧白算。

### ② 相机 orthoHeight/position 跟随屏幕 —— kit 相机组内一个方法

这半才需要我们写，照抄 Canvas `_onResizeCamera` 的公式（含 targetTexture 分支，别省）：

```ts
// 逐台 UI 相机（ORTHO）同步；照抄 canvas.ts::_onResizeCamera
const visible = view.getVisibleSize();
cam.orthoHeight = cam.targetTexture
  ? visible.height / 2
  : screen.windowSize.height / view.getScaleY() / 2;
// ⚠️ XY 是可视矩形中心，不是世界原点（见下方「相机为什么不在 (0,0)」）
cam.node.setWorldPosition(visible.width / 2, visible.height / 2, 1000);
```

触发时机同样照抄 Canvas：

```ts
view.on('canvas-resize', this._syncCameras, this);
view.on('design-resolution-changed', this._syncCameras, this);
```

**不需要「每层一个同步组件」**：所有 UI 相机都是全屏同参数正交相机，`orthoHeight` 对它们是**同一个值**，相机组里一个方法循环设一遍即可。**禁止移动层级 root 节点**（要位移就动它的子节点），否则相机与内容错位。

#### 相机为什么不在 (0,0)（本轮实测踩到的坑）

**UI 坐标系原点在可视区左下角**，不是屏幕中心：

| 事实 | 出处 |
|---|---|
| `visibleRect` 恒为 `[0,w] × [0,h]`——引擎硬置原点为 0 | `ui/view.ts::_updateAdaptResult()`：`vb.x = 0; vb.y = 0;` |
| 拉满屏的 `Widget` 按 `visibleRect.left.x / right.x` 定边界，锚点 0.5 → 节点落 `(w/2, h/2)` | `ui/widget-manager.ts::align()` 的 `isRoot` 分支 |
| 编辑器默认建的 Canvas 也正是放在 `(w/2, h/2)`（1280×720 时是 `(640,360)`），其相机作子节点跟着偏移 | 任一 Creator 默认 2D 场景 |

所以相机留在世界 `(0,0)` 时视野是 `[-w/2,w/2] × [-h/2,h/2]`，与 UI 内容**整整错开半屏**——实测表现为界面挤到右上角、大半不可见。kit 里由纯函数 `computeCameraCenter(visibleW, visibleH)` 负责，并有 3 条回归单测钉住。

### ③ 设计分辨率与适配策略（项目级）

`view.setDesignResolutionSize(width, height, policy)`，`policy` 取 `ResolutionPolicy` 静态成员：

| policy | 行为 |
|---|---|
| `SHOW_ALL` | 完整显示设计区域，可能留黑边 |
| `NO_BORDER` | 铺满屏幕，超出部分裁掉 |
| `FIXED_WIDTH` | 锁宽，高度随屏幕比例伸缩 |
| `FIXED_HEIGHT` | 锁高，宽度随屏幕比例伸缩 |
| `EXACT_FIT` | 拉满，**会变形**（一般不用） |

**demo 定为 `1080 × 1920` + `FIXED_WIDTH`（竖屏基准）。**

#### 旋转：竖屏大厅 → 横屏游戏

⚠️ **引擎旋转时不会自己换设计分辨率。** `view.ts::_updateAdaptResult()` 收到 `screen` 的 `window-resize` 后，只是拿**原样**的 design resolution + **原** policy 重算一遍（`setDesignResolutionSize(w, h, this._resolutionPolicy)`）。所以固定 `1080×1920 + FIXED_WIDTH` 转到横屏后**仍锁宽 1080** → 可视高度缩到约 600 设计单位，UI 全挤没。

解决办法是**锁短边**——方向变了就同时换设计分辨率和 policy：

| 方向 | 设计分辨率 | policy | 含义 |
|---|---|---|---|
| 竖屏（w ≤ h） | **1080 × 1920** | `FIXED_WIDTH` | 锁宽 1080 |
| 横屏（w > h） | **1920 × 1080** | `FIXED_HEIGHT` | 锁高 1080 |

即**短边恒 1080 设计单位、永不裁切**，长边随实际屏幕比例延展（多出的空间由 Widget 锚定填充）。

已实现为 kit 的独立模块 **`resolutionModule({ shortSide: 1080, longSide: 1920 })`**：听 `screen.on('orientation-change')` + `view.on('canvas-resize')`（取先到者、按方向去重、`applying` 标志防重入），改完分辨率后引擎 emit `design-resolution-changed` → 相机组的 `syncCameras` 自动重算 `orthoHeight`，**两模块零直接耦合**。

两条连带约束：

- **UI 必须用 Widget 锚定做响应式布局**，不能硬编码坐标——两个方向的设计分辨率不同，硬编码转屏必错位。
- **kit 不负责强制旋转屏幕**。`view.setOrientation()` 按引擎注释「不会对 native 部分产生任何影响，对于 native 而言，你需要在应用设置中的设置排版」——强制方向属原生工程 / 小游戏配置。kit 只保证「方向变了就正确适配」。

### ④ 安全区（刘海屏 / 异形屏）

引擎自带 **`SafeArea`** 组件（内部用 `sys.getSafeAreaRect()` + Widget 实现），按官方注释「通常用于 **UI 交互区域的顶层节点**」。

- **不要**挂在层级 root 上（那样全屏背景/遮罩也被收进安全区，出现意外留白）。
- 应挂在**交互内容的容器节点**上（按钮排、HUD、顶部栏），全屏背景与遮罩仍铺满。
- 属业务/UI 侧选择，kit 不代劳；文档给出这条使用边界即可。

---

## 4. 决策表

| 决策 | 选择 | 理由 | 被否方案 |
|---|---|---|---|
| 相机组归属 | **kit 固化成常驻节点** | 全 app 一份、所有场景共用；场景不必各配一套，「每场景必须有清色相机」由常驻背景相机一次满足 | ① 每个场景各配一组（重复劳动 + 易配错）② 代码在场景组件里手搓（旧结构遗留） |
| 大厅是否跨场景常驻 | **不常驻**，Lobby 是可重载的主场 | 消灭「持久根 + 重载返回场景」的双份冲突 | 大厅框架整体 persist 飘进子游戏 |
| 场景 UI 挂哪 | **挂场景自己的节点**（自带 `RenderRoot2D` + 对应层） | 相机按 layer 渲染、不看层级归属；随场景销毁，不泄漏 | 挂常驻层级 root（跨场景不销毁） |
| 层级 root 用什么 | **`RenderRoot2D`** | 它才是 2D 渲染入口；相机配对靠 layer×visibility，不需要 `Canvas.cameraComponent` | Canvas-per-camera（每台相机一个 Canvas，节点更重、语义更绕） |
| 2D 背景 | **Canvas/`RenderRoot2D` + `BG` 自定义层** | 背景是 2D 图/滚动图；独立层避免被 UI 相机重复渲 | 3D 天空盒背景（demo 已裁掉 3D 模块） |
| 3D 内容盖在 2D 背景上 | **靠 priority 阶梯自动成立**，无需特殊处理 | world 相机 priority ∈ `1..99` > 背景 `0` → 后渲染 → 盖上去 | 手工调 z / 换背景实现 |
| 「不要背景」怎么表达 | **清色职责移交**，kit 封成 `claimClear`/`releaseClear` 原子方法 | 这是正当需求而非误用；但需「关背景 + 改 clearFlags」两处同改，漏一处只在真机上炸（花屏或整屏 overdraw），值得封 | ① 只叫业务自己改两个字段（易漏）② 判成"手滑"禁掉（把正当需求当错误） |
| UI 相机清屏 | `DEPTH_ONLY` | 引擎官方 UI 相机用法；让背景透上来，前景/后景可继续叠 | `SOLID_COLOR`（盖掉背景，多相机叠加失效） |
| priority 编号 | 阶梯留空档（0 / 1–99 / 100 / 200 / 300） | 项目要在背景与 UI 之间、UI 前后插相机，不改 kit 数值 | 0/1/2 紧排（插入即需重编号） |
| 「空引导场景」约定的射程 | 只约束**后续 feature/业务内容**别塞进场景 | 场景合并冲突来自被多人反复改的业务 prefab/节点；框架级基建不产生这种冲突 | 读成「场景里什么都不许有」 |

---

## 5. 引擎事实核验

均取自本机 Cocos Creator **3.8.7** 引擎声明文件
`C:\ProgramData\cocos\editors\Creator\3.8.7\resources\resources\3d\engine\bin\.declarations\cc.d.ts`：

| 事实 | 出处 |
|---|---|
| `Camera.ClearFlag` 成员：`SKYBOX` / `SOLID_COLOR` / `DEPTH_ONLY` / `DONT_CLEAR` | `_cocos_misc_camera_component__ClearFlag` |
| `DEPTH_ONLY` = 只清深度与模板、**保留颜色缓冲**，「常用于 UI 相机」 | 同上，`DEPTH_ONLY` 注释 |
| `DONT_CLEAR` = 什么都不清，「适合多 Camera 叠加渲染」 | 同上，`DONT_CLEAR` 注释 |
| `Camera.priority`：**值越小越优先渲染**（大的后渲染 → 叠在上层） | `Camera.priority` 注释 |
| **必须有一台相机 `SOLID_COLOR`，否则移动端可能闪屏** | `Canvas.renderMode` 注释 |
| `Canvas.renderMode` **自 v3.0 deprecated**，改用 `Camera.priority` 控制相机叠加 | 同上 `@deprecated` |
| `RenderRoot2D extends Component`；「2D 对象数据收集的入口节点，**所有的 2D 渲染对象需在 RenderRoot 节点下才可以被渲染**」 | `class RenderRoot2D` |
| `Canvas extends RenderRoot2D`，仅额外提供 `cameraComponent` + `alignCanvasWithScreen`（对齐视窗 / 屏幕适配） | `class Canvas` |
| Canvas 尺寸跟随屏幕拉伸，故 `anchorPoint` 只支持 (0.5, 0.5)；UI 视距范围 -999 ~ 1000 | `class Canvas` 类注释 |
| 自定义层**仅 bit 0–19**，其余引擎保留；`Layers.addLayer(name, bitNum)` / `deleteLayer` / `nameToLayer` / `makeMaskInclude` / `makeMaskExclude` | `class Layers` |

**源码级核验**（引擎源码，非声明文件；完整清算见[调研文档](../../../docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md)）：

| 事实 | 位置 |
|---|---|
| `Canvas` **从不维护自己节点的 contentSize**；尺寸交给 `Widget`（`getComponent('cc.Widget')?.updateAlignment()`） | `2d/framework/canvas.ts:173-180, 223-235` |
| `RenderRoot2D` 类体只有 `addScreen`/`removeScreen` 三个钩子 | `2d/framework/render-root-2d.ts:43-55` |
| 「谁渲染我」= 纯 `camera.visibility & node.layer`，不读 `Canvas.cameraComponent` | `2d/renderer/batcher-2d.ts:260-270` |
| 同相机内多个 `RenderRoot2D` 的绘制序 = `node.siblingIndex` | `2d/renderer/batcher-2d.ts:982-984` |
| Widget `useGlobal` 双条件（父是 Scene **或** 父无 `UITransform`）→ 对齐 `visibleRect` | `ui/widget-manager.ts:63-67, 79-85, 141-147` |
| 相机同步公式与 z=1000 硬编码 | `2d/framework/canvas.ts:223-235` |
| BGM 宿主 `CCK_Audio` 已 `addPersistRootNode` | `packages/engine/src/cc-audio.ts` `ensureHost()` |
| ticker 订阅 `director.on(EVENT_AFTER_UPDATE)`，不依赖节点 | `packages/engine/src/bootstrap.ts:24-32` |

**实测结果**（2026-07-30，Game View 预览，0 error / 0 warning）：

| 项 | 结果 |
|---|---|
| 相机 + `RenderRoot2D` 在 `addPersistRootNode` 节点上跨 `loadScene` 持续正常渲染 | ✅ Lobby → Dodge → Lobby 全程 `CCKRig` 存活并正常出图 |
| 场景自己的 `RenderRoot2D` 子树被**常驻**相机按 layer 渲染（跨「场景 ↔ 常驻」层级边界） | ✅ Lobby / Dodge 均无自带相机，内容由常驻 `uiCamera` 渲出 |
| `RenderRoot2D`（无 `alignCanvasWithScreen`）下的 `Widget` 锚定偏差 | ✅ 零偏差，与 Canvas 落点一致——**前提是相机摆在可视矩形中心**（见 §3.3 ②「相机为什么不在 (0,0)」） |
| 转屏时 `resolutionModule` 换分辨率 → 相机跟上 | ⚠️ **未实测**：Game View 的「设计分辨率」模式把画布钉在项目设计分辨率上，改编辑器窗口不会让 `screen.windowSize` 变横向；面板旋转开关是 panel 局部 UI，`Editor.Profile` 改 `preview.preview.rotate` 不触发、也无对应 `Editor.Message`。须真机转屏或浏览器预览手动改窗口比例 |
| `claimClear` 后背景消失且无花屏 | ⚠️ **未实测**：demo 里没有「故意不要背景」的全屏场景可借用 |

---

## 6. 已定决策与 Open Questions

**已定（本轮拍板）**：

| # | 问题 | 结论 |
|---|---|---|
| 1 | 屏幕适配要不要现在做 | **要做**，涉及多分辨率适配。方案见 §3.3：节点尺寸靠引擎 `Widget` 零代码；相机 `orthoHeight` 由相机组一个方法统一同步 |
| 2 | 跨场景 BGM / ticker | **都已就位、不需新常驻节点**：BGM 已有 `CCK_Audio` persist 节点；ticker 订阅 `director` 事件不依赖节点（见 §1） |
| 3 | 文档归属 | **补随包模块文档** → [`packages/engine/docs/modules/camera-rig.md`](../../../packages/engine/docs/modules/camera-rig.md)（已写）；本文档保留架构总述 + demo 落地 |
| 4 | 为什么不用 `Canvas` | 已做源码级清算 → [调研文档](../../../docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md)：Canvas 只多「绑相机做适配」「编辑期所见即所得」「已废弃的 renderMode」三件事 |

| 5 | 编辑期可见性 | **接受代价**（用户拍板）：编辑器里打开 `Lobby.scene` 看不到常驻相机，靠预览验证 |
| 6 | 设计分辨率取值与策略 | **`1080 × 1920` + `FIXED_WIDTH` 作竖屏基准**（用户拍板），运行时由 `resolutionModule` 按锁短边随方向覆盖（§3.3 ③） |

| 7 | UI 怎么选层挂载 | **已决（2026-07-31，UIManager v2）**：core 定 10 档固定 UI 层枚举，engine `cc-ui.ts` 把它映射到相机层（`back→uiBack`、`hud/ui/popup/dialog→ui`、其余 `→uiFront`），**相机层没启用就回退到 `ui` root**。故本工程保持默认 `['bg','ui']` 不变、业务照样能写 `layer:'notify'`；哪天真要拆相机，`cameraRigModule({layers:[...]})` 加一行即可。见 [[ui-manager]] 与 [[adr-0008]] |

---

## 7. 实现清单（已全部落地）

改造前：`Boot.scene` 一肩三挑（引导 + 大厅 + 返回目标），相机/Canvas/大厅 UI 全在 `assets/lobby/LobbyHost.ts` 的 `buildPersistRoot()` 里代码建，并用 `uiCamera.node.active` 开关让位子游戏相机。

**kit 侧（`packages/engine`）—— 全部 ✅**

1. 新增相机组能力：建常驻根 → Background(`SOLID_COLOR`, prio 0, layer `BG`) + UI(`DEPTH_ONLY`, prio 200, layer `UI_2D`) + 各层级 root(`RenderRoot2D`)，导出 `CAMERA_PRIORITY` 常量与层名常量。
2. 清色职责移交的一对原子方法（守 §2 不变式，业务不手动碰 `clearFlags` 与背景相机开关）：

   ```ts
   /** 把清色职责交给 cam：cam 设 SOLID_COLOR + 关掉背景相机。用于「故意不要背景」的全屏场景。 */
   claimClear(cam: Camera): void;
   /** 收回：借用方恢复 DEPTH_ONLY + 重新开启背景相机。 */
   releaseClear(): void;
   ```

   内部只需记住 `_clearOwner`，两个方法对称。约 8 行，换掉一类「预览正常、真机花屏」的坑。
3. 层级 root 配置：`UITransform` + `RenderRoot2D` + `Widget`（四边 0、`ON_WINDOW_RESIZE`）；**常驻根 `CCKRig` 不得挂 `UITransform`**（§3.3 ①的硬约束）。
4. `syncCameras()`：照抄 `canvas.ts::_onResizeCamera` 公式（含 `targetTexture` 分支），挂 `view.on('canvas-resize' | 'design-resolution-changed')`。
5. 单测：**纯决策逻辑抽成零 cc 的 `src/render-policy.ts`**（连测试都不 import cc，绕开 ADR-0002 决策 3 对 mock 的限制），`render-policy.test.ts` **20 条全绿**；cc 薄壳靠 `tsc -b` 真类型 + demo 预览验证。清单见 [camera-rig 文档](../../../packages/engine/docs/modules/camera-rig.md)。
6. 补随包模块文档：[`packages/engine/docs/modules/camera-rig.md`](../../../packages/engine/docs/modules/camera-rig.md)。
6b. 额外：独立的 **`resolutionModule`**（`src/resolution.ts`）落地锁短边转屏适配；**`computeCameraCenter`** 修相机 XY 参照系（实测发现，见 §3.3 ②）。

**demo 侧 —— 全部 ✅**

7. Project Settings → Layers 加 `BG`(bit 0)。`UI_BACK`/`UI_FRONT` 按 YAGNI **未占位**（priority 与 bit 已在 kit 里留号，要用时再注册）。落 `settings/v2/packages/project.json` 的 `layer` 字段，随仓库提交。
8. 设计分辨率 `1080 × 1920` + `fitWidth`（= `FIXED_WIDTH`），落同一个 `project.json` 的 `general.designResolution`；运行时由 `resolutionModule` 按方向覆盖。
9. `Boot.scene` 收缩为纯引导：新增 `assets/scenes/Bootstrap.ts`，`bootCoreKit({ modules: [resolutionModule(), cameraRigModule(), …, appModule(APP_CONFIG, {steps})] })` → `app.launch()`。Boot 场景只剩一个挂它的空节点。（进大厅这一下后来收进了 App 启动序列的 `lobby` 步，由 `APP_CONFIG.lobby.enter` 给出，不再是 Bootstrap 里的一行 `loadScene`。）
10. 新建 `Lobby.scene`：单节点 `LobbyRoot`（层 `UI_2D` + `UITransform` + `RenderRoot2D` + 四边 0 的 `Widget` + `LobbyHost`），无相机。（后随大厅整体降为 `lobby` bundle，现落在 `assets/modules/lobby/Lobby.scene`，见 [[adr-0009]]。）
11. `LobbyHost` 重写：删掉 `buildPersistRoot()`（相机 / Canvas / persist 根全部消失），大厅 UI 改建在**场景**的 `LobbyRoot` 下；跨场景只保留 `SceneFlow` / `backSub` / `pendingGame` 三样状态。
12. 返回路径 `returnedFromGame()`：`loadScene('Boot')` → **`loadScene('Lobby', { bundle: 'lobby' })`**；`uiCamera.active` 开关与 `showLobby()` 一并删除。
13. `modules/mini-dodge/Dodge.scene`：删掉自带 `Camera` 与 `Canvas`，改为单节点 `DodgeRoot`（`UI_2D` + `RenderRoot2D` + `Widget` + `DodgeGame`）。
14. `cc-ui.ts`（`IUIView`）root 解析优先 `getRootContainer().tryResolve(CAMERA_RIG)?.layerRoot('ui')`，保留场景 Canvas 兜底。
15. 构建场景列表：`builder.json` 为空 = **默认收录 `assets/` 下全部场景**，无需登记。⚠️ 预览起始场景实测取**当前在编辑器里打开的场景**：开着 `Lobby.scene` 点播放会**跳过 Boot**（kit 未初始化 → 无相机、画面全黑），验证启动流程前先打开 `Boot.scene`。`LobbyHost` 已对这种情况打一条 `console.error` 指路。
16. 预览实测：见 §5 表（3 项通过、2 项待真机）。

### ⚠️ 开发期踩坑：改了 `@cck/engine` 的 dist，Creator 不会自动重打包

`apps/demo` 经 `node_modules/@cck/engine` → `packages/engine/dist` 消费 kit（ADR-0004）。Creator 的 packer-driver **只监视 `assets/`，不监视 `node_modules/`**，所以 `pnpm build` 出新 dist 后预览仍跑旧代码（本轮为此白查了一轮"修复没生效"）。

正确做法：**切一次 browser 预览**（`run_project_preview({mode:'browser'})`）——它走预览服务器、会强制重打包，之后再切回 Game View。

**不要**手删 `apps/demo/temp/programming/packer-driver/targets`：Creator 运行中删它会让编辑器的模块注册表指向不存在的 chunk，报 `宿主无法解析代码块`，只能重启 Creator 收场。

### ⚠️ Game View 的 stop→play 不重载 JS 上下文

模块级状态（含挂在 `globalThis` 上的 DI 根容器）会活过一次 stop→play，二次 `bootCoreKit` 直接抛 `already booted`。`Bootstrap` 用 cc 的**编译期常量** `EDITOR`（`import { EDITOR } from 'cc/env'`）圈了一段 shutdown-重启守卫兜住；构建时该常量内联为 `false`，整段被剔除，不进包体。

选 `EDITOR` 而不是 `PREVIEW` 有依据——预览引擎包里 `internal:constants` 是这么定的：

```js
EDITOR = tryDefineGlobal('CC_EDITOR', defined('Editor') && defined('process') && 'electron' in process.versions)
PREVIEW = tryDefineGlobal('CC_PREVIEW', !EDITOR)                 // ← Game View 里它是 false
EDITOR_NOT_IN_PREVIEW = EDITOR && !tryDefineGlobal('isPreviewProcess', false)
```

`EDITOR` 的语义是「跑在编辑器进程内（含 Game View）」，正是 JS 上下文会存活的唯一环境；浏览器预览刷新页面、真机进程全新，都不需要这段。实测（2026-07-30，Game View stop→play）：`[CCK-BOOT] 检测到上一轮 kit（Game View 重播不重载 JS）→ shutdown 后重启` 命中，随后正常 boot，无 `already booted`。

同一现象的另一面：**改了 `assets/` 下的脚本后，stop→play 不会拉到新 chunk**。packer-driver 确实会重编（`temp/programming/packer-driver/targets/preview/chunks/` 里已是新代码），但运行中的 webview 还拿着旧 import map。让它生效要**重载 webview**——切一次场景（`open_scene`）即可，日志出现 `预览环境初始化完毕` + `Cocos Creator v3.8.7` 才算新上下文。
