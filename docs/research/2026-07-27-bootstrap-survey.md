---
调研: Bootstrap 启动流程 / 组合根
状态: 已定稿
摘要: 横评 godot-core-kit 门面、VContainer/Zenject、NestJS、oops-framework、cc 原生生命周期等启动/组合根方案，为 creator-core-kit 的 Bootstrap 设计定型。
何时读: 设计或修改 Bootstrap（把 DI/Logger/EventBus/ITimer 串成启动链）前。
日期: 2026-07-27
依赖: DI 容器、Logger、EventBus、ITimer（本模块把四者组装成启动链）
---

# Bootstrap 启动流程 / 组合根 —— 横向调研

> 目标：为「把 DI + Logger + EventBus + ITimer（及后续模块）串成一条确定性、幂等的启动链，core 纯编排可测、engine 供 cc 适配」找到成熟范式，明确该抄什么、该砍什么。

## 0. 术语

- **组合根（Composition Root）**（Mark Seemann）：整个应用「装配依赖」的唯一集中点，位于启动最外层。框架的 Bootstrap 就是这个点。
- **生命周期钩子（lifecycle hooks）**：install/register（注册服务）→ start（启动）→ tick（每帧驱动）→ stop/dispose（关闭）。
- **驱动（driver）**：谁来每帧调 `timer.tick(dt)`。core 不碰 `cc.director`，故驱动必然在 engine 或测试侧。

## 1. 候选方案横评

| 方案 | 组合方式 | 注册表 | 生命周期钩子 | 顺序控制 | 异步 | 关闭/重启 | 可借鉴点 |
|---|---|---|---|---|---|---|---|
| **godot-core-kit `CoreKit`**（姊妹框架） | 单门面根节点（唯一 autoload），内部 `new` 全部 15 子系统 | 门面自带 `_services` 字典 + 强类型属性 | `_init` 构造 → `_ready` 唯一接线点（`bind_*`） | `_init` 内硬编码构造序；子节点 `_ready` 先于父 | 否（GDScript 同步，PackUpdater 在 `_init` 内跑挂载） | 随 autoload 生命周期，无显式关闭 | 「确定性构造序 + 单一接线点 + 尽早挂包」的时机编码进结构 |
| **VContainer / Zenject**（Unity DI） | `LifetimeScope` + `Installer.Install(builder)` 注册；`IInitializable/ITickable/IDisposable` | DI 容器本身即注册表 | `Initialize()` → `Tick()`（每帧）→ `Dispose()` | 注册顺序 + `IInitializable` 执行序 | Zenject 有 async `IInitializable` | `Dispose` 级联 | **entry-point 三件套（Init/Tick/Dispose）** 与我们的 ITimer 驱动 + 生命周期完全同构 |
| **NestJS Module** | `@Module({providers})` + DI；模块图 | DI 容器 | `onModuleInit` → `onApplicationBootstrap` → `onModuleDestroy` | 按模块依赖图拓扑 | 全 async | `app.close()` 逆序 destroy | 多阶段钩子 + 依赖拓扑 + 逆序关闭 |
| **oops-framework**（cc 同类） | `oops` 静态门面对象，`oops.init()` 挂 audio/gui/res 等 | 门面静态属性 | 单次 init | 硬编码 | 部分 async（res） | 无 | cc 生态里的「门面 + 一次 init」现状参照（反例：静态门面跨 bundle 有 ADR-0001 隐患） |
| **cc 原生生命周期** | 入口 `Component.onLoad/start` + `director.on(EVENT_UPDATE)` | 无（靠 Component/单例） | `onLoad→start→update(dt)→onDestroy` | 场景/节点树顺序 | 回调式 | 场景切换 | **`director` 的 `EVENT_UPDATE` 就是 engine 侧驱动 ITimer 的入口** |
| **Angular `APP_INITIALIZER` / Spring `ApplicationRunner`** | DI + 启动钩子列表 | DI 容器 | 启动前跑一批 initializer（可 async） | provider 顺序 | 是 | 框架托管 | 「启动阶段跑一批可 async 的初始化器」模型 |

## 2. 关键洞察

### 2.1 我们已有 DI 容器 —— 不该复制 godot 门面
godot 的 `CoreKit` 门面**同时**扮演三个角色：服务注册表、构造编排、访问入口。它这么做的**唯一原因是 GDScript 没有真正的 DI 容器**——门面自带的 `_services` 字典就是穷人版容器。

creator-core-kit **已经有**：
- `getRootContainer()`（跨 bundle 唯一根容器，ADR-0001）＝注册表；
- `cck.resolve/tryResolve`（门面糖）＝访问入口；
- `getLogger/getEventBus/getTimer`（强类型糖）＝子系统访问器。

