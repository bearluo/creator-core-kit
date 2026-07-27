---
模块: bootstrap
所在包: packages/core（组合根，纯编排） + packages/engine（cc 适配：CcLogger + 帧驱动 + 引导入口）
状态: 已实现
摘要: 把 DI/Logger/EventBus/ITimer（及后续模块）串成确定性、幂等的启动链；core 纯编排可测，engine 供 cc 适配与每帧驱动。
何时读: 接入框架写启动代码、加新模块进启动链、排查启动顺序/生命周期问题时。
日期: 2026-07-27
依赖: DI 容器、Logger、EventBus、ITimer（组装四者）；横评见 docs/research/2026-07-27-bootstrap-survey.md
---

# Bootstrap 启动流程 / 组合根 设计文档

## TL;DR

- Bootstrap 是框架的**组合根**：一处集中、按确定性顺序把服务注册进根容器并启动，幂等、可关闭。
- **不重建门面**（我们已有 `getRootContainer()` + `cck` + `getLogger/getEventBus/getTimer`）；只补容器没覆盖的「顺序编排 + 生命周期 + 关闭」。
- core 提供 `boot({ modules })` + 内置 `coreModule()`（注册 EventBus/Timer 纯实现），纯 TS、vitest 手动 `tick` 直测。
- **核心刚需**：造一个 timer 实例注册进 `TIMER`，driver 一侧交 engine 用 `cc.director` 每帧 `tick(dt)`——否则 `getTimer()` 兜底出来的 timer 无人驱动、定时永不触发。
- engine 半（`CcLogger` + 帧驱动 + 空引导场景入口）随「cc mock 脚手架」一并落地。

## Purpose（目标与定位）

- **做什么**：提供唯一的启动装配点，把地基服务（Logger/EventBus/ITimer…）按序注册进 DI 根容器、跑各模块的启动钩子，并支持关闭（测试隔离、热重载）。
- **定位/取舍**：
  - 复用现有 DI 容器当注册表，**不造第二个门面注册表**（godot 的 CoreKit 门面只是因 GDScript 没有 DI 容器的穷人版容器；我们不需要，见横评 §2.1）。
  - 采「模块化组合根」（VContainer `Installer` + entry-point 模型）：每个功能/bundle 导出一个 `KitModule`，项目自由组合——直接服务「易接入不同项目」「一模块一 bundle」。
- **YAGNI（首版砍掉）**：门面注册表、每模块独立子 scope、构造函数自动注入模块依赖、优先级数字、Bootstrap 级 tick 分发（用 `ITimer.onFrame`）、DI 反射/装饰器。

## Public API（TypeScript 精确签名）

```ts
// packages/core/src/bootstrap/bootstrap.ts

/** 传给各模块钩子的上下文：容器 + 一个供打日志的 logger。 */
export interface BootContext {
  readonly container: Container;
  readonly logger: ILogger;
}

/**
 * 一个可组合的启动模块（功能单元 / 一个 bundle 一个）。
 * 生命周期：boot 时先对所有模块跑 install（注册服务），全部完成后再依次 start；
 * shutdown 时逆序跑 stop。三个钩子均可 async，可缺省。
 */
export interface KitModule {
  readonly name: string;
  readonly deps?: readonly string[];                 // 依赖的模块名（若采纳拓扑排序，见 OQ-1）
  install?(ctx: BootContext): void | Promise<void>;  // 注册服务到容器
  start?(ctx: BootContext): void | Promise<void>;    // 全部 install 后启动
  stop?(ctx: BootContext): void | Promise<void>;     // 关闭（逆序、best-effort）
}

export interface BootOptions {
  container?: Container;    // 默认 getRootContainer()
  modules?: KitModule[];    // 默认 []
  logger?: ILogger;         // 默认 getLogger('Bootstrap')
}

/** boot 的结果句柄，也注册进容器（KIT token）。 */
export interface Kit {
  readonly container: Container;
  readonly modules: readonly string[];  // 已启动模块名（编排序）
  readonly started: boolean;
  /** 逆序 stop 各模块（best-effort，单个失败仅告警不中断），并注销 KIT。幂等。 */
  shutdown(): Promise<void>;
}

/** DI token：boot 成功后注册结果 Kit，兼作「已启动」标记（重复 boot 抛错的依据）。 */
export const KIT: Token<Kit>;

/**
 * 组合根入口。按序 install → start 全部模块，注册 KIT，返回句柄。
 * - 幂等保护：同一 container 已 boot（KIT 已注册）→ 抛错，需先 shutdown()。
 * - 错误 fail-fast：任一 install/start 抛错 → 裹上模块名后抛出（启动失败必须响亮）。
 */
export function boot(opts?: BootOptions): Promise<Kit>;

/**
 * 内置模块：注册 EventBus + Timer 的纯实现（零 cc）。
 * - eventBus / timer 缺省则内部 createEventBus()/createTimer()；已在容器注册则跳过（尊重覆盖）。
 * - timer 实例由**调用方持有**以拿到 driver：engine 接 cc.director，测试手动 tick。
 */
export function coreModule(opts?: {
  eventBus?: IEventBus;
  timer?: ITimer & ITimerDriver;
}): KitModule;
```

