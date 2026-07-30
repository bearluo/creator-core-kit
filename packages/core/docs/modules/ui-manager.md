---
模块: ui-manager
所在包: packages/core（UIManager 纯逻辑导航栈 + IUIView 接缝 + UIManager 接口 + 空渲染层 fake，零 cc）；cc.Node/prefab 实例化适配走 engine（后续）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: UI 管理 createUIManager——open/close/closeLayer/closeAll 以 uiId 为粒度，层内单实例 + 并发 open 去重 + 加载中 close 防泄漏，实际 prefab 实例化/销毁经 IUIView 接缝落到引擎。core 定义 UIManager（消费接口）+ IUIView（原子渲染接缝）+ 空渲染层 fake；cc.Node 不进 core。每层独立、无全局返回栈。
何时读: 需要打开/关闭界面、按层批量关、或为某工程接 UI 渲染后端时。
日期: 2026-07-27
依赖: di（UI_VIEW/UI_MANAGER token + tryResolve）、logger（告警）。IUIView 的 cc 适配走 engine（ADR-0002，后续；内部用 [[asset-manager]] 加载 prefab）。横评见 docs/research/2026-07-27-ui-and-audio-survey.md。对标 oops-framework LayerManager（LayerType + UIMap）。
---

# UIManager（层级/窗口/生命周期）设计文档

## TL;DR

`createUIManager({ view?, logger? })` 返回 `UIManager`：`open(uiId, {layer?,prefab?,args?})` 异步打开一个 UI（**层内单实例**：同 uiId 已开/加载中不重复建；**并发 open 去重**共享同一 inflight；**加载中 close** 标记取消、create 落地即销毁防节点泄漏），返回 `Promise<boolean>`（是否处于打开态）；`close(uiId)`/`closeLayer(layer)`/`closeAll()`/`isOpen`/`list`/`layerOf` 补齐。**每层独立、无全局返回栈**（Q-U2 用户定）。**core 零 cc**：定义消费接口 `UIManager` + 引擎原子渲染接缝 `IUIView`（`create(spec)→handle` / `destroy(handle)`）+ 空渲染层 fake；**cc.Node/prefab 不进 core**。engine 后续注册 cc 适配到 `UI_VIEW`，`createUIManager()` 自动拾取。

## Purpose（目标与定位）

- **做什么**：把「加载 prefab → instantiate → 挂层 → 生命周期」收敛为一个带**层归属 + 单实例 + 并发去重 + 加载竞态处理**的导航入口，让打开/关闭/按层回收的**决策逻辑可脱引擎单测**。
- **定位/取舍**：**瘦 core 半 + engine 渲染 seam**（Q-U1 用户定，候选 A）——core 持窗口账本（谁开着、归哪层、加载中还是就绪、被 close 没）与去重/竞态决策；engine `IUIView` 只做「真加载并挂一个 Node / 真销毁一个 Node」原子 IO（内部经 [[asset-manager]] 加载 prefab）。与 [[sceneflow]]（core 状态机 + engine 真切场景）同构。
- **为何每层独立、无全局返回栈**（Q-U2 用户定）：多数手游 UI 是「HUD/弹窗各归各层、各自开关」，不需要安卓返回键式全局 back-stack；更简单、够用。需要返回栈时再在 core 上叠一层（不影响现有 API）。
- **YAGNI（首版砍）**：全局返回栈/路由历史（Q-U2 砍）；隐藏缓存（close=销毁，不做 hide-cache——复用省加载留后续）；模态遮罩/暗化/点击拦截（engine 侧 prefab 自理，或后续加 `modal` 选项）；同 UI 多实例（单实例够用）；打开/关闭动画编排（engine 事）；安全区/自适应（engine `cc.Widget`）。

## Public API（TypeScript 精确签名）

