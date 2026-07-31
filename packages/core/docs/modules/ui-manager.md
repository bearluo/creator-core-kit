---
模块: ui-manager
所在包: packages/core（注册表 + 变体解析 + 窗口账本 + IUIView 接缝，零 cc）；prefab 实例化 / 层容器 / 界面契约走 packages/engine
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: UI 管理——`registerUI(uiId, def)` 把「怎么开」（层 / bundle / prefab，可按变体解析）收进注册表，`open(uiId, args)` 只给 id 和参数；10 档固定层枚举定 z 序；横竖屏 / 换皮切变体时**只重建解析结果真的变了的**界面，界面经 `CCKUIView` 契约拿 args 与自存 state。
何时读: 需要打开/关闭界面、登记一个新界面、做换皮或横竖屏换 view、或为某工程接 UI 渲染后端时。
日期: 2026-07-31
依赖: di（UI_VIEW/UI_MANAGER token + tryResolve）、logger（告警）。IUIView 的 cc 适配走 engine（ADR-0002；内部用 [[asset-manager]] 加载 prefab，挂载点来自 [[camera-rig]]）。层枚举一次定死见 [[adr-0008]]。横评见 docs/research/2026-07-31-ui-layer-management-survey.md。
---

# UIManager（层级 / 窗口 / 变体）

## TL;DR

两步：**先登记，后打开**。

```ts
registerUI('shop', { layer: 'ui', bundle: 'shop', prefab: 'Shop' });
await getUIManager().open('shop', { from: 'lobby' });   // 多处调用都只写这一行
```

`open` 是**层内单实例**（同 uiId 已开/加载中不重复建）、**并发去重**（共享 inflight）、**加载中 close 防泄漏**（create 落地即销毁）。层是 10 档固定枚举，**数组顺序即 z 序**，engine 启动时一次建全。要换皮或横竖屏换布局，把 `bundle`/`prefab` 写成函数（收 `UIVariant`）；`setUIVariant({orientation})` 时只有**解析结果真的变了**的界面才销毁重建，其余零成本。core 零 cc：`IUIView` 是唯一渲染接缝（create/destroy/saveState/restack）。

## Purpose（目标与定位）

- **做什么**：把「一个界面从哪来、归哪层、打开时传什么、变体切换时怎么办」收敛成注册表 + 一个 open 入口，让**决策逻辑可脱引擎单测**。
- **为什么要注册表**：`shop` 被大厅、活动、推送三处打开，「怎么开」若写在调用点就要改三处；换皮更是全项目扫一遍。收进注册表后调用点只知道 uiId（对齐 oops-framework `GameUIConfig`、TEngine `[Window]` attribute）。
- **定位/取舍**：**瘦 core 半 + engine 渲染 seam**——core 持窗口账本与去重/竞态/重建决策；engine `IUIView` 只做 4 个原子 IO。与 [[sceneflow]]（core 状态机 + engine 真切场景）同构。
- **每层独立、无全局返回栈**：多数手游 UI 是「HUD/弹窗各归各层、各自开关」，不需要安卓返回键式 back-stack；需要时再在 core 上叠一层。
- **YAGNI（不做）**：遮挡剔除（被全屏界面盖住则隐藏下层）、模态遮罩与透点策略（`popup`/`dialog` 的层语义已留好位置）、hide 缓存（close=销毁）、UI 级返回栈、出退场动画、同 uiId 多实例。

## Public API（TypeScript 精确签名）