engine 半（本文件覆盖设计，实现随 cc mock 脚手架，见 OQ-2）：

```ts
// packages/engine/src/（示意）
export class CcLogger implements ILogger { /* 包 cc.log/warn/error/debug */ }
export function loggerModule(logger?: ILogger): KitModule;   // 注册 LOGGER→CcLogger
/** engine 启动入口：造 timer、boot 组合根、把 cc.director.EVENT_UPDATE 接到 timer.tick(dt)。 */
export function bootCoreKit(opts?: { modules?: KitModule[] }): Promise<Kit>;
// 及一个可挂在「空引导场景」上的 CckBootstrap 薄 cc.Component（onLoad 调 bootCoreKit）。
```

## Behavior & data flow（行为与数据流）

**boot 流程**（core，纯逻辑）：
1. 解析 `container`（默认根）、`logger`（默认 `getLogger('Bootstrap')`）、`modules`（默认 `[]`）。
2. **幂等检查**：`container.hasLocal(KIT)` 为真 → 抛 `already booted`。
3. **排序**：数组序（v1）或按 `deps` 拓扑排序（OQ-1）；缺失依赖 / 成环 → 抛错。
4. **install 阶段**：按序 `await m.install?.(ctx)`；抛错 → `logger.error` + 裹模块名抛出（fail-fast）。
5. **start 阶段**：同序 `await m.start?.(ctx)`；同样 fail-fast。
6. 组装 `Kit`（`container` / `modules` / `started=true` / `shutdown`），`container.register(KIT, { useValue: kit })`。
7. 返回 `kit`。

**coreModule.install**：`hasLocal(EVENT_BUS)` 否则注册 `createEventBus()`；`hasLocal(TIMER)` 否则注册传入或 `createTimer()` 的实例。**不注册 driver 到容器**——driver 只经调用方持有的引用触达（单一 token，消费/驱动分离）。

**每帧驱动（engine）**：`director.on(Director.EVENT_UPDATE, () => timer.tick(game.deltaTime))`。模块要每帧逻辑 → `getTimer().onFrame(cb)`，不经 Bootstrap（避免与 ITimer 重复分发）。

**shutdown**：幂等（`started` 转 false 后再调 no-op）；逆序 `await m.stop?.(ctx)`，每个 try/catch + `logger.warn` 续跑（拆卸 best-effort）；`container.unregister(KIT)`。

**core / engine 切分**：核心编排 + `coreModule` 在 core（零 cc、可测）；`CcLogger`、`cc.director` 驱动、引导组件在 engine（经 `ILogger`/`ITimerDriver` 接口交互，用 cc mock 测薄壳）。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 组合方式 | 门面注册表 / **模块化组合根 KitModule** / 裸 installCore() | 模块化组合根 | 复用容器不重复；比裸函数可扩展，服务「一模块一 bundle」组合 |
| 2 | 生命周期 | 单 init / **install→start 两段 + stop** | 两段+stop | install 全跑完再 start，start 时依赖都在（NestJS 模型） |
| 3 | 每帧驱动 | Bootstrap 自带 tick / **ITimer.onFrame** | onFrame | 不与 ITimer 重复；engine 只驱动 timer 一处 |
| 4 | driver 获取 | 独立 TIMER_DRIVER token / **调用方持有传入** | 调用方持有 | 谁驱动谁创建；单一 token，消费/驱动分离 |
| 5 | 同步/异步 | 同步 / **async Promise** | async | 资源挂载/热更/平台探测天然异步 |
| 6 | 错误策略 | 隔离续跑 / **fail-fast 抛错** | fail-fast | 半初始化 kit 比响亮失败更危险；错误裹模块名 |
| 7 | 重复 boot | 幂等返回旧 / **抛错（先 shutdown）** | 抛错 | 双 boot 是 bug；shutdown 显式重置，利于测试 |
| 8 | 关闭策略 | fail-fast / **逆序 best-effort** | best-effort | 拆卸不应因单个失败中断 |
| 9 | 模块排序 | 数组序（v1） / **deps+拓扑** | deps+拓扑 | 定稿：现在就上，利跨 bundle 组合、防手动排序 bug（DFS 后序，输入序为并列 tiebreak；缺依赖/成环/重名抛错） |
| 10 | engine 半本轮 | **core-only + 下轮 engine** / 全做 | core-only | 定稿：cc mock 未建（batch-1 独立项），engine 半与其配对下轮 |

