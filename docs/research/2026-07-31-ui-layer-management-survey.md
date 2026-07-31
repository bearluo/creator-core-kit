---
状态: 草案（评审中）
摘要: 横评 oops-framework / TEngine / godot-core-kit(姊妹) / 社区单场景方案的**层级管理 + UI 管理**，对照本仓「CameraRig 相机级层 + UIManager 字符串层」的现状，给出优缺点与修补优先级。核心发现：本仓存在**两套互不相通的层**，UI 层序由 open 顺序决定（P0 隐患），且相机阶梯 uiBack/uiFront 对 UIManager 不可达。
何时读: 要动 UIManager 的 layer 语义、cc-ui.ts 的挂载点、CameraRig 层规格，或质疑「为什么不用单相机 + siblingIndex」时。
日期: 2026-07-31
依赖: docs/research/2026-07-27-ui-and-audio-survey.md（前篇，定的是 core/engine 拆分与栈模型）、packages/core/docs/modules/ui-manager.md、packages/engine/docs/modules/camera-rig.md、docs/research/2026-07-30-cc-canvas-vs-renderroot2d.md
---

# 层级管理 / UI 管理横评（对照本仓现状）

## 0. 本仓现状：**两套层，没接通**

| | 层 A · 相机级 | 层 B · UI 级 |
|---|---|---|
| 定义处 | `render-policy.ts:17-36`（`CAMERA_PRIORITY` + `CCK_LAYERS`） | `ui-manager.ts:78`（`opts.layer ?? 'ui'`，**任意字符串**） |
| 取值 | `bg`/`uiBack`/`ui`/`uiFront`（priority 0/100/200/300，各占一个 layer bit） | 业务随手写：`'ui'`、`'popup'`、`'toast'`… |
| 排序机制 | **相机 priority + layer 掩码**（`camera-rig.ts:116-133`，`cam.visibility = mask` 只渲本层） | **父节点下的 addChild 顺序**（`cc-ui.ts:42-50` 懒建 `UILayer_<name>`） |
| 归属 | engine `CameraRig`，跨场景常驻 | engine `createCcUIView`，全部挂进 `rig.layerRoot('ui')`（`cc-ui.ts:27-28` 硬编） |

**结论：层 B 的所有层都塌在层 A 的 `ui` 这一层里。** 花成本建出来的 priority 阶梯，UIManager 一格也用不上。

---

## 1. 别人怎么做（一手来源）

### 1.1 oops-framework（Cocos 3.x，社区最流行）

7 层，**构造函数里按固定顺序一次性建全**，节点顺序即层序：

```typescript
this.game = this.create_node(LayerType.Game);
this.ui     = new LayerUI(LayerType.UI);
this.popup  = new LayerPopUp(LayerType.PopUp);
this.dialog = new LayerDialog(LayerType.Dialog);
this.system = new LayerDialog(LayerType.System);
this.notify = new LayerNotify(LayerType.Notify);
this.guide  = this.create_node(LayerType.Guide);
root.addChild(this.game); root.addChild(this.ui); /* …顺序即优先级… */
```

- 层不是同质容器，而是**按行为分类**：`LayerPopUp`（多弹窗、非窗口区可透点）、`LayerDialog`（单一模态、不可透点）、`LayerNotify`（Tip 上移消失）。遮罩/透点是**层自带的能力**，不是每个界面自理。
- `open(uiId: number, uiArgs, callbacks?: UICallbacks)` / `remove(uiId)`；`UICallbacks` = `onAdded`/`onRemoved`/`onBeforeRemove`。
- UI 用**数字 id + 配置表**（`GameUIConfig.ts`：`{bundle?, layer, prefab}`），不是路径字符串。
- 单相机，无相机分层。

### 1.2 TEngine（Unity，本地 `E:\work\TEngine`）

**全局单栈 + 层号 + sortingOrder 段位**：

```csharp
public enum UILayer : int { Bottom = 0, UI = 1, Top = 2, Tips = 3, System = 4 }

private void OnSortWindowDepth(int layer) {           // UIModule.cs:480
    int depth = layer * LAYER_DEEP;                    // 层间隔一大段
    for (…) if (_uiStack[i].WindowLayer == layer) { _uiStack[i].Depth = depth; depth += WINDOW_DEEP; }
}
```

