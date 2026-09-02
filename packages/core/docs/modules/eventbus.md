---
模块: eventbus
所在包: packages/core（纯 TS，零 cc）
状态: 已定稿          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 类型安全的发布/订阅事件总线——EventMap 泛型编译期校验事件名+载荷；同步快照 FIFO 派发（重入安全）；on 返回 disposer + offAll(owner) 生命周期清理；错误隔离；EVENT_BUS token / getEventBus() 便捷。
何时读: 做模块间弱耦合通信（发布/订阅）、给全局/局部总线加事件、engine 侧组件订阅/清理、埋点旁路监听时。
日期: 2026-07-27
依赖: di-container（EVENT_BUS 走 DI 注入/覆盖）；logger（错误隔离经 ILogger 上报）；架构总纲 §4「类型安全 EventBus」；横评 docs/research/2026-07-27-eventbus-survey.md
---

# EventBus 设计文档

## TL;DR

core 自研纯 TS 事件总线：用 **`EventMap` 泛型接口**让事件名与 payload **编译期双向校验**（区别于所有裸字符串事件库，是本模块灵魂）。语义骨架照抄经 [[godot-core-kit-reference]] `event_bus.gd` 验证的设计：**同步 + 快照 + FIFO + 幂等去重 + 重入安全**。退订走现代风格——`on()` 返回一次性 `disposer` 函数；生命周期清理用 `offAll(owner)`（替 godot 靠 GC 的惰性剔除，JS 无等价物）。一个坏订阅不拖垮整轮广播（**错误隔离** + 经 [[logger]] 上报）。通过 `EVENT_BUS` token 注入 + `getEventBus()` 便捷取用，对齐 Logger 的 DI 范式。**补充而非取代**直接引用：只用于发布方/订阅方无引用关系的弱耦合广播。

## Purpose（目标与定位）

- **做什么**：模块间**弱耦合**通信。发布方 `emit(key, payload)`，订阅方 `on(key, handler)`，双方互不持有引用。
- **定位/取舍**：**补充而非取代**直接调用/回调。有明确引用关系时直接调（省一层间接、可追溯）；EventBus 只用于「发布方不知道谁在听」的广播场景（如 `player:died` → HUD/成就/音效各自订阅）。
- **灵魂 = 类型安全**：架构总纲要求「编译期校验事件名与载荷类型」。市面裸字符串总线（Node EventEmitter / cc.EventTarget / oops.message）都做不到；本模块用 TS 泛型补足 GDScript 对标里缺的编译期校验。
- **YAGNI（首版砍）**：优先级排序、异步/队列派发、通配/层级事件匹配（`a:*`）、GC 自动剔除、RxJS 式操作符——全砍，需要再加（见 §横评 §3）。

## Public API（TypeScript 精确签名）

