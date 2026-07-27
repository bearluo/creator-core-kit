---
模块: object-pool
所在包: packages/core（纯 TS，零 cc）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 泛型对象池 createPool<T>——acquire/release/clear + reset/onAcquire/dispose 钩子 + prewarm/max；复用高频 new/丢弃的对象、削峰实例化开销与 GC 抖动。纯逻辑零 cc，被池化的可以是任意对象（cc.Node 由 engine/项目侧组合 factory 注入）。
何时读: 需要复用高频创建销毁的对象（子弹/敌人/粒子/DTO/临时结构），或想给某类实例做池化时。
日期: 2026-07-27
依赖: logger（告警经 ILogger）。无其它模块依赖。对标参照 godot-core-kit `systems/object_pool.gd`。
---

# ObjectPool 设计文档

## TL;DR

`createPool<T extends object>({ factory, reset?, onAcquire?, dispose?, max?, prewarm?, logger? })` 返回一个 `Pool<T>`：`acquire()` 优先复用空闲栈（LIFO）否则 `factory()` 新建，`release(obj)` 归还并 `reset`，`clear()` 释放空闲实例（各调 `dispose`）。**纯逻辑、零 cc**——池不关心 T 是什么（可以是 `cc.Node`、DTO、临时向量），归属判定靠内部借出集合 `Set<T>`（不在对象上打标记）。设了 `max` 且无空闲时 `acquire()` 抛 `PoolExhaustedError`（保持返回类型干净的 `T`）；默认不限、永不抛。

## Purpose（目标与定位）

- **做什么**：复用高频 spawn/despawn 的对象，避免反复 `new`/丢弃造成的分配开销与 GC 抖动（Web/WASM 下尤甚）。
- **定位/取舍**：core 只提供**泛型池逻辑**。godot 版直接池化 `Node`（引擎对象）——本框架守铁律，core 不识 `cc.Node`，故把「造/复位实例」抽象成 `factory`/`reset` 回调注入：池化 `cc.Node` 时由 engine/项目侧 `factory: () => instantiate(prefab)` 组合，core 不变。
- **与相邻模块**：独立子系统，可选。不依赖 EventBus/SceneFlow/Save。
- **YAGNI（首版砍）**：具名池注册表 `PoolManager`（按 key 管多个池，godot 的 `register(key,...)`）——首版只给单个 `Pool<T>`，多池由调用方用 `Map<string, Pool>` 组合，需要再抽门面；自动伸缩/闲置回收定时器；跨 bundle 全局池 token（需要时照 [[timer]] 加 `POOL` token）。

## Public API（TypeScript 精确签名）

```ts
export class PoolExhaustedError extends Error {}

export interface PoolOptions<T> {
  factory: () => T;              // 造新实例（空闲空且未达上限时）
  reset?: (obj: T) => void;      // 归还入池时清状态
  onAcquire?: (obj: T) => void;  // 借出时（复用或新建后都调）
  dispose?: (obj: T) => void;    // clear() 释放空闲实例时
  max?: number;                  // 总数(in-use+available)上限，>0 生效，0/省略=不限
  prewarm?: number;              // 注册时预建数，默认 0（超 max 收紧+告警）
  logger?: ILogger;              // 默认 getLogger('ObjectPool')
}

export interface Pool<T> {
  acquire(): T;                  // 达上限且无空闲 → 抛 PoolExhaustedError
  release(obj: T): void;         // 外来/重复/已在池内 → 告警 no-op
  clear(): void;                 // 释放空闲(调 dispose)+清空；在用的不受影响
  readonly size: number;         // in-use + available
  readonly available: number;
  readonly inUse: number;
}

export function createPool<T extends object>(opts: PoolOptions<T>): Pool<T>;
```

## Behavior & data flow（行为与数据流）