- `Depth` 落到 `_canvas.sortingOrder`（`UIWindow.cs:87-134`）——**每个窗口自带一个 Canvas**，靠 sortingOrder 排，与节点树顺序解耦。
- `Push` 按 `WindowLayer` 找插入位（`UIModule.cs:666-704`）：**打开顺序不影响跨层次序**。
- `OnSetWindowVisible()`（`:493-516`）：从栈顶往下扫，遇到第一个 `FullScreen` 窗口就把其下全部 `Visible=false` —— **遮挡剔除省 overdraw**。
- 生命周期完整：`userDatas` 传参、`OnCreate/OnRefresh/OnUpdate`、`HideTimeToClose`（隐藏 N 秒后才真销毁 = hide 缓存）。

### 1.3 godot-core-kit（同作者姊妹框架，`addons/godot-core-kit/ui/kit_ui_stack.gd`）

**LIFO 栈**，不是层：`push/pop/replace/clear/top/depth`，`opts = {hide_below, dim, own, cancellable}`。

- 被盖屏 `process_mode = DISABLED` 一刀切停用（输入 + tick 全惰性）+ 可选隐藏 → **等价于 TEngine 的遮挡剔除**，实现更省。
- 模态遮罩由栈自己插 `ColorRect`（`_mount_new`，`mouse_filter = STOP`）——不是每屏自理。
- 生命周期四信号：`entered(prev)` / `exited(next)` / `covered()` / `revealed()`。
- 返回键在 `_unhandled_input` 兜底弹栈（栈顶自己消费了就不弹）。

### 1.4 社区单场景方案（掘金 7621407427058630707）

7 个容器（MainScene/Bottom/View/Dialog/PopUp/Tip/Top），**节点树顺序**排序，`BaseAppView` 基类 + `ActionManager` 统一进出场动画。无相机分层。

### 1.5 共性归纳

| 维度 | 四家一致的做法 | 本仓 |
|---|---|---|
| 层容器创建时机 | **启动时按声明顺序一次建全** | ❌ 首次 open 时懒建 |
| 层的数量 | **固定枚举**（5~7 个） | ❌ 任意字符串，无枚举 |
| 排序依据 | 节点顺序 / sortingOrder，**与打开顺序无关** | ❌ = 打开顺序 |
| 遮罩/透点 | **层自带**（Dialog vs PopUp）或栈自插 backdrop | ❌ 界面自理（设计时明确砍） |
| 打开传参 | 都有（uiArgs / userDatas / opts） | ❌ `spec.args` 未接（`cc-ui.ts:57`） |
| 生命周期回调 | 都有（3~4 个钩子） | ❌ 无 |
| UI 基类/契约 | 都有（组件回调 / `UIWindow` / `KitUiScreen`） | ❌ 无 |
| 相机分层 | **都没有**（单相机） | ✅ 独有 |
| 逻辑可脱引擎单测 | **都不能** | ✅ 独有 |

---

## 2. 本仓的优点（别人没有的）

1. **UI 导航逻辑零 cc、可单测** —— `ui-manager.ts` 15 用例、100% 覆盖，node 里直接跑。oops 的 `LayerManager`、TEngine 的 `UIModule` 都与节点树纠缠，只能开引擎测；godot-core-kit 的 `KitUiStack` 是 `Control` 子类，同样进不了纯逻辑测试。**四家里只有本仓做到了。**
2. **相机级层是物理隔离，别人的层序是君子协定** —— 别人的层 = 同一 Canvas 下的 sibling Node，任何一句 `setSiblingIndex` / `addChild` 都能破坏层序；本仓 `cam.priority` + `cam.visibility = mask` 谁也改不了，越权连渲染都进不去。
3. **2D 背景 / 3D 世界 / UI 的干净夹层** —— `1..99` 预留给场景自带的 3D 相机（`render-policy.ts:13-16`），子游戏把世界相机 priority 落进去就自动夹在背景之上、UI 之下。四家单相机方案都做不到这个。
4. **跨场景常驻 UI 层 + 保留多场景能力** —— `addPersistRootNode(CCKRig)` 让层 root 跨场景活着，同时子游戏仍可自带场景。oops/掘金方案是**靠单场景不切换**换来的常驻（切场景就没了）；TEngine 靠 UIRoot 常驻但 UI 与场景耦合更浅。本仓这个组合是三者兼得。
5. **清色所有权状态机（`claimClear`）** —— 多相机必然产生「谁清颜色缓冲」的不变式，本仓封成原子操作 + 单测（`render-policy.ts:151`）。别人单相机没这个问题，但也就没有「全屏 3D 子游戏整台关掉背景相机」的省法。
6. **异步竞态处理最严** —— inflight 去重 + 加载中 close 落地即销毁。TEngine 遇重复直接抛异常（`Window {name} is exist.`）；oops 靠 `UIMap` 缓存，对加载中 close 无明确处理。

---

## 3. 本仓的缺点（按危害排序）

