---
状态: 已定稿待实现        # 草案 → 评审中 → 已定稿 → 已实施
类型: 改造提案（过程文档，一次性）——实施完成后把结论并入 `packages/core/docs/modules/ui-manager.md`，本文标「已实施」封存
摘要: UIManager v1 → v2 的改造提案：10 档固定层枚举（修层序由打开顺序决定的 bug）、UI 注册表 + 变体解析（换皮 / 横竖屏换 view）、CCKUIView 界面契约（args/state/生命周期）、变体切换按需重建、demo 接入并删自登记。
何时读: 实施 v2 时；或想知道「为什么从 v1 改成现在这样」时。日常查 UIManager 当前功能请读模块文档，不要读本文。
日期: 2026-07-31
依赖: docs/research/2026-07-31-ui-layer-management-survey.md（横评，对标 oops-framework / TEngine / godot-core-kit / 社区单场景）、packages/core/docs/modules/ui-manager.md（现状）、packages/engine/docs/modules/camera-rig.md
---

# UIManager v2 改造提案

## 为什么要改（三条实证，不是审美）

1. **样板工程绕开了它**：`getUIManager()` 只出现在 `apps/demo/assets/test/DemoBoot.ts` 探针里。真实业务路径（大厅面板）自己 `new Node` + 自己管 `moduleLayer` + 自己 mount/unmount（`LobbyHost.ts:115-153`）——框架的样板宁可重造一遍也没用自己的 UIManager。
2. **层序由打开顺序决定（真 bug）**：`cc-ui.ts:42-50` 懒建层容器，`layers` Map 插入序 = 首次 open 序 = addChild 序 = z 序。先开 toast 再开 popup → popup 盖住 toast。对标四家全是「启动时按声明顺序建全」。
3. **`open()` 的选项把「怎么开」留在每个调用点**：shop 在 3 处打开就要写 3 遍 `{layer, prefab, bundle}`，换皮改 3 处。oops 用 `GameUIConfig`、TEngine 用 `[Window]` attribute 把这些收进注册表，v1 没有。

## 变更总览（6 处）

| # | 变更 | 落点 | 修掉 |
|---|---|---|---|
| 1 | 层名 `string` → 10 档固定枚举 | core | 层序不稳定（推翻 v1 决策 #7）|
| 2 | UI 注册表 + 变体解析 | core | 调用点重复配置；换皮/转屏换 view 无处安放 |
| 3 | 变体切换按需重建 + 状态保持 | core（判定）+ engine（IO）| 转屏后界面不换布局 |
| 4 | `CCKUIView` 界面契约 | engine | `args` 透传未接、无生命周期 |
| 5 | 层容器启动建全 + 映射相机层 + layer 归一 | engine | 层序 bug、`uiFront/uiBack` 不可达、prefab 层错导致整屏不可见 |
| 6 | demo 面板改走 UIManager，删自登记注册表 | apps/demo | UIManager 无真实使用者；净删一套 globalThis 桥接 |

## 目标 API（v2 精确签名）

```ts
// —— ① 层：固定枚举，自下而上，顺序即 z 序 ——
export const UI_LAYERS = [
  'back', 'hud', 'ui', 'popup', 'dialog', 'guide', 'loading', 'system', 'notify', 'top',
] as const;
export type UILayer = (typeof UI_LAYERS)[number];
export const DEFAULT_UI_LAYER: UILayer = 'ui';        // 名字沿用 v1 → 现有调用零迁移

// —— ② 注册表 + 变体 ——
export type Orientation = 'portrait' | 'landscape';   // 由 engine/render-policy 上提到 core
export interface UIVariant { readonly orientation: Orientation; readonly skin: string; }

export interface UIDef {
  readonly layer: UILayer;
  readonly bundle?: string | ((v: UIVariant) => string);   // 函数 = 整包换皮（Unity AB Variant 的手工等价）
  readonly prefab:  string | ((v: UIVariant) => string);   // 函数 = 换 view（横竖屏两套布局）
}
export function registerUI(uiId: string, def: UIDef): void;
export function getUIDef(uiId: string): UIDef | undefined;

/** 纯函数：把 def 按变体解析成实际资源坐标。**按需重建判定的唯一依据**。 */
export function resolveUIDef(def: UIDef, v: UIVariant): { bundle?: string; prefab: string };

export function getUIVariant(): UIVariant;
/** 改变体 → 遍历打开中的界面，**只重建解析结果真的变了的**。 */
export function setUIVariant(patch: Partial<UIVariant>): Promise<void>;

// —— ③ 消费接口（open 只吃 uiId + args，其余全来自注册表）——
export interface UIManager {
  open(uiId: string, args?: unknown): Promise<boolean>;   // 未注册 → warn + false
  close(uiId: string): boolean;
  isOpen(uiId: string): boolean;
  closeLayer(layer: UILayer): void;
  closeAll(): void;
  list(): string[];
  layerOf(uiId: string): UILayer | undefined;
}

// —— ④ 渲染接缝（4 个原子操作，仍然很薄）——
export interface UIViewSpec {
  uiId: string; prefab: string; bundle?: string; layer: UILayer;
  args?: unknown;
  state?: unknown;                                        // 变体重建时回灌的界面自存状态
}
export interface IUIView {
  create(spec: UIViewSpec): Promise<number>;
  destroy(handle: number): void;
  saveState(handle: number): unknown;                     // 重建前取状态，无则 undefined
  restack(layer: UILayer, handles: readonly number[]): void;  // 重建后按账本顺序复位层内 z 序
}
```

