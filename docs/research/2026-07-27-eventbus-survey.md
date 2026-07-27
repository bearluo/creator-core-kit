---
类型: research（横评快照）
状态: 已定稿
摘要: 类型安全 EventBus 的横向调研——对照 godot-core-kit event_bus + 市面 JS/TS 事件库（Node EventEmitter / mitt / eventemitter3 / typed-emitter / RxJS Subject / cc.EventTarget / oops.message），沉淀 creator-core-kit EventBus v1 的选型依据。
何时读: 设计 / 评审 EventBus 模块，或想知道"为什么这样设计事件总线"时。
日期: 2026-07-27
依赖: 无（为 docs/design/modules/eventbus.md 提供选型佐证）
---

# 类型安全 EventBus 横评（CC/TS）

> 目的：为 creator-core-kit 的 `EventBus` 定选型。遵循「设计前先横向调研」的约定，对标同作者
> [[godot-core-kit-reference]] 的 `event_bus.gd` + 市面主流 JS/TS 事件库，逐轴对比后给 v1 结论。

## 0. 背景约束（creator-core-kit 专属）

- **铁律**：EventBus 落在 `packages/core`，**零 `cc` 依赖** → 不能用 `cc.EventTarget`，须自研纯 TS。
- **架构总纲**要求：**类型安全**——「编译期校验事件名与载荷类型」（§4）。这是本模块区别于所有裸字符串事件库的核心诉求。
- 与 DI 一致：走 `EVENT_BUS` token + 默认全局实例（对齐 [[logger]] 的 `LOGGER`/`getLogger` 范式）。
- 定位：**补充而非取代**直接引用/回调。有明确引用关系时直接调；EventBus 只用于**发布方与订阅方无引用关系**的弱耦合广播。

## 1. 候选横评

| 方案 | 类型安全 | payload | 退订方式 | once | 去重 | 快照派发(重入安全) | tap-all | 体积/依赖 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| **godot event_bus.gd**（对标） | 运行时(GDScript 无泛型) | 单 `Variant` | `unsubscribe(name,fn)` / `unsubscribe_all(target)` | ✅ | ✅ 幂等 | ✅ duplicate() 快照 | ✅ `event_published` signal | 零依赖 | 惰性剔除失效 Callable（Node GC 感知）；`namespace:event` 命名约定 + `EV_*` 常量 |
| **Node `EventEmitter`** | ❌(裸 string) | 变长 args | `off/removeListener` / `removeAllListeners` | ✅ | ❌ 允许重复 | 部分（emit 时对当前数组浅拷贝） | ❌ | Node 内置 | `setMaxListeners` 泄漏告警；`error` 事件特殊语义 |
| **mitt**（~200B） | ✅ 泛型 `Emitter<Events>` | 单 payload | `off(type,fn)` / 直接操作 `all` map | ❌ 需自封 | ❌ | ✅ `handlers.slice()` | ✅ `'*'` handler | 零依赖 | 极简，无 once/无优先级/无 target 绑定 |
| **eventemitter3** | 靠 `@types` 泛型 | 变长 args | `off/removeListener` | ✅ | ❌ | ✅ | ❌ | 零依赖 | 快、支持 `context` 绑定 this、`listenerCount` |
| **tiny-typed-emitter / typed-emitter** | ✅ 泛型包装 | 变长 args | 同 EventEmitter | ✅ | ❌ | 依底层 | ❌ | 薄壳 | 只是给 EventEmitter 套类型，运行时仍是老引擎 |
| **RxJS `Subject`** | ✅ 泛型 | 单值(流) | `Subscription.unsubscribe()` | 靠 `take(1)` | — | ✅ | — | 重(操作符全家桶) | 反应式流，能力远超"总线"，成本/心智负担高 → 过度设计 |
| **cc.EventTarget** | ❌ | 变长 args | `off/targetOff(target)` | ✅ | — | ✅ | ❌ | **属 `cc`** | 引擎内置，target 绑定好用，但**违铁律**不能进 core |
| **oops-framework `oops.message`** | ❌(裸 string) | 单 data | `off` | — | — | — | — | 框架内 | 全局门面单例风格，无类型 |

## 2. 逐轴结论（v1 取舍）