所以 Bootstrap **不该再造一个门面注册表**（那是重复且与容器分裂），只需补齐 godot 门面里**容器没覆盖的那部分**：**确定性的构造/注册顺序 + 生命周期编排 + 关闭**。这正是 VContainer 的 `Installer` + entry-point 模型干的事。

### 2.2 Bootstrap 存在的真正刚需：把 timer 实例与帧驱动接起来
`getTimer()` 在未注册时兜底返回一个**进程级默认 timer**，但那个 timer **没有任何驱动**——没人调它的 `tick(dt)`，于是所有 `delay/interval/onFrame` 永远不触发。这是「四块地基」里唯一无法靠现有兜底自洽的地方。

Bootstrap 必须：
1. 造**一个** timer 实例（`createTimer()` 返回 `ITimer & ITimerDriver`）；
2. 注册进 `TIMER` token（让所有 `getTimer()` 消费方共享**同一个**）；
3. 把 **driver 一侧**（`.tick`）交给 engine，由 `cc.director` 的 `EVENT_UPDATE` 每帧驱动。

「一个实例、消费（`ITimer`）与驱动（`ITimerDriver`）分离访问」正是 ITimer 设计时拆两个接口的兑现点，也是 Bootstrap 的核心价值。Logger/EventBus 靠兜底即可工作，注册只为「engine 覆盖」（如 `CcLogger`）与一致性。

### 2.3 entry-point 三件套 ≈ 我们的生命周期
VContainer 的 `IInitializable.Initialize / ITickable.Tick / IDisposable.Dispose` 与我们的模型一一对应：
- `Initialize` → 模块的 `install`（注册服务）+ `start`（启动）；
- `Tick` → **不进 Bootstrap**——由 ITimer 的 `onFrame` 承载，engine 只驱动 timer 一处，模块经 `getTimer().onFrame()` 订阅（避免 Bootstrap 再造一套 tick 分发，与 ITimer 重复）；
- `Dispose` → 模块的 `stop`，`kit.shutdown()` 逆序调用。

### 2.4 core / engine 切分
- **core（纯编排，可测）**：模块（KitModule）概念、`boot()` 编排（顺序 install/start、幂等、关闭）、内置 `coreModule()`（注册 EventBus + Timer 纯实现）。零 cc，vitest 直接测（手动 `tick` 驱动 timer）。
- **engine（cc 适配，需 cc mock 才能测）**：`CcLogger`（`ILogger` 的 cc 实现）、`cc.director → timer.tick(dt)` 驱动、`bootCoreKit()` 入口 / 空引导场景上的 `CckBootstrap` 组件。

> ⚠️ 现状：`apps/demo` 与 cc mock 均未建（cc mock 是 batch-1 另一条未开始项）。故 engine 半暂无法干净 TDD，宜与「测试脚手架 + cc mock」一并推进。

## 3. 该抄 / 该砍

**抄：**
- VContainer `Installer` + entry-point 三件套 → **KitModule（install/start/stop）** 生命周期。
- NestJS → **多阶段（install 全部先跑完，再 start）+ 逆序关闭**。
- godot → **确定性顺序 + 单一编排入口 + 尽早（install 阶段）挂关键资源**。
- cc `director.EVENT_UPDATE` → **engine 驱动 timer 的唯一入口**。

**砍（YAGNI，首版不做）：**
- 门面注册表（用容器）、每模块独立子容器 scope、构造函数自动注入模块依赖、优先级数字排序、`onFrame` 之外的 Bootstrap 级 tick 分发、DI 反射/装饰器。
- 关键**待拍板**：模块间依赖（deps + 拓扑排序）现在做还是留 v2；engine 半是否本轮一并落地。详见设计文档 Open Questions。

## 4. 结论（供设计文档采纳）

Bootstrap = **精简版「模块化组合根」**：
- core 提供 `boot({ container?, modules?, logger? }): Promise<Kit>`，按序 `install` → `start`，幂等（重复 boot 抛错），`kit.shutdown()` 逆序 `stop`；错误 fail-fast（启动失败必须响亮）。
- core 提供 `coreModule({ eventBus?, timer? })`：注册 EVENT_BUS + TIMER 纯实现；timer 实例由调用方（engine/测试）持有以获得 driver。
- engine 后续提供 `CcLogger` + `cc.director` 驱动 + 引导入口。
- **不重建门面**，`getLogger/getEventBus/getTimer` 与 `cck` 仍是访问入口。