```ts
// —— ① 层：固定枚举，自下而上，顺序即 z 序 ——
export const UI_LAYERS = [
  'back', 'hud', 'ui', 'popup', 'dialog', 'guide', 'loading', 'system', 'notify', 'top',
] as const;
export type UILayer = (typeof UI_LAYERS)[number];
export const DEFAULT_UI_LAYER: UILayer = 'ui';

// —— ② 注册表 + 变体 ——
export type Orientation = 'portrait' | 'landscape';
export interface UIVariant { readonly orientation: Orientation; readonly skin: string; }
export const DEFAULT_UI_VARIANT: UIVariant;            // { portrait, 'default' }

export interface UIDef {
  readonly layer?: UILayer;                            // 默认 'ui'
  readonly bundle?: string | ((v: UIVariant) => string);  // 函数 = 整包换皮
  readonly prefab:  string | ((v: UIVariant) => string);  // 函数 = 换 view
}
export function registerUI(uiId: string, def: UIDef): void;   // 同 id 后者覆盖
export function getUIDef(uiId: string): UIDef | undefined;
export function listUIDefs(): string[];                       // 升序
export function clearUIRegistry(): void;                      // 单测隔离用
export function layerOfDef(def: UIDef): UILayer;

/** 纯函数：def × 变体 → 实际资源坐标。**按需重建判定的唯一依据**。 */
export function resolveUIDef(def: UIDef, v: UIVariant): { bundle?: string; prefab: string };

// —— ③ 消费接口 ——
export interface UIManager {
  open(uiId: string, args?: unknown): Promise<boolean>;  // 未注册 → warn + false
  close(uiId: string): boolean;
  isOpen(uiId: string): boolean;                         // 含加载中
  closeLayer(layer: UILayer): void;
  /** 关闭所有「按**当前变体**解析后 bundle === 该名」的界面（含加载中的）。 */
  closeByBundle(bundle: string): void;
  closeAll(): void;
  list(): string[];                                      // 升序
  layerOf(uiId: string): UILayer | undefined;
  variant(): UIVariant;
  setVariant(patch: Partial<UIVariant>): Promise<void>;  // 同值 = 完全 no-op
}
export const UI_MANAGER: Token<UIManager>;
export function getUIManager(): UIManager;               // tryResolve(UI_MANAGER) ?? 进程默认
export function createUIManager(opts?: {
  view?: IUIView; logger?: ILogger; variant?: UIVariant;
}): UIManager;
export function getUIVariant(): UIVariant;               // = getUIManager().variant()
export function setUIVariant(patch: Partial<UIVariant>): Promise<void>;

// —— ④ 渲染接缝（core 定义，engine 实现）——
export interface UIViewSpec {
  uiId: string; prefab: string; bundle?: string; layer: UILayer;
  args?: unknown; state?: unknown;                       // state 仅变体重建时非空
}
export interface IUIView {
  create(spec: UIViewSpec): Promise<number>;             // 返 handle(>0)；失败抛错
  destroy(handle: number): void;                         // 未知 handle no-op
  saveState(handle: number): unknown;                    // 界面没实现则 undefined
  restack(layer: UILayer, ordered: readonly number[]): void;
}
export const UI_VIEW: Token<IUIView>;
export function createMemoryUIView(): IUIView;           // 空实现（只发号、不出画面）
```

engine 侧：

```ts
@ccclass('CCKUIView')                                    // 挂在界面 prefab 根上，**可选**
export class CCKUIView extends Component {
  uiId = '';                                             // UIManager 注入
  onShow(_args?: unknown, _state?: unknown): void | Promise<void> {}   // 可 async，open() 等它
  onHide(): void {}                                      // 同步
  saveState?(): unknown;                                 // 挂了才在重建前被调
}
export function createCcUIView(opts?: { root?: Node }): IUIView;
export function ccUIModule(): KitModule;                 // 注册 UI_VIEW → cc 实现
```

## 三种换法（同一个 resolver 表达，成本递增）

```ts
registerUI('shop', { layer: 'ui', bundle: 'shop', prefab: 'Shop' });                       // ① 不换
registerUI('shop', { layer: 'ui', bundle: 'shop',
                     prefab: v => v.orientation === 'landscape' ? 'Shop_land' : 'Shop' }); // ② 换 view
registerUI('shop', { layer: 'ui', prefab: 'Shop',
                     bundle: v => v.skin === 'newyear' ? 'shop-newyear' : 'shop' });       // ③ 整包换皮
```

③ 的由来：Cocos 3.x **没有 Prefab Variant、也没有 AB Variant**，同名 prefab 放不同 bundle 是唯一干净的整包换皮路径——美术能独立出包，主包零改。

## 层 → 相机层映射（engine）