```ts
// —— 渲染接缝（core 定义，engine 实现）：只做原子实例化/销毁 ——
export interface UIViewSpec { uiId: string; prefab: string; layer: string; args?: unknown; }
export interface IUIView {
  create(spec: UIViewSpec): Promise<number>;   // 加载+挂载，返 handle(>0)；失败抛错（UIManager 捕获转 false）
  destroy(handle: number): void;               // 未知 handle no-op
}
export const UI_VIEW: Token<IUIView>;          // engine 注册 cc 渲染适配
export function createMemoryUIView(): IUIView; // 空实现（只发号、不出画面），默认 + 测试

// —— 消费接口（core 实现）——
export const DEFAULT_UI_LAYER = 'ui';
export interface UIOpenOptions { layer?: string; prefab?: string; args?: unknown; }
export interface UIManager {
  open(uiId: string, opts?: UIOpenOptions): Promise<boolean>;  // 打开/复用；true=打开态、false=加载失败
  close(uiId: string): boolean;                // true=原本被跟踪
  isOpen(uiId: string): boolean;               // 含加载中
  closeLayer(layer: string): void;
  closeAll(): void;
  list(): string[];                            // 被跟踪 uiId（升序）
  layerOf(uiId: string): string | undefined;
}
export const UI_MANAGER: Token<UIManager>;
export function getUIManager(): UIManager;      // tryResolve(UI_MANAGER) ?? 进程默认
export function createUIManager(opts?: { view?: IUIView; logger?: ILogger }): UIManager;
```

## Behavior & data flow（行为与数据流）

- **账本（core）**：`Map<uiId, Entry>`，`Entry = { layer, view(=0 未就绪), inflight?: Promise<boolean>, closed }`。uiId 即单实例键，也作默认 prefab 路径。
- **open(uiId, opts)**：
  1. 已有 Entry → **加载中**（`inflight` 在）复用同一 inflight（并发去重）；**已就绪**（inflight 已清）→ 单实例 no-op 返回 `Promise.resolve(true)`。
  2. 无 Entry → 建 `Entry{view:0, closed:false}`、`inflight = view.create({uiId, prefab: prefab??uiId, layer: layer??'ui', args})`；成功且**未被 close** → 存 handle、清 inflight、返回 true；成功但**加载中已被 close**（`entry.closed`）→ `view.destroy(handle)`（销毁刚建好的节点）、返回 false；失败 → 删 Entry、告警、返回 false。
- **close(uiId)**：无 Entry→false；否则删 Entry、置 `closed=true`、若 `view>0` 则 `view.destroy(view)`、返回 true。加载中 close：此时 view=0 暂不销毁，待 create 落地在 open 的成功分支里销毁（上一条）。
- **closeLayer(layer)**：遍历账本快照 `[...open]`，对同层者 close（快照避免遍历中删表）。**closeAll**：遍历快照全 close。
- **isOpen** = `map.has`（含加载中）；**list** = keys 升序；**layerOf** = `Entry.layer`（未跟踪 undefined）。
- **默认 view 解析**：`opts.view ?? tryResolve(UI_VIEW) ?? createMemoryUIView()`。
- **与 cc 边界**：UIManager/IUIView/账本/空 fake 全在 core（零 cc）。engine 实现 `IUIView`：`create`→经 [[asset-manager]] `load(prefab, {type:'prefab'})` → `instantiate` → 挂到 `layer` 对应层容器 Node（engine 维护 layer→Node 映射 + z 序）→ 播出场动画 → 返 handle；`destroy`→播退场 → `node.destroy()` + 解引用 prefab。属**有状态引擎行为**，ADR-0002 不进 cc mock，走 apps/demo 集成验证。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | core/engine 拆分 | 纯 engine / **瘦 core 半 + engine 渲染 seam** | **瘦 core 半**（用户定 2026-07-27，候选 A） | 打开/关闭/去重/竞态决策脱 cc 可单测，贴合铁律；engine 只做 Node IO |
| 2 | 栈/返回模型 | 全局单 back-stack / **每层独立无全局返回** | **每层独立**（用户定 2026-07-27） | 多数手游够用、更简单；需要返回栈再叠 |
| 3 | 并发同 uiId open | 各自建 / **inflight 去重** | **inflight 去重** | 单实例正确、只真建一次（对齐 [[asset-manager]]）|
| 4 | 加载中 close | 忽略（泄漏）/ **标记取消、落地即销毁** | **落地即销毁** | 防 prefab 加载完成后节点泄漏（横评 B-N4）|
| 5 | 关闭策略 | 隐藏缓存 / **销毁** | **销毁**（首版） | 简单正确；复用省加载留后续（hide-cache）|
| 6 | 实例数 | 多实例 / **层内单实例** | **单实例** | uiId 即键，够用；多开留后续 |
| 7 | 层校验 | core 维护层注册表 / **接受任意层名字符串** | **任意层名** | 层容器 Node 归 engine；core 只透传，少一层耦合 |
| 8 | DI 便捷 | 仅工厂 / **UI_VIEW + UI_MANAGER token + getUIManager** | **都给** | 对齐姊妹模块 token+fallback 范式 |