## 三种换法（同一个 resolver 表达，成本递增）

```ts
registerUI('shop', { layer: 'ui', bundle: 'shop', prefab: 'Shop' });                       // ① 不换
registerUI('shop', { layer: 'ui', bundle: 'shop',
                     prefab: v => v.orientation === 'landscape' ? 'Shop_land' : 'Shop' }); // ② 换 view
registerUI('shop', { layer: 'ui', prefab: 'Shop',
                     bundle: v => v.skin === 'newyear' ? 'shop-newyear' : 'shop' });       // ③ 整包换皮
```

③ 的价值：Cocos 3.x **没有 Prefab Variant、也没有 AB Variant**（见 2026-07-31 横评），同名 prefab 放不同 bundle 是唯一干净的整包换皮路径，美术能独立出包、主包零改。

## 层 → 相机层映射（含回退，这是关键设计）

| UI 层 | 相机层 | 承载 |
|---|---|---|
| `back` | `uiBack` | 背景 UI、场景装饰（夹在世界与主 UI 之间）|
| `hud` | `ui` | 常驻 HUD、底部导航栏（会被主界面盖住）|
| `ui` | `ui` | **主界面（默认层）** |
| `popup` | `ui` | 非模态弹窗，可多开，非窗口区可透点 |
| `dialog` | `ui` | 模态窗，不可透点 |
| `guide` | `uiFront` | 新手引导——必须盖住被引导的 popup/dialog |
| `loading` | `uiFront` | 全屏加载 / 转场遮罩——转场时连引导一起遮 |
| `system` | `uiFront` | 断线重连 / 强更 / 公告——盖过一切业务，含 loading |
| `notify` | `uiFront` | 飘字 toast——不阻断，所以压在阻断类之上 |
| `top` | `uiFront` | 调试面板 / FPS / 开发期覆盖 |

**回退**：`cameraRigModule` 默认只建 `['bg','ui']`，此时 `back` 与后 5 档全落回 `ui` root——**层序仍由建全顺序保证**。项目要真拆相机就在 `cameraRigModule({ layers: ['bg','uiBack','ui','uiFront'] })` 加一行，业务零改。两级机制互为兜底。

engine 侧需给 `CameraRig` 补两个一行方法：`hasLayer(l): boolean`、`layerMask(l): number`（后者供 layer 归一用，masks Map 已有）。

## 界面契约 `CCKUIView`（engine，可选组件）

```ts
@ccclass('CCKUIView')
export class CCKUIView extends Component {
  uiId = '';                                            // UIManager 注入
  onShow(_args: unknown, _state?: unknown): void | Promise<void> {}
  onHide(): void {}
  saveState?(): unknown;                                // 挂了才在重建前被调
}
```

- **可选**：prefab 根没挂就跳过（`getComponent(CCKUIView)?.onShow(...)`），对齐 godot-core-kit `KitUiScreen.of()` 风格，不学 TEngine 的强制基类。
- **`onShow` 可 async**：`open()` 等它——完成即「界面真的可用」。这是必需的：`ShopModule` 要先 `await scope.i18n()` 才能填文本，同步 `onShow` 这条路会断。
- **`state` 对齐 Android `onSaveInstanceState`**：框架搬不动滚动位置/页签/输入，只能让界面自己吐/吃。不挂 `saveState` 的界面 = 重建即重置，绝大多数够用。
- 出/退场动画仍不做，`close()` 保持同步 `boolean`。

## 变体切换的重建流程（core 侧纯逻辑，可单测）

```
setUIVariant(patch):
  next = {...current, ...patch};  if 无变化 → return
  prev = current; current = next
  for entry of 打开中的界面（账本顺序）:
     if resolveUIDef(def, prev) 与 resolveUIDef(def, next) 的 (bundle, prefab) 全等 → skip   ← 按需重建
     state = view.saveState(entry.view)
     view.destroy(entry.view)
     entry.view = await view.create({ …, state })
  对受影响的每一层 view.restack(layer, 该层 handles 按账本顺序)
```

**按需重建是这个设计的支点**：普通界面的 resolver 返回同一 prefab → 转屏零成本；只有登记了变体的才走销毁重建。业务不需要标记哪些界面要换——resolver 的返回值自己说明了。`orientation` 由 engine `resolutionModule` 在已有的 `onOrientationChange` 回调里自动灌入（`Bootstrap.ts:55` 现成口子），业务零感知；`skin` 由业务自己调。