| UI 层 | 相机层 | 承载 |
|---|---|---|
| `back` | `uiBack` | 背景 UI、场景装饰（夹在世界与主 UI 之间）|
| `hud` | `ui` | 常驻 HUD、底部导航栏（会被主界面盖住）|
| `ui` | `ui` | **主界面（默认层）** |
| `popup` | `ui` | 非模态弹窗，可多开 |
| `dialog` | `ui` | 模态窗 |
| `guide` | `uiFront` | 新手引导——必须盖住被引导的 popup/dialog |
| `loading` | `uiFront` | 全屏加载 / 转场遮罩 |
| `system` | `uiFront` | 断线重连 / 强更 / 公告——盖过一切业务，含 loading |
| `notify` | `uiFront` | 飘字 toast——不阻断，所以压在阻断类之上 |
| `top` | `uiFront` | 调试面板 / FPS / 开发期覆盖 |

**回退**：`cameraRigModule` 默认只建 `['bg','ui']`，此时 `back` 与后 5 档全落回 `ui` root —— **层序仍由「一次建全」的顺序保证**。项目要真拆相机就在 `cameraRigModule({ layers: ['bg','uiBack','ui','uiFront'] })` 加一行，业务零改。两级机制互为兜底。

## Behavior & data flow（行为与数据流）

- **账本（core）**：`Map<uiId, Entry>`，`Entry = { def, layer, args, view(=0 未就绪), inflight?, closed }`。**插入顺序 = 同层内的期望 z 序**（`restack` 的依据）。
- **open(uiId, args)**：
  1. 已有 Entry → 加载中复用 `inflight`；已就绪 → 单实例 no-op 返回 true。
  2. 查注册表，**没登记 → warn + false**（不建 Entry、不碰渲染层）。
  3. `resolveUIDef(def, 当前变体)` → `view.create({uiId, prefab, bundle, layer, args})`；成功且未被 close → 存 handle；成功但加载中已被 close → 立即 `destroy` 且不回填；失败 → 删 Entry + warn。
- **close(uiId)**：删 Entry、置 `closed`、`view>0` 则 destroy。加载中 close 时 view=0，销毁推迟到 create 落地那一刻（见上）。
- **setVariant(patch)**：同值直接 return；否则先 `await` 所有 inflight 落地，再遍历账本——`resolveUIDef(def, 旧)` 与 `resolveUIDef(def, 新)` 的 `(bundle, prefab)` 全等就**跳过**，否则 `saveState → destroy → create(state)`；最后对受影响的层按账本顺序 `restack`。
- **engine 侧 create**：`ensureLayers()`（按 `UI_LAYERS` 顺序一次建全 10 个层容器）→ `IAssetLoader.load(prefab, {bundle})` → `instantiate` → **子树 layer 归一到容器所在层** → addChild → `getComponent(CCKUIView)?.onShow(args, state)`（可 await）。`destroy` 先 `onHide()` 再 `node.destroy()` + release prefab。
- **变体的来源**：`orientation` 由 engine `resolutionModule` 在方向变化时自动灌入（`setUIVariant({orientation})`），业务零感知；`skin` 由业务自己调。

## Key design decisions（决策表）