### 2.1 类型安全模型 —— **事件映射接口 + 泛型键**（本模块灵魂）
市面「类型安全」两条路：mitt 式**单 payload + `EventMap` 接口**，或 EventEmitter 式**变长 args + 元组类型**。
选 **mitt 式单 payload map**：
```ts
interface AppEvents { 'player:died': { score: number }; 'ui:ready': void }
bus.emit('player:died', { score: 1200 })  // 键、payload 双向编译期校验
```
理由：单 payload 类型推导最干净（变长 args 的元组类型在 TS 里易踩边界、IDE 提示差）；与 godot「单 Variant/Dictionary payload」一致；`void` 事件表达无载荷。**用法可复用同一份 `EventMap` 声明全项目共享**。

### 2.2 退订 —— **`on()` 返回 disposer 函数** 为主，`off(key,handler)` 为辅
现代库（mitt 变体/RxJS）都返回一次性退订句柄，配合 DI/生命周期最省心：`const d = bus.on(...); d()`。同时保留 Node 式 `off(key, handler)` 兼容手动管理。

### 2.3 生命周期清理 —— **不做 GC 自动剔除，改 `offAll(owner)` + scope**
godot 靠 `Callable.is_valid()` 惰性剔除被 `free()` 的 Node——**JS 无等价物**（WeakRef 太重且时机不可控）。故 v1：
- **不**自动剔除；未退订 = 内存泄漏由调用方负责（与所有 JS 事件库一致）。
- 提供 `offAll(owner)`：退订某 owner（this 绑定对象）的全部订阅，对应 engine 侧 `cc.Component.onDestroy()` 一行清理，替代 godot 的 `unsubscribe_all(target)`。
- 提供 `on(key, handler, { target })` 绑定 this + owner 标识。

### 2.4 派发语义 —— **同步 + 快照 + FIFO + 幂等去重**（照抄 godot，已被验证）
- **同步**派发（可预测、可测；异步留给调用方）。
- 派发前**快照**当前订阅：派发期间的 on/off 只影响下次 emit（重入安全）。
- **FIFO**：按订阅顺序触发。
- 同一 `(key, handler[, target])` 重复订阅**幂等**（去重），杜绝重复触发坑。

### 2.5 错误隔离 —— **隔离 + 经 ILogger 上报**（比 godot 更稳）
godot 直接 `call` 不隔离，一个监听者抛异常会中断整轮派发。v1 选**隔离**：`try/catch` 每个 listener，捕获后经 [[logger]] `error` 上报并继续派发剩余监听者——一个坏订阅不拖垮整条广播。（可留开关，默认隔离。）

### 2.6 tap-all（旁路监听全部事件）—— **首版留接口、可选实现**
godot `event_published` signal / mitt `'*'` 对调试面板、埋点有用，但增复杂度。v1 倾向 **`onAny(fn)`** 轻量支持（调试/埋点旁路），或首版砍掉推后——列 Open Question。

### 2.7 全局 vs 实例 —— **可 new 的实例 + DI token + 便捷默认**
`class EventBus` 可 `new`（模块内私有总线）；同时 `EVENT_BUS` token 注册一个全局实例 + `getEventBus()` 便捷取用，对齐 [[logger]] 的 `LOGGER`/`getLogger`。

### 2.8 命名约定 —— **沿用 `namespace:event`（过去时）**
直接采用 godot kit 级约定：`clock:day_changed`、`player:died`；kit 子系统保留命名空间，业务用自己的。TS 侧事件名是 `EventMap` 的字面量键，天然可自动补全 + 防拼错，**比 godot 的 `EV_*` 常量更强**（编译期即挡拼错），故不强制导出常量。

## 3. 首版 YAGNI（明确砍掉）

- **优先级排序**（priority）—— FIFO 够用，需要再加。
- **异步/队列派发**（下一帧 flush、microtask）—— 调用方自理。
- **通配/层级事件**（`a:*` 匹配）—— 复杂且易误用；只保留可选 `onAny`。
- **GC 自动剔除** —— JS 无 `is_valid()` 等价物，改 `offAll(owner)`。
- **RxJS 式操作符** —— 过度设计。

## 4. 对 creator-core-kit 的最终建议

自研纯 TS `EventBus`：**`EventMap` 泛型（类型安全灵魂）+ 单 payload + on 返回 disposer + off/offAll(owner) + once + 幂等去重 + 同步快照 FIFO 派发 + 错误隔离经 ILogger + `EVENT_BUS` token/`getEventBus()` 便捷**。语义骨架照抄经 godot 验证的 event_bus，类型安全用 TS 泛型补足 GDScript 缺的编译期校验，生命周期清理用 `offAll(owner)` 替 godot 的 GC 惰性剔除。详见 `docs/design/modules/eventbus.md`。