```ts
/**
 * 全局事件表：key = 事件名（'namespace:event' 过去时），value = payload 类型（无载荷用 void）。
 * 默认空 → 项目用 declaration merging 往本接口合并自己的全局事件。
 * 【定稿修正】不设 index signature（`[k:string]: unknown`）——否则 keyof 退化为 string、
 * payload 退化为 unknown，丧失编译期精确校验（本模块灵魂）。局部总线用 createEventBus<具体接口>()。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EventMap {}

/** 退订句柄：调用即退订对应订阅；幂等（重复调用无副作用）。 */
export type Disposer = () => void;

export interface OnOptions {
  /** true = 触发一次后自动退订（等价 once()）。 */
  once?: boolean;
  /** this 绑定 + 归属标识：handler 以该对象为 this 调用，且可被 offAll(target) 整体退订。 */
  target?: object;
}

export interface IEventBus<E extends EventMap = EventMap> {
  /** 订阅 key。返回 disposer（调用即退订）。同一 (key, handler, target) 重复订阅幂等（去重，不重复触发）。 */
  on<K extends keyof E>(key: K, handler: (payload: E[K]) => void, opts?: OnOptions): Disposer;

  /** 语法糖：on(key, handler, { once: true, ...opts })。触发一次后自动退订。 */
  once<K extends keyof E>(key: K, handler: (payload: E[K]) => void, opts?: Omit<OnOptions, 'once'>): Disposer;

  /** 退订指定 (key, handler[, target])。未订阅时空操作，不报错。 */
  off<K extends keyof E>(key: K, handler: (payload: E[K]) => void, target?: object): void;

  /** 退订 target（on 时传的对象）在所有事件上的全部订阅。用于组件 onDestroy 一行清理。 */
  offAll(target: object): void;

  /**
   * 同步派发 key：按订阅顺序（FIFO）依次调用当前订阅快照。
   * 派发期间的 on/off 只影响下一次 emit（重入安全）。
   * void 事件可省 payload：emit('ui:ready')。某 listener 抛异常被隔离（经 onError 上报）并继续派发其余。
   */
  emit<K extends keyof E>(key: K, ...args: E[K] extends void ? [] : [payload: E[K]]): void;

  /** 是否存在至少一个订阅。 */
  has<K extends keyof E>(key: K): boolean;

  /** 指定事件当前订阅数。 */
  listenerCount<K extends keyof E>(key: K): number;

  /** 旁路监听全部事件（调试面板 / 埋点）。常规业务用 on()。返回 disposer。 */
  onAny(handler: (key: keyof E, payload: E[keyof E]) => void): Disposer;

  /** 清空指定事件的全部订阅；不传 key 时清空所有事件 + onAny（测试隔离 / 场景切换重置）。 */
  clear<K extends keyof E>(key?: K): void;
}

/** 造事件总线。onError 默认经 getLogger('EventBus').error 上报（错误隔离）。 */
export function createEventBus<E extends EventMap = EventMap>(opts?: {
  onError?: (err: unknown, key: keyof E) => void;
}): IEventBus<E>;

/** DI token：engine/项目可 register 覆盖全局总线实现（见 di-container）。 */
export const EVENT_BUS: Token<IEventBus>;

/**
 * 便捷取用全局总线：优先 getRootContainer().tryResolve(EVENT_BUS)；未注册则用进程级默认实例
 * （不自动注册进容器，避免副作用）。泛型 E 仅做类型断言，运行时是同一个全局实例。
 */
export function getEventBus<E extends EventMap = EventMap>(): IEventBus<E>;
```

**全局总线类型化**：`getEventBus()` 面向全项目共享的一个实例，其事件表无法集中枚举。两条用法：
1. **全局事件**：项目用 declaration merging 扩展 `EventMap`——
   ```ts
   declare module '@cck/core' {
     interface EventMap { 'player:died': { score: number }; 'ui:ready': void }
   }
   getEventBus().emit('player:died', { score: 1200 }); // 全局即获类型校验
   ```
2. **模块私有总线**：`const bus = createEventBus<MyModuleEvents>()`，类型闭合在模块内，不污染全局。

## Behavior & data flow（行为与数据流）

- **内部结构**：`_listeners: Map<key, Subscription[]>`；`Subscription = { handler, once, target? }`，数组顺序 = 插入顺序 = 触发顺序（FIFO）。`_anyListeners: Array<AnyHandler>`（onAny）。
- **on**：查 `(key, handler, target)` 三元组是否已存在 → 存在则幂等返回原 disposer 语义（空操作）；否则 append。返回的 `disposer` 调用 = `off(key, handler, target)`，幂等。
- **emit**：
  1. 若该 key 有订阅，**快照** `_listeners.get(key).slice()`（防派发期间增删影响本轮 → 重入安全）。
  2. 按序对快照每个 sub：`try { sub.target ? handler.call(sub.target, payload) : handler(payload) } catch (e) { onError(e, key) }`（**错误隔离**，continue）。
  3. `sub.once` 的在本轮结束后从实时列表移除（不影响快照）。
  4. 派发 `_anyListeners`（同样快照 + 隔离）。