| # | 维度 | 选定 | 理由 |
|---|---|---|---|
| 1 | core/engine 拆分 | **瘦 core 半 + engine 渲染 seam** | 打开/关闭/去重/竞态/重建决策脱 cc 可单测，贴合铁律 |
| 2 | 栈/返回模型 | **每层独立、无全局返回栈** | 多数手游够用、更简单；需要返回栈再叠 |
| 3 | 并发同 uiId open | **inflight 去重** | 单实例正确、只真建一次（对齐 [[asset-manager]]）|
| 4 | 加载中 close | **标记取消、落地即销毁** | 防 prefab 加载完成后节点泄漏 |
| 5 | 关闭策略 | **销毁**（无 hide 缓存）| 简单正确；复用省加载留后续 |
| 6 | 实例数 | **层内单实例** | uiId 即键，够用 |
| 7 | 层名 | **10 档固定枚举** | 懒建顺序 = z 序是真 bug；层是一次性定死的东西，事后插档会改变所有既有界面的相对次序，故一次给全（此处 YAGNI 不适用）。见 [[adr-0008]] |
| 8 | DI 便捷 | **UI_VIEW + UI_MANAGER token + getUIManager** | 对齐姊妹模块 token+fallback 范式 |
| 9 | 「怎么开」放哪 | **注册表 `UIDef`**，open 只吃 uiId + args | 多处调用只写 uiId；换皮/换 view 改一处 |
| 10 | 变体表达 | **resolver 函数**，非穷举表 | orientation × skin 的笛卡尔积会爆炸；函数让项目自定义维度，kit 不预设 |
| 11 | 转屏策略 | **按需重建**（解析结果变了才重建）| 让「多数界面 Widget 自适应 + 少数换 view」自然共存，业务零标记 |
| 12 | 重建状态 | **界面自吐自吃 `saveState`/`state`** | 对齐 Android `onSaveInstanceState`；框架搬不动滚动位置/页签/输入 |
| 13 | 界面契约 | **可选组件 `CCKUIView`** | 不挂也能开（godot-core-kit `KitUiScreen.of()` 风格）；强制基类（TEngine）对 kit 太重 |
| 14 | 返回值 | **`boolean`，不回传实例** | 配合界面自治后不需要；真要外部操作再加 engine `uiNodeOf(handle)`，core 仍零 cc |

## Platform considerations（全平台 / 小游戏兼容）

- core（注册表/账本/空 fake）纯 TS，全平台无差异。
- engine 适配：层容器、layer 掩码归一、`cc.Widget` 自适应都在 engine，全平台一致；prefab 加载走 [[asset-manager]]（各平台 bundle 语义一致）。
- 整包换皮依赖 bundle 分发，与热更同一套机制（换皮包可后下发）。
- 跨 bundle 共享 UIManager 与注册表走全局 `UI_MANAGER` token / 模块单例（[[adr-0001]]）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；spy `IUIView`（create 可 auto/挂起/reject，返自增 handle；destroy/saveState/restack 记录调用）+ fake logger 断言告警。
- **用例清单**（34 例，`packages/core/src/ui/__tests__/ui-manager.test.ts`）：
  - 打开（1–6、16–17）：默认层 ui、注册表决定 layer/prefab、透传 args/bundle、单实例、并发去重、create 失败、**未注册 → warn + false 且不碰渲染层**。
  - 关闭（7–12、32–34）：销毁 + 不再跟踪、未跟踪 false、**加载中 close 落地即销毁**、closeLayer 只关该层、closeAll、list 升序；**closeByBundle 只关解析后 bundle 命中的界面**、对变体 resolver 型 def 按当前变体解析、无命中时 no-op。
  - DI（13–15）：getUIManager 单例 / register 覆盖 / 回退空渲染层 / tryResolve(UI_VIEW)。
  - 注册表与解析（18–22）：重复注册覆盖、三种 resolver 形态、层枚举顺序不变式。
  - 变体（23–31）：**解析不变 → 完全不 destroy/create**（最关键一条）、prefab 变 / bundle 变都重建且 state 原样回灌、多界面只重建该重建的、restack 参数为账本顺序、同值 no-op、切完再 open 用新变体、重建失败摘登记、先等 inflight 落地。
- engine 侧（不进 cc mock，ADR-0002）走 apps/demo 预览验证：层容器建全顺序、相机层回退、layer 归一、`CCKUIView` 钩子时机、转屏真换 view。

---

## 已知行为与坑

### 落地文件

- **core**：`packages/core/src/ui/ui-registry.ts`（层枚举 + 注册表 + 变体解析）、`ui-view.ts`（`IUIView` + 空实现）、`ui-manager.ts`（账本 + 去重 + 按需重建）、`index.ts`。
- **engine**：`packages/engine/src/cc-ui.ts`（`createCcUIView` + `ccUIModule`）、`cck-ui-view.ts`（`CCKUIView` 契约）；挂载点来自 `camera-rig.ts` 的 `layerRoot/hasLayer/layerMask`；`resolution.ts` 在方向变化时调 `setUIVariant`。
- **样例**：`apps/demo/assets/modules/lobby/module-catalog.ts`（清单 → `registerCatalogUIs()`）、`modules/shop/ShopView.ts`、`modules/mini-clicker/ClickerView.ts`。