## Platform considerations（全平台 / 小游戏兼容）

- core（UIManager/账本/空 fake）纯 TS，全平台无差异。
- engine `IUIView` 适配：层容器 Node、`cc.Widget` 自适应、安全区都在 engine，全平台一致；prefab 加载走 [[asset-manager]]（各平台 bundle 语义一致）。
- 跨 bundle 共享 UIManager 走全局 `UI_MANAGER` token（[[adr-0001]]）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；spy `IUIView`（`create` 可 auto-resolve / 挂起待 flush / reject，返自增 handle；`destroy` 记录调用）+ fake logger 断言告警。
- **用例清单**（已实现，15 用例）：open 经 view 创建/默认层 ui/尊重 layer+prefab/透传 args；层内单实例不重复建、并发 open 去重（create 一次）、create 失败 false 且不跟踪 + 告警；close 销毁+不再跟踪、close 未跟踪 false 无销毁、**加载中 close** create 落地即销毁不回填；closeLayer 只关该层、closeAll 全关、list 升序；DI 回退空渲染层 / getUIManager 单例 / register 覆盖 / tryResolve(UI_VIEW)。

## Open Questions（已决议 · 2026-07-27）

1. **瘦 core 半 / 每层独立无全局返回**：✅（用户定）。
2. 隐藏缓存（close=hide 复用）：首版销毁；需要时加 `open` 的 `cache?` 选项 + IUIView `setVisible`。
3. 模态遮罩：首版 prefab 自理；需要时加 `modal?` 选项 + engine 遮罩层。
4. 与 [[asset-manager]] 的耦合在 engine 侧（加载 prefab），core 层零依赖；与 [[audio-service]] 无耦合。

---

## 实现记录

- **落地文件**：`packages/core/src/ui/ui-view.ts`（`UIViewSpec` + `IUIView` + `UI_VIEW` + `createMemoryUIView`）、`ui-manager.ts`（`createUIManager` + `UIManager`/`UIOpenOptions` + `DEFAULT_UI_LAYER` + `UI_MANAGER` + `getUIManager`）、`index.ts`；core `index.ts` re-export（`export * from './ui'`）。
- **最终 API 与设计偏差**：
  1. 无偏差；API 与定稿一致。
  2. `closeLayer` 用 `for (const [id, e] of [...open])` 遍历 entries 快照（而非 `open.keys()` 再 `open.get(id)?.layer`）——避免 `?.` 的 undefined 分支恒不可达（id 来自快照、同 id 才被 close 删），换来 100% 分支覆盖。
  3. 加载中 close 的取消经 `Entry.closed` 标记：`close` 先删表 + 置 closed；create 落地在 open 成功分支检查 `entry.closed`（闭包持 entry 引用），为真则 `destroy` 刚建好的 handle、返 false，不回填账本。