- **off / offAll / clear**：从实时列表移除；正在进行的 emit 用的是快照，故安全。`offAll(target)` 遍历所有 key 移除 `sub.target === target` 的项。
- **无 GC 自动剔除**：JS 无 `Callable.is_valid()` 等价物 → 不做惰性剔除；未退订即泄漏，由调用方（`disposer` / `offAll` / `clear`）负责。这是与 godot 对标的**唯一实质差异**（见横评 §2.3）。
- **与 cc 边界**：**全在 core，零 cc**。engine 侧 `cc.Component` 在 `onLoad`/`onEnable` 里 `getEventBus().on(..., { target: this })`，`onDestroy` 里 `getEventBus().offAll(this)` 一行清理——engine 只是消费方，不需另写 cc 实现（不像 Logger 有 CcLogger）。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 类型安全模型 | 裸 string / **EventMap 泛型 + 单 payload** | **EventMap 泛型** | 编译期校验事件名+载荷（本模块灵魂）；单 payload 推导最干净、对齐 godot 单 Variant |
| 2 | 退订方式 | 仅 off(key,fn) / **on 返回 disposer + off + offAll** | **三者都给** | disposer 配 DI/生命周期最省心；offAll(owner) 对应组件 onDestroy 一行清理 |
| 3 | 生命周期清理 | GC 自动剔除 / **offAll(owner) + disposer** | **手动** | JS 无 `is_valid()` 等价物，WeakRef 太重且时机不可控 |
| 4 | 派发语义 | 异步/队列 / **同步快照 FIFO** | **同步快照 FIFO** | 可预测可测；快照保重入安全（照抄经验证的 godot） |
| 5 | 去重 | 允许重复 / **(key,handler,target) 幂等** | **幂等去重** | 杜绝重复订阅导致的多次触发坑（Node/mitt 都不去重是隐患） |
| 6 | 错误处理 | 抛出中断 / **隔离 + 经 ILogger 上报** | **隔离** | 一个坏订阅不拖垮整轮广播（比 godot 直接 call 更稳） |
| 7 | once | 无 / **once() + opts.once** | **有** | 常见需求（一次性初始化/一次性响应） |
| 8 | tap-all | 无 / **onAny** | **有（轻量）** | 调试面板 / 埋点旁路（对标 godot event_published signal / mitt '*'） |
| 9 | 全局 vs 实例 | 纯全局单例 / **可 new 实例 + EVENT_BUS token + getEventBus()** | **实例+token+便捷** | 局部私有总线 + 全局共享两用；对齐 Logger 范式 |
| 10 | 命名约定 | 自由 / **`namespace:event` 过去时** | **约定** | 沿用 godot kit 约定；TS 字面量键天然防拼错（比 EV_* 常量更强） |

## Platform considerations（全平台 / 小游戏兼容）

- 纯 TS（Map/数组/函数），node/web/所有小游戏/原生**无差异**，无平台分支。
- 与三种「热」：EventBus 实例随 core 代码；跨 bundle 共享须走**全局 `EVENT_BUS` token**（ADR-0001：普通出包 npm 代码在 base 共享层单份，全局注册表跨 bundle 唯一）——各 bundle `getEventBus()` 拿到同一实例，事件互通。
- 场景切换：约定切场景时对将销毁对象 `offAll(this)`；或全局 `clear()` 重置（谨慎，会清掉常驻订阅）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc。handler 用 `vi.fn()` 断言调用次数/顺序/payload；`onError` 注入 fake 断言错误隔离。
- **用例清单**：
  1. `on`+`emit`：handler 收到正确 payload；`listenerCount` 正确。
  2. 多订阅 **FIFO** 顺序触发。
  3. **幂等去重**：同 `(key,handler)` 订阅两次 → emit 只触发一次；`listenerCount===1`。
  4. `off(key,handler)` 后 emit 不再触发。
  5. **disposer**：`on` 返回的函数调用后退订；重复调用幂等（不误伤后续同 handler）。
  6. `once`：触发一次后自动退订；第二次 emit 不触发。
  7. `offAll(target)`：退订该 target 全部事件订阅，其他 target 不受影响。
  8. `target` 绑定：handler 内 `this === target`。
  9. **重入安全**：某 handler 内 `on` 新订阅 → 本轮 emit 不触发新订阅，下轮触发。
  10. **重入安全**：某 handler 内 `off` 其他订阅 → 本轮快照仍触发被 off 的，下轮不触发。
  11. **错误隔离**：前一个 handler 抛异常 → `onError(e,key)` 被调用且后续 handler 仍触发。
  12. `emit` void 事件：`emit('ui:ready')` 免 payload 编译通过 + 运行触发。
  13. `onAny`：任意 emit 都收到 `(key, payload)`；其 disposer 可退订。
  14. `clear(key)` 清单事件；`clear()` 清全部（含 onAny）。
  15. `has` / `listenerCount` 边界（无订阅返回 false/0）。
  16. `EVENT_BUS` token：`getEventBus()` 未注册 → 进程级默认（不注册进容器）；`register(EVENT_BUS, fake)` 后 → 返回注入实现。
  17. 默认 `onError` 未注入时经 `getLogger('EventBus').error` 上报（spy 验证，不抛）。