### 🔴 P0-1 层序由 open 顺序决定（真 bug，非风格问题）

`cc-ui.ts:42-50` 懒建层容器 → `layers` Map 的插入顺序 = **首次 open 的顺序** = addChild 顺序 = z 序。

```
open('tip',  {layer:'toast'})   // 先建 UILayer_toast
open('shop', {layer:'popup'})   // 后建 UILayer_popup → 挂在 toast 之后 → popup 盖住 toast
```

同一份代码，换个打开次序表现就变；测试期正常、线上偶发。四家全都靠**启动时固定顺序建全**规避。

### 🔴 P0-2 打开传参 / 生命周期钩子全缺 → UIManager 实际不可用

`cc-ui.ts:57` 明确标了 `spec.args` 透传未接。界面拿不到参数、收不到 `onShow/onHide`，业务只能绕开 UIManager 自己 instantiate —— 那这个模块就白做了。这是**比层序更卡脖子**的缺口，根因是缺 UI 脚本契约（别人分别是 `UICallbacks` / `UIWindow` / `KitUiScreen`）。

### 🟠 P1-1 相机阶梯 uiBack/uiFront 对 UIManager 不可达

`createCcUIView` 硬编 `rig.layerRoot('ui')`。全局 loading / 断线提示想压在最上层（`uiFront`）做不到。已挂在 ui-manager 设计文档的 Open Question 里，未决。

### 🟠 P1-2 instantiate 后不做 layer 归一 —— 多相机架构自带的税

cc 判定渲染 = `node.layer & camera.visibility`。本仓每台相机 `visibility = mask` **只渲本层**，所以 prefab 根若不是 `UI_2D` 就整个界面不可见（本仓已踩过，见记忆 `cocos-codeui-and-scene-authoring`）。单相机方案的 visibility 通常是全掩码，随便什么 layer 都能渲染 —— **这个坑是本仓选多相机换来的**，`cc-ui.ts:56` 却没有兜底 setLayer。

### 🟡 P2-1 无遮挡剔除（overdraw）

TEngine `OnSetWindowVisible` / godot `_cover` 都做了「被全屏窗口盖住 → 隐藏下层」。本仓 close=销毁、没有 hide 概念，全屏弹窗压着大厅时下层照画。手游端这是实打实的功耗。

### 🟡 P2-2 无模态遮罩 / 点击拦截

设计时明确砍（prefab 自理）。代价：每个模块重复实现、且容易漏掉穿透点击。别人是**层的固有属性**（`LayerDialog` vs `LayerPopUp`）或栈自插 backdrop，一次做对处处生效。

### 🟡 P2-3 无 UI 级返回栈

Q-U2 定的「每层独立、无全局返回栈」。注意**姊妹框架 godot-core-kit 是有 UI 栈的**（`KitUiStack` + `ui_cancel` 兜底），本仓 core 只有场景级 `SceneFlow`。安卓返回键 / 「返回上一屏」需求一来就得补一层。

### 🟡 P2-4 close = 销毁，无 hide 缓存

背包/商店这类高频开关每次重新加载 prefab。oops 有「保留对象」选项，TEngine 有 `HideTimeToClose`。

---

## 4. 建议（性价比排序）

| 优先级 | 动作 | 落点 | 成本 |
|---|---|---|---|
| P0 | 层名改**固定枚举**，启动时按声明顺序一次建全容器 | `cc-ui.ts` + core 的 `layer` 类型 | 小（一个常量数组 + 循环） |
| P0 | 定 UI 脚本契约（`onShow(args)/onHide()`），create 后调用 | `cc-ui.ts` + 新增 core 接口 | 中（要定接口） |
| P1 | 层名 → `CameraRigLayer` 映射，把 uiFront/uiBack 接进来 | `cc-ui.ts`（`rig.layerRoot(map[layer])`） | 小 |
| P1 | instantiate 后递归 setLayer 到该层 mask | `cc-ui.ts:56` | 小 |
| P2 | 遮挡剔除 / 模态遮罩 / hide 缓存 / UI 返回栈 | 按真需求 | 各中 |

> P0 两条不做，UIManager 就是「能编译但业务用不了」的状态；P1 两条不做，多相机架构的收益兑现不了、还留着一个高频踩坑点。P2 全部可以等。

## 5. 一句话总纲

**本仓在「层的隔离强度」和「逻辑可测性」上明显强于四家对标；弱在「层的编排纪律」和「界面契约」——前者是别人做了几十行就解决的事，后者是别人都有而本仓还空着的。** 补齐 P0/P1 四条后，本仓在这两个维度上会同时优于对标框架。
