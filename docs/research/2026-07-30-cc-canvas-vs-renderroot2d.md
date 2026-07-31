# 调研：cc `Canvas` 到底比 `RenderRoot2D` 多了什么

> **状态**：已完成（快照，基于 Cocos Creator **3.8.7** 引擎源码）
> **摘要**：`Canvas extends RenderRoot2D`，只多了三件事——绑相机做屏幕适配、编辑器所见即所得、已废弃的 `renderMode`。**渲染判定和节点尺寸都不是 Canvas 干的**，所以层级 root 用 `RenderRoot2D` 是成立的。
> **何时读**：设计 UI 根节点结构、决定"要不要 Canvas"、排查多相机/多 root 的绘制顺序，或怀疑"没 Canvas 就渲染不出来"时。
> **依赖**：结论落地见 [`packages/engine/docs/modules/camera-rig.md`](../../packages/engine/docs/modules/camera-rig.md)、[`apps/demo/docs/scene-and-camera-architecture.md`](../../apps/demo/docs/scene-and-camera-architecture.md)

**源码根路径**（下文 `file:line` 均相对于此）：
`C:\ProgramData\cocos\editors\Creator\3.8.7\resources\resources\3d\engine\cocos\`

---

## TL;DR

| Canvas 独有的能力 | 还有效吗 | 我们怎么处理 |
|---|---|---|
| ① 绑一台相机 + 同步其 `orthoHeight`/位置到屏幕 | ✅ **唯一真正 load-bearing 的运行时能力** | 相机组内一个 `syncCameras()` 照抄其公式 |
| ② 编辑器所见即所得（节点尺寸=设计分辨率、锁 position/size/anchor） | ✅ 有效，但**只在编辑期** | 放弃（相机组常驻，业务场景本就不含相机） |
| ③ `renderMode`（OVERLAY/INTERSPERSE） | ❌ **v3.0 起 deprecated**，官方叫改用 `Camera.priority` | 直接用 `Camera.priority` 阶梯 |

而**两件大家以为 Canvas 在做、其实它没做**的事：

- ❌ **决定"谁来渲染我"** —— 是 `camera.visibility & node.layer`，与 `Canvas.cameraComponent` 无关。
- ❌ **维护自己节点的尺寸** —— 是 `Widget` 干的，Canvas 全程没碰 `contentSize`。

**结论**：`RenderRoot2D` + `Widget`(四边 0) + 自管相机 = Canvas 的运行时等价物。代价只有②的编辑期便利。

---

## 1. 继承关系与规模

```
Component
└─ RenderRoot2D     (2d/framework/render-root-2d.ts，全文 55 行，类体 11 行)
   └─ Canvas        (2d/framework/canvas.ts，249 行)