## Open Questions（已决议 · 2026-07-27 定稿）

1. **onAny**：✅ **留**（轻量支持调试/埋点旁路，对标 godot `event_published`，成本低）。
2. **错误处理**：✅ **隔离 + 经 `getLogger('EventBus').error` 上报**（一个坏订阅不拖垮整轮广播；开发期仍在控制台可见，非静默吞）。
3. **全局总线类型化**：✅ **双轨**——全局事件走 declaration merging 扩展 `EventMap`（故 `EventMap` 定稿为空接口、无 index signature）；模块私有事件走 `createEventBus<E>()`。
4. **void 事件免 payload**：✅ **采用**条件元组类型 `...args: E[K] extends void ? [] : [payload: E[K]]`。
5. **去重键含 target**：✅ **含**——`(key, handler, target)` 三元组去重（同 handler 不同 target = 不同订阅，支持多组件实例各自订阅/清理）。

**首版砍**（均可后续向后兼容加回）：优先级排序 / 异步·队列派发 / 通配·层级匹配（`a:*`）/ RxJS 操作符。理由见横评 `docs/research/2026-07-27-eventbus-survey.md` §3。

---

## 实现记录

- **落地文件**：`packages/core/src/eventbus/eventbus.ts`（`EventMap`/`Disposer`/`OnOptions`/`IEventBus` + `EventBusImpl` + `createEventBus` + `EVENT_BUS` token + `getEventBus`）、`index.ts`（导出）；由 core `index.ts` re-export。
- **最终 API 与设计偏差**：整体按设计，一处**定稿期精修**——`EventMap` 由「带 index signature `[event:string]:unknown`」改为**空接口**：带 index signature 会让 `keyof EventMap` 退化为 `string`、payload 退化为 `unknown`，使 declaration merging 扩展的全局事件丧失精确校验（本模块灵魂）。空接口既支持全局 merging（精确 key），又不影响 `createEventBus<具体接口>()` 的局部精确类型（`E extends EventMap` 约束对空接口形同 `extends {}`，任何事件表都满足）。
- **实现要点**：`on` 返回的 disposer 绑定到具体 `Subscription` 对象（非 `(key,handler)`）+ `disposed` 标记 → 精确移除、幂等、不误伤后续同 handler 的新订阅；`emit` 先 `slice()` 快照再派发（重入安全），`try/catch` 每个 listener 经 `onError` 隔离上报，`once` 无论成功/抛出都在触发后移除；默认 `onError` 每次现取 `getLogger('EventBus')`（engine `register(LOGGER,…)` 覆盖后自动切换）。
- **测试结果 / 覆盖率**：`vitest` 全绿（core 共 **54 测试**：DI 20 + Logger 13 + EventBus 19 + 骨架 2）；`tsc -b`、`eslint` 干净。`eventbus.ts` 覆盖 **Stmts/Branch/Funcs/Lines 全 100%**；core All files 100/98.19/100/100（剩余 branch 缺口来自 DI/logger 早前已接受的防御分支）。
- **commit / PR**：待提交。
- **遗留 Minors**：engine 侧 `cc.Component` 消费示范（`onLoad` 订阅 `{ target: this }` + `onDestroy` `offAll(this)`）留 Bootstrap/engine 接入阶段；跨 bundle 共享须 engine Bootstrap 里 `register(EVENT_BUS, bus)` 到根容器（ADR-0001）。