- **测试结果 / 覆盖率**：`ui-manager.test.ts` **15 用例全绿**；`ui-manager.ts`、`ui-view.ts`、`index.ts` 均 **100% Stmts/Branch/Funcs/Lines**（全量 271 passed，含 [[audio-service]]）。
- **commit / PR**：待提交（与 [[audio-service]] 同批）。
- **遗留 Minors**：隐藏缓存、模态遮罩、返回栈、多实例留后续（YAGNI）。engine 侧 `IUIView` 的 cc 适配已实现（见下）。

### engine 半适配（IUIView 的 cc 渲染实现，2026-07-28）

- **落地文件**：`packages/engine/src/cc-ui.ts`——`createCcUIView(opts?)`（`IUIView` 的 cc 实现）+ `ccUIModule()`（注册 `UI_VIEW → cc 实现`）；engine `index.ts` 导出。
- **实现**：`create(spec)` 经 `IAssetLoader` 加载 `Prefab` → `instantiate` → 挂到层容器 Node → 返 handle；`destroy` 销毁节点并 `release` prefab。层容器：每个 layer 懒建一个子 Node 挂在 UI 根 Canvas 下（子节点挂载顺序即 z 序）；UI 根懒查场景内首个 `Canvas`，缺则兜底新建。窗口栈/去重/生命周期全在 core。
- **接入**：`bootCoreKit({ modules:[…, ccUIModule()] })` 后 `getUIManager()` 自动拾取 cc `UI_VIEW`。
- **ceiling（ponytail）**：`spec.args` 透传未接（待约定 UI 脚本基类/接口后在 create 后调 `onShow(args)`）；出/退场动画未做；兜底新建的 Canvas 无 Camera 可能不渲染（正式项目场景应自带 Canvas）。
- **类型策略**：官方 `@cocos/creator-types@3.8.7`（ADR-0005）。
- **验证**：四门全绿；**真机 gameView 预览已验证**两条路径——
  1. **DI 接入 + 错误路径**：`UI_VIEW registered = true`、`open(缺prefab)=false` 优雅失败不崩（走 core 加载失败回滚）。
  2. **happy path 端到端**（2026-07-29）：`resources/DemoPanel.prefab`（Node+UITransform+Label 'CCK UI OK'）经 `createUIManager({ view: createCcUIView({ root }) }).open('DemoPanel')` 真加载 → `instantiate` → 挂 `UILayer_ui` 层容器（子节点=1、Label 内容 'CCK UI OK' 还原 = 真反序列化）→ core 跟踪（tracked/isOpen）→ `close` → **下一帧**节点摘除 + `inst.isValid=false` + `asset release` 不崩。smoke 见 `apps/demo/assets/scripts/DemoBoot.ts`（🖼️ open/render + 🧹 close 回收，两条 PASS）。
  - 坑记 1（回收断言时机）：`cc.Node.destroy()` **延迟到帧末**才置 `isValid=false` 并从 `_children` 摘除——回收断言须放下一帧（`scheduleOnce(…,0)`），首版误按同步断言 → FAIL，非 UIManager bug。
  - 坑记 2（prefab 生成）：`DemoPanel.prefab` 首版用 `cce.Utils.serialize(new Prefab{data:裸Node})` 造，产物**缺 `cc.PrefabInfo`/`cc.CompPrefabInfo`**（根 `_prefab:null`、组件 `__prefab:null`）——运行时 `instantiate` 不需要它（smoke 照过），但**编辑器打开 prefab 崩** `TypeError: Cannot read properties of null (reading 'instance')`（读 `prefabInfo.instance`）。修法：手补根节点 `_prefab → cc.PrefabInfo{root,asset,fileId,instance:null,targetOverrides:null,nestedPrefabInstanceRoots:null}` + 每组件 `__prefab → cc.CompPrefabInfo{fileId}`，fileId 复用序列化器给的 `_id`、节点/组件 `_id` 清空。已按 uuid 加载验证 `hasPrefabInfo=true / instance=null(OK) / instantiate OK`，编辑器 open 不再崩。
  - 未覆盖（ponytail / YAGNI）：Canvas 兜底新建分支（smoke 用显式 root）、出/退场动画、`args` 透传。