## Platform considerations（全平台 / 小游戏兼容）

- boot 是 async：原生 `AssetsManager` 挂载、Web/小游戏远程 bundle 版本探测、`IPlatform` 平台判定都能进 install 阶段而不阻塞主线程（对应横评「尽早挂包」）。
- 帧驱动经 `cc.director`，各平台一致；core 侧零平台耦合。
- 与三种「热」：install 阶段是 `HotUpdateService.mountInstalled()`（原生）/ 远程 bundle 版本校验（Web/小游戏）的天然挂载点；热重载时 `shutdown()`→重 `boot()` 提供干净重启。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：core 半零 `cc`，vitest 手动 `timer.tick(dt)` 即可驱动，无需 Creator。engine 半经 `ILogger`/`ITimerDriver` mock（依赖 cc mock 脚手架）。
- **core 用例清单（本轮实现）**：
  1. 空 modules：boot 成功，`started=true`，KIT 注册可 `resolve`。
  2. install 先于 start：跨模块顺序断言（记录调用序）。
  3. 多模块按数组序 install/start。
  4. coreModule：boot 后 `getEventBus()/getTimer()` 得到已注册实例（同一引用）。
  5. coreModule 尊重预注册：容器已有 EVENT_BUS/TIMER → 不覆盖。
  6. 传入 timer：boot 后经容器 resolve 到的即传入实例；外部 `tick` 能驱动其 `delay`。
  7. install 抛错 → boot reject，错误含模块名，且不进入 start。
  8. start 抛错 → boot reject，错误含模块名。
  9. 重复 boot 同 container → reject（already booted）。
  10. shutdown 逆序 stop（断言调用序倒序）。
  11. shutdown 幂等：二次调用 no-op、不抛。
  12. shutdown 后可重新 boot（KIT 已注销）。
  13. stop 抛错 → best-effort：告警但不中断、其余 stop 仍跑、shutdown resolve。
  14. 自定义 container：boot 到子 scope 不污染根。
  15. 默认 logger 经 getLogger('Bootstrap')；install/stop 错误路径有日志（spy console 或注入 logger）。
  16.（若采纳 OQ-1）deps 拓扑：乱序声明按依赖序 install；缺失依赖 / 成环 → 抛错。

## 定稿决议（2026-07-27）

- **组合方式**：A 模块化组合根（KitModule 纯对象字面量 + `boot()` 编排）。否决门面（触 ADR-0001 静态单例分裂）与裸函数（与 deps/shutdown 矛盾、15 模块必重构）。
- **OQ-1 模块排序**：**deps + 拓扑排序**（DFS 后序；重名/缺依赖/成环抛错；输入数组序为并列项 tiebreak）。
- **OQ-2 本轮范围**：**core 半**——本文件设计全覆盖两半，本轮实现 + 100% 测 `boot()`/`coreModule()`；engine 半（CcLogger + `cc.director` 驱动 + 空引导场景入口）与「cc mock 脚手架」下一轮配对。
- **OQ-3 boot 契约**：async Promise + install/start fail-fast（裹模块名、`.cause` 挂原始错误、`logger.error` 上报）+ 重复 boot 同 container 抛 `already booted` + `shutdown()` 逆序 best-effort（单 stop 失败仅 `logger.warn` 续跑）。
- **实现注记**：`target/lib=ES2021` 不含 `ErrorOptions`，故不用 `new Error(msg,{cause})`，改手动挂 `.cause` 属性（运行时等价、类型经窄化 cast）。

---

## 实现记录（core 半，2026-07-27）