### 反直觉行为 / 坑

- **`cc.Node.destroy()` 延迟到帧末**才置 `isValid=false` 并从 `_children` 摘除 —— 断言回收必须放到下一帧（`scheduleOnce(…, 0)`），同步断言会假失败。
- **手工造/改的 prefab 必须补 `cc.PrefabInfo`/`cc.CompPrefabInfo`**：根 `_prefab:null`、组件 `__prefab:null` 的产物运行时 `instantiate` 照常工作，但**编辑器打开该 prefab** 抛 `TypeError: Cannot read properties of null (reading 'instance')`。手工往 prefab 里加脚本组件时，组件的 `__type__` 是脚本 uuid 的 **compressUuid**（前 5 位原样 + 其余每 3 个 hex → 2 个 base64 字符），且必须同时追加一条 `cc.CompPrefabInfo`。
- **加载中 close 靠 `Entry.closed` 标记**：`close` 先删表 + 置 `closed`；`create` 落地时在 `spawn` 里检查该标记（闭包持 entry 引用），为真则销毁刚建好的 handle 且不回填账本。这是防「prefab 加载完成后节点泄漏」的唯一机制，改动此处需同步看两侧。
- **`closeByBundle` 是「卸载 / 换版本某 bundle」的正确性前提，不是卫生措施**：换版本后 cc 类表被静默替换（同 uuid 后注册者胜出），旧类的存活实例即成孤儿——`getComponent(新类)` 找不到它们，晚一步就没有可靠手段找回。所以它是 [[bundle-manager]] 里 `BundleScope.dispose()` 的**第一步**。按**当前变体**解析后的 bundle 匹配（变体不同 bundle 可能不同），含加载中的界面。
- **`closeLayer` 遍历 entries 快照**（`for (const [id, e] of [...open])`）而非 `open.keys()` 再 `get(id)?.layer` —— 后者的 `?.` undefined 分支恒不可达，会挡住分支覆盖。
- **渲染后端是延迟解析的**：`createUIManager` 不在构造期 resolve `UI_VIEW`，因为 `getUIManager()` 常在 engine 注册渲染层之前就被调到，构造期解析会把它永久固化成空实现——症状是「open 返回 true 却没画面」，且**没有任何日志**。
- **层容器不能加 `UITransform`**：`widget-manager` 的 `useGlobal` 靠「父节点无 UITransform」走 isRoot 分支对齐 visibleRect（全屏）；一旦容器有了 UITransform，子界面的 Widget 会改为对齐 100×100 的默认 contentSize → 全部 UI 缩成一团。
- **挂到 `uiBack`/`uiFront` 的界面必须做 layer 归一**：prefab 在编辑器里存的多是 `UI_2D`，直接挂过去会因相机 `visibility` 不含该层而**整屏不可见**——没有日志，只表现为「白开了一个界面」。`createCcUIView` 在 addChild 前递归设整棵子树的 layer。
- **`onHide` 早于方向回调**：`resolutionModule` 先 `setUIVariant` 再调 `onOrientationChange`，而 `setVariant` 在无 inflight 时同步跑到第一个 `await`，所以日志里看到的是「界面 onHide → 方向 → xxx → 界面 onShow」。不是错乱。
- **变体切换期间新开的界面沿用旧变体**（`ponytail:`）：`setVariant` 只等进入时已存在的 inflight；在那轮 await 期间新 open 的界面这一轮不重建，下次 open 才纠正。

### 当前限制（ponytail / YAGNI）

- 出 / 退场动画未做；`close()` 与 `onHide()` 都是同步的。
- 关闭 = 销毁，无隐藏缓存 —— 高频开关的界面每次都重新加载 prefab。
- 无模态遮罩 / 点击拦截（由 prefab 自理）、无遮挡剔除、无 UI 级返回栈、同 uiId 不支持多实例。
- `open` 不回传界面实例；外部要操作界面只能靠界面自己（`CCKUIView` + 事件）。
- 未装 [[camera-rig]] 时兜底新建的 `Canvas` 无 Camera，可能不渲染 —— 正式项目应装 `cameraRigModule()`；该兜底分支无测试覆盖。