- **内部结构**：`free: T[]`（空闲栈，LIFO）+ `inUse: Set<T>`（借出集合，兼归属判定）。`size = free.length + inUse.size`。
- **acquire**：`free` 非空 → `pop()`（复用最近归还的）；否则若 `max>0 && size>=max` 抛 `PoolExhaustedError`，否则 `factory()` 新建。入 `inUse`，调 `onAcquire`。
- **release**：`inUse.has(obj)` 为假（外来对象/重复归还/未经 acquire）→ 告警 no-op，绝不抛；否则移出 `inUse`、`reset`、压回 `free`。
- **clear**：对 `free` 每个实例调 `dispose`，清空 `free`。在用的（`inUse`）不动，之后 `release` 仍能正常归还。
- **prewarm**：注册时 `factory()` N 个入 `free`；`max>0 && prewarm>max` → 收紧到 `max` + 告警。预热实例**不触发** `onAcquire`（尚未借出）。
- **归属判定不打标记**：godot 版在 `Node` 上 `set_meta` 标记归属；TS 版直接用 `Set<T>` 成员判定，故 **T 必须是对象引用类型**（`T extends object`）。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | 池化对象 | 绑死 cc.Node / **泛型 T + factory 注入** | **泛型 T** | 守铁律 core 零 cc；cc.Node 由 engine 组合 factory；顺带可池化任意对象 |
| 2 | 满且无空闲 | 返回 undefined / **抛 PoolExhaustedError** / 不限增长 | **抛错**（默认不限） | 返回类型保持干净的 T；逼调用方设对容量；默认无 max 永不抛（**定稿**） |
| 3 | 空闲结构 | 队列 FIFO / **栈 LIFO** | **LIFO** | 复用最近归还的、缓存局部性更好（对齐 godot pop_back） |
| 4 | 归属判定 | 对象打标记 / **Set 成员** | **Set** | 不侵入 T、不需反查表；代价：T 须为对象 |
| 5 | 复位时机 | acquire 时 / **release 时 reset** | **release** | 归还即净化，借出即可用；另留 onAcquire 兜住借出时逻辑 |
| 6 | 多池管理 | 内置具名注册表 / **单 Pool，调用方组合** | **单 Pool** | YAGNI；多池 = `Map<string,Pool>`，需要再抽 PoolManager 门面 |

## Platform considerations（全平台 / 小游戏兼容）

- 纯 TS（数组 + `Set`），node/web/所有小游戏/原生无差异。
- 无文件/网络 IO、无定时器、无 cc 依赖 → 天然全平台。
- 跨 bundle 共享同一池需走全局 token（本首版未做；照 ADR-0001 + [[timer]] 的 `TIMER` 模式加 `POOL` token 即可）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；`factory` 注入计数 spy，`reset`/`onAcquire`/`dispose` 用 `vi.fn()` 断言，告警注入 fake logger 断言。
- **用例**（11 条，见 `pool.test.ts`）：新建记账 / LIFO 复用 / release 调 reset + acquire 调 onAcquire / prewarm 预建 / prewarm 超 max 收紧+告警 / max 满抛 PoolExhaustedError + 归还后可再借 / 默认不限增长 / release 外来对象告警 no-op / 重复 release 告警 no-op / clear 调 dispose 清空且不影响在用 / clear 后可重新 acquire。

## Open Questions（已决议 · 2026-07-27 定稿）

1. **满且无空闲 acquire 行为**：✅ **抛 `PoolExhaustedError`**（返回类型保持 `T`；默认不设 max = 不限、永不抛）。
2. 多池注册表 `PoolManager`：缓做（YAGNI），需要时抽门面。

---

## 实现记录

- **落地文件**：`packages/core/src/pool/pool.ts`（`createPool` + `Pool`/`PoolOptions` + `PoolExhaustedError`）、`index.ts`；由 core `index.ts` re-export（第 2 批分组）。
- **最终 API 与设计偏差**：完全按定稿，无偏差。`createPool<T extends object>` 约束 T 为对象（Set 归属判定所需）。
- **测试结果 / 覆盖率**：`pool.ts` **Stmts/Branch/Funcs/Lines 全 100%**；11 条用例全绿。
- **commit / PR**：待提交。
- **遗留 Minors**：具名多池 `PoolManager` 门面、闲置自动回收、跨 bundle 全局 `POOL` token 留后续按需。