```

`canvas.ts:59` — `export class Canvas extends RenderRoot2D`。所以问题精确化为：**Canvas 在这 11 行之上加了什么？**

## 2. `RenderRoot2D` 全貌（真的只有这些）

`render-root-2d.ts:36-55`：

```ts
@ccclass('cc.RenderRoot2D')
@executionOrder(100)
@requireComponent(UITransform)      // ← 自动带 UITransform
@disallowMultiple
@executeInEditMode
export class RenderRoot2D extends Component {
    onEnable  () { batcher2D.addScreen(this); }
    onDisable () { batcher2D.removeScreen(this); }
    onDestroy () { batcher2D.removeScreen(this); }
}
```

它只做一件事：**把自己登记进 `batcher2D` 的 "screen" 列表**。`batcher-2d.ts:278-315` 的 `update()` 遍历 `_screens`，对每个 `walk(screen.node)` 收集 2D renderable 并合批。**这就是"2D 内容能被渲染"的全部前提**——与官方注释一致：「所有的 2D 渲染对象需在 RenderRoot 节点下才可以被渲染」。

## 3. Canvas 独有的三件事，逐条清算

### ① 绑相机 + 屏幕适配（唯一 load-bearing 的运行时能力）

`canvas.ts:223-235`：

```ts
protected _onResizeCamera (): void {
    if (this._cameraComponent && this._alignCanvasWithScreen) {
        if (this._cameraComponent.targetTexture) {
            this._cameraComponent.orthoHeight = visibleRect.height / 2;
        } else {
            const size = screen.windowSize;
            this._cameraComponent.orthoHeight = size.height / view.getScaleY() / 2;
        }
        this.node.getWorldPosition(_worldPos);
        this._cameraComponent.node.setWorldPosition(_worldPos.x, _worldPos.y, 1000);
    }
}
```

触发时机 `canvas.ts:198-199`（运行时）+ `canvas.ts:185, 206`（相机 targetTexture 变化）：

```ts
view.on('canvas-resize', this._thisOnCameraResized, this);
view.on('design-resolution-changed', this._thisOnCameraResized, this);
```

**这是 Canvas 真正不可替代的部分**，也是我们必须自己抄一遍的部分（照抄含 `targetTexture` 分支）。注意 z=1000 是硬编码，对应类注释「UI 的视距范围是 -999 ~ 1000」。

### ② 编辑器所见即所得（仅编辑期）

- `canvas.ts:135-171` `fitDesignResolution_EDITOR`：编辑器里把节点尺寸设成 `view.getDesignResolutionSize()`——**这就是你在编辑器里看到的那个 Canvas 设计分辨率框**。
- `canvas.ts:191-195`：编辑器里给节点打 `IsPositionLocked | IsSizeLocked | IsAnchorLocked`，防手改。

两者都只在 `EDITOR_NOT_IN_PREVIEW` 分支，**运行时完全不执行**。

### ③ `renderMode` —— 已废弃

`canvas.ts:75-84` + `237-245`，用 `1 << 30` 位翻转 priority 实现 OVERLAY/INTERSPERSE。`canvas.ts:73` 明确：

> `@deprecated since v3.0, please use [[Camera.priority]] to control overlapping between cameras.`

**官方自己把相机叠加顺序的控制权从 Canvas 交还给了 `Camera.priority`** —— 这正是我们采用的机制，不是绕路。

---

## 4. 两个关键误解澄清

### 4.1 「谁渲染我」由 layer × visibility 决定，Canvas 不参与

`batcher-2d.ts:260-270`：

```ts
public getFirstRenderCamera (node: Node): Camera | null {
    if (node.scene && node.scene.renderScene) {
        const cameras = node.scene.renderScene.cameras;
        for (let i = 0; i < cameras.length; i++) {
            const camera = cameras[i];
            if (camera.visibility & node.layer) {   // ← 纯 layer 位与
                return camera;
            }
        }
    }
    return null;
}
```

**全文没有一处读 `Canvas.cameraComponent`。** 引擎里需要"我被哪台相机渲染"的地方（`ui-transform.ts:244,253` 的坐标换算，以及 `edit-box-impl.ts:344` / `video-player-impl.ts:131` / `web-view-impl.ts:95` 这些要定位 DOM 覆盖层的组件）全部走这个函数。

进一步地，全引擎范围内 grep `cc.Canvas` 的依赖，只剩：

- `physics-2d/box2d-wasm/physics-world.ts:125` —— 调试绘制自建的 Canvas，与业务无关；
- `widget.ts:57` —— **一行被注释掉的** `// const canvasComp = parent.getComponentInChildren(Canvas);`，说明 Widget 曾依赖 Canvas、后来已解耦；
- `ui/view.ts:666` 的 `locCanvas` —— 是 `game.canvas`（HTML `<canvas>` 元素），与 `cc.Canvas` 无关。

**即：渲染路径对 `cc.Canvas` 零依赖。**

### 4.2 Canvas 不维护自己节点的尺寸，是 `Widget` 干的

`_onResizeCamera()` 全文只改相机，**从未触碰 `this.node` 的 `contentSize`**。真正拉伸节点的是 `canvas.ts:173-180`：

```ts
public __preload (): void {
    const widget = this.getComponent('cc.Widget') as unknown as Widget;
    if (widget) {
        widget.updateAlignment();          // ← 尺寸交给 Widget
    } else if (EDITOR_NOT_IN_PREVIEW) {
        this.fitDesignResolution_EDITOR!();
    }
    ...
```

引擎默认建的 Canvas 节点上就挂着一个四边全 0 的 `Widget`。

**而 Widget 怎么知道"屏幕多大"？** `widget-manager.ts:63-67`：

```ts
const targetSize = getReadonlyNodeSize(target);
const useGlobal  = target instanceof Scene || !target.getComponent(UITransform);
const isRoot     = useGlobal;
```

以及 `widget-manager.ts:79-85, 141-147`：

```ts
if (isRoot) { localLeft = visibleRect.left.x;   localRight = visibleRect.right.x; }
if (isRoot) { localBottom = visibleRect.bottom.y; localTop = visibleRect.top.y;  }
```

**`useGlobal` 有两个触发条件**——父节点是 `Scene`，**或者父节点没有 `UITransform`**。二者都走 `isRoot` 分支、直接对齐 `visibleRect`（全屏可视区）。

于是：

| 情形 | 父节点 | `useGlobal` | 拉伸目标 |
|---|---|---|---|
| 引擎默认 Canvas | Scene | ✅（`instanceof Scene`） | `visibleRect` = 全屏 |
| **我们的层级 root** | 裸 `Node`（`CCKRig`，无 `UITransform`） | ✅（`!getComponent(UITransform)`） | `visibleRect` = 全屏 |