`restack` 存在的理由：同层开着多个界面而只有部分重建时，重建的那个会 addChild 到末尾 → 层内相对次序错乱。engine 侧 3 行，防的是难查的偶发顺序 bug。

## 决策（新增 / 推翻）

| # | 维度 | 选定 | 理由 |
|---|---|---|---|
| 7' | 层名 | **10 档固定枚举**（**推翻 v1 #7「任意层名」**）| 懒建顺序 = z 序是真 bug；层是一次性定死的东西，事后插档会改变所有既有界面的相对次序，故一次给全（此处 YAGNI 不适用）|
| 9 | 「怎么开」放哪 | **注册表 `UIDef`**，`open` 只吃 uiId + args | 多处调用只写 uiId；换皮/换 view 改一处（对齐 oops `GameUIConfig` / TEngine `[Window]`）|
| 10 | 变体表达 | **resolver 函数**，非穷举表 | orientation × skin 的笛卡尔积会爆炸；函数让项目自定义维度，kit 不预设 |
| 11 | 转屏策略 | **按需重建**（解析结果变了才重建）| 让「多数界面 Widget 自适应 + 少数换 view」自然共存，业务零标记 |
| 12 | 重建状态 | **界面自吐自吃 `saveState`/`state`** | 对齐 Android 配置变更重建；框架无法自动搬迁 |
| 13 | 界面契约 | **可选组件 `CCKUIView`** | 不挂也能开（godot-core-kit 风格）；强制基类（TEngine）对 kit 太重 |
| 14 | 返回值 | **仍返 `boolean`，不回传实例** | 三家都回传，但配合界面自治后不需要；真要外部操作再改 handle + engine `uiNodeOf(handle)`，core 仍零 cc |

> 决策 7' 属破坏性且不可轻易回退（层枚举一旦定死，事后插档会改变所有既有界面的相对次序），实施时**追加一条 ADR** 固化。

## 测试计划（core 纯逻辑先行，可脱引擎）

新增用例（spy `IUIView` + fake logger）：
- **注册表**：registerUI/getUIDef；`open` 未注册 → warn + false 且不跟踪；同 id 重复注册覆盖。
- **变体解析**：`resolveUIDef` 三种形态（字符串 / prefab 函数 / bundle 函数）× portrait/landscape × skin。
- **按需重建**：解析结果不变 → **不调 destroy/create**（这条最关键）；prefab 变 → saveState→destroy→create 且 state 原样回灌；bundle 变同理；多界面时只重建该重建的。
- **顺序**：重建后 `restack` 被调、参数为该层账本顺序的 handles。
- **变体幂等**：`setUIVariant` 传入相同值 → 完全 no-op。
- **层**：`closeLayer` 只关该层；`layerOf` 返回枚举值。
- v1 既有 15 用例全部保留（open 去重、加载中 close 防泄漏等）。

engine 侧（不进 cc mock，走 apps/demo 预览验证，ADR-0002）：层容器建全顺序、相机层回退、layer 归一、`CCKUIView` 三钩子调用时机、转屏真机换 view。

## 实施步骤与影响面

1. **core**：`ui-manager.ts` / `ui-view.ts` 改造 + 新增 `ui-registry.ts`（注册表 + 变体）。`Orientation` 从 engine `render-policy.ts:38` 上提到 core，engine 改 import（render-policy 本就零 cc，不破铁律）。
2. **engine**：`cc-ui.ts` 重写挂载与层容器；新增 `cck-ui-view.ts`；`camera-rig.ts` 加 `hasLayer`/`layerMask`；`resolution.ts` 的 orientation 回调接 `setUIVariant`。
3. **apps/demo**：`module-catalog.ts` 加 `layer`+`prefab` 后启动时 `registerUI` 一遍；`ShopModule`/`ClickerModule` 改为 `CCKUIView` 子类挂在各自 prefab 根；**删** `FeatureModule.ts` 的 `REGISTRY_KEY`/`registerModule`/`getModuleFactory`/`FeatureModule`/`ModuleFactory`（prefab 里存的就是组件类，bundle 加载执行脚本时 `@ccclass` 已注册进 cc 类表——引擎原生的跨 bundle 桥接，比自建 globalThis 表更该用）；`ModuleContext` 保留，它就是 args 的形状。
4. **验证**：层序与契约走 Game View；**转屏换 view 只能手动拖窗口或真机**（Game View 转不了屏）。
5. **收尾**：把结论并入 `packages/core/docs/modules/ui-manager.md`（重写为单一时态的现状文档）、追加决策 7' 的 ADR、更新 `docs/progress.md`，本文标「已实施」。

**破坏性**：`open(uiId, opts)` → `open(uiId, args)`。现存调用只有 `DemoBoot.ts:222`（探针）+ v1 单测，影响面为零。

## 仍 YAGNI（v2 不做）

遮挡剔除（被全屏界面盖住则隐藏下层，TEngine `OnSetWindowVisible` / godot `_cover` 都有）、模态遮罩与透点策略（`popup` vs `dialog` 的层语义已留好位置）、hide 缓存、UI 级返回栈、出退场动画。