- **落地文件**：`packages/core/src/bootstrap/bootstrap.ts`（`boot` / `coreModule` / `KIT` / 类型）、`bootstrap/index.ts`（barrel）、`bootstrap/__tests__/bootstrap.test.ts`（20 用例）；`packages/core/src/index.ts` 追加 `export * from './bootstrap'`。
- **最终 API 与设计偏差**：与定稿签名一致，无偏差。要点：
  - `boot(opts?)` 默认 `container=getRootContainer()` / `logger=getLogger('Bootstrap')` / `modules=[]`；拓扑序 install → start；成功后 `container.register(KIT, {useValue: kit})`。
  - 幂等：入口 `container.hasLocal(KIT)` 为真即抛 `already booted`。
  - fail-fast：install/start 抛错 → `logger.error` 上报 + `fail()` 裹模块名抛出（原始错误挂 `.cause`，规避 ES2021 无 `ErrorOptions`）。
  - `shutdown()`：`started` 幂等门；逆序 `stop`，每个 try/catch + `logger.warn` 续跑（best-effort）；`unregister(KIT)`。
  - `coreModule({eventBus?,timer?})`：`hasLocal` 守卫下注册 EVENT_BUS / TIMER；timer 实例由调用方持有以拿 driver（消费/驱动分离）。
  - 拓扑：DFS 后序（`topoSort`），重名 / 缺依赖 / 成环分别抛错，错误信息含成环路径。
- **测试结果 / 覆盖率**：20 用例全绿；`bootstrap.ts` **100%**（stmts/branch/funcs/lines）。core 全量 95 测试通过，`tsc -b` 与 `eslint .` 干净。
- **commit / PR**：`b0b2bfc`（feat）+ `a50a291`（docs）。
- **遗留 Minors**：无。

## 实现记录（engine 半，2026-07-27）

- **落地文件**：`packages/engine/src/cc-logger.ts`（`createCcLogger`/`ccSink`）、`packages/engine/src/bootstrap.ts`（`driveWithDirector`/`loggerModule`/内部 `directorDriveModule`/`bootCoreKit`）、`index.ts`；`packages/engine/test/mocks/cc.ts`（cc 测试替身，单一真源）；`packages/engine/src/__tests__/`（cc-logger 4 + bootstrap 7 = 11 用例）。配置：`packages/engine/tsconfig.json`（`rootDir:"."` + `paths:{cc→mock}` + `references:[core]`）、根 `vitest.config.ts`（`resolve.alias` 把 `cc`→mock、`@cck/core`→core src）。
- **测试策略定稿**：纯 JS（vitest node）+ 封顶 cc mock，禁止 mock 引擎行为，重 cc 走集成——见 **ADR-0002**。cc mock 单一真源：tsconfig `paths` 与 vitest `alias` 双指同一 `test/mocks/cc.ts`，签名逐字对齐 Creator 真 `cc.d.ts`。真 cc 权威校验下沉 apps/demo。
- **最终 API**：
  - `createCcLogger(opts?)` = 薄壳：复用 core `createConsoleLogger`，仅把 `LogSink` 换成 cc 版（`debug→cc.debug`、`info→cc.log`（cc 无 info）、`warn→cc.warn`、`error→cc.error`）；level/child/prefix 逻辑全在 core，不重写。
  - `driveWithDirector(driver): Disposer` = 订阅 `Director.EVENT_AFTER_UPDATE`（引擎+组件 update 之后），每帧读 `game.deltaTime` 调 `driver.tick(dt)`；返回解绑器。
  - `loggerModule(logger?)` = `hasLocal(LOGGER)` 守卫下注册 `LOGGER→CcLogger`。
  - `bootCoreKit(opts?)` = 造 `timer` → `boot([loggerModule, coreModule({timer}), directorDriveModule(timer), ...user])`；帧驱动经内部 `directorDriveModule` 纳入生命周期，`kit.shutdown()` 自动解绑。
  - **与设计偏差**：帧驱动事件由设计初稿假设的 `EVENT_UPDATE` 改为 **`EVENT_AFTER_UPDATE`**（实证 cc Director 无 `EVENT_UPDATE`）；`CckBootstrap` cc.Component **按定稿缓做**（避免 `experimentalDecorators` + mock 扩面，无实质可测价值），空引导场景入口暂由 `bootCoreKit()` 承担，组件留下轮随 apps/demo。
- **测试结果**：engine 11 用例全绿（含帧驱动触发/解绑、CcLogger 级别映射与过滤、loggerModule 尊重预注册、bootCoreKit 端到端注册 + 帧驱动 + shutdown 解绑）；全量 106 测试通过，`tsc -b`/`eslint .` 干净。engine 按 ADR-0002 不计入 core coverage 硬门槛。
- **commit / PR**：待提交。
- **遗留 Minors**：`CckBootstrap` 组件与 apps/demo 真 cc 端到端校验留下一轮。