**两者走的是同一条代码分支，效果等价。** 拉伸计算见 `widget-manager.ts:105-110`（`isStretchWidth` → `width = localRight - localLeft`）；`targetSize` 在 `isRoot` 分支下只与 `widget.left/right` 相乘，而四边全 0 时恒为 0，所以 `getReadonlyNodeSize` 对裸 Node 返回 `Size.ZERO`（`widget.ts:40-70`）无害。

---

## 5. 绘制顺序是两级机制

1. **跨相机**：`Camera.priority`，值越小越先渲染（大的叠在上层）。
2. **同相机内、多个 `RenderRoot2D`**：`batcher-2d.ts:982-984`

   ```ts
   private _screenSort (a: RenderRoot2D, b: RenderRoot2D): number {
       return a.node.siblingIndex - b.node.siblingIndex;
   }
   ```

   即按**节点兄弟序**。`update()` 按这个顺序逐 screen 合批并 `scene.addBatch`。
3. **同一 root 内**：`walk()` 的层级遍历序（另有 `sorting-2d` 可选模块参与）。

对我们的设计：每层恰好一个 root + 一台专属相机 → 第 2 级不参与竞争；但**若同层放多个 root，顺序取决于 siblingIndex**，需知道这条。

---

## 6. 什么时候仍该用 Canvas

- 需要**编辑器里可视化摆 UI**、依赖那个设计分辨率框做布局参照时（②的价值）——即传统「场景里摆 Canvas + prefab 拖控件」的工作流。
- 单相机单 root 的简单项目：Canvas 一个组件就把"相机 + 适配"全包了，没必要自己写 `syncCameras`。

本项目不适用，因为相机组常驻、业务场景不含相机，②本就拿不到。

## 7. 由此得出的硬约束

> ⚠️ **常驻根 `CCKRig` 绝对不能挂 `UITransform`。**

一旦它有了 `UITransform`，`widget-manager.ts:64` 的 `useGlobal` 变 `false` → 层级 root 的 Widget 改为对齐 `CCKRig.contentSize`（`UITransform` 默认 100×100，见 `ui-transform.ts` 的 `_contentSize = new Size(100, 100)`）→ **全部 UI 缩成 100×100**。

这条要落成 camera-rig 的实现约束 + 一条单测。

## 8. 证据索引

| 事实 | 位置 |
|---|---|
| `Canvas extends RenderRoot2D` | `2d/framework/canvas.ts:59` |
| `RenderRoot2D` 类体全部（addScreen/removeScreen） | `2d/framework/render-root-2d.ts:43-55` |
| `@requireComponent(UITransform)` | `2d/framework/render-root-2d.ts:40` |
| `_onResizeCamera` 只改相机（orthoHeight + 位置 z=1000） | `2d/framework/canvas.ts:223-235` |
| 尺寸交给 Widget（`getComponent('cc.Widget')`） | `2d/framework/canvas.ts:173-180` |
| 编辑期 `fitDesignResolution_EDITOR` / 锁三标志 | `2d/framework/canvas.ts:135-171, 191-195` |
| `renderMode` deprecated since v3.0 → 用 `Camera.priority` | `2d/framework/canvas.ts:73` |
| resize 事件名 `canvas-resize` / `design-resolution-changed` | `2d/framework/canvas.ts:198-199` |
| 「必须有一台相机 SOLID_COLOR，否则移动端闪屏」 | `2d/framework/canvas.ts:65-71` |
| `getFirstRenderCamera` = 纯 `camera.visibility & node.layer` | `2d/renderer/batcher-2d.ts:260-270` |
| batcher 遍历 `_screens` → `walk` → `addBatch` | `2d/renderer/batcher-2d.ts:278-315` |
| screens 按 `siblingIndex` 排序 | `2d/renderer/batcher-2d.ts:982-984` |
| Widget `useGlobal` 双条件（Scene 或无 UITransform） | `ui/widget-manager.ts:63-67` |
| `isRoot` → 对齐 `visibleRect` | `ui/widget-manager.ts:79-85, 141-147` |
| `isStretchWidth/Height` 拉伸算法 | `ui/widget-manager.ts:105-110, 168-173` |
| `getReadonlyNodeSize`（裸 Node → `Size.ZERO`） | `ui/widget.ts:40-70` |
| Widget 对 Canvas 的依赖已注释掉 | `ui/widget.ts:57` |
| `AlignMode`：`ONCE=0 / ALWAYS=1 / ON_WINDOW_RESIZE=2` | `cc.d.ts` `_cocos_ui_widget__AlignMode` |
