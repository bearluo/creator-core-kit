---
模块: ecs
所在包: packages/ecs-bitecs
状态: 已实现
摘要: 把 bitECS v0.3 封装为 kit 扩展包 @cck/ecs-bitecs——re-export bitECS 全套 + 一层极薄 kit 接入胶水（EcsRunner：维护 world.time + pipe 驱动，宿主每帧喂 tick）。性能优先（SoA），示范「第三方高性能能力如何接入 creator-core-kit」，游戏逻辑不跨 bundle。
何时读: 要用/评审 ECS 扩展、给项目接 ECS、或后续接寻路/碰撞/ORCA 时。
日期: 2026-07-28
依赖: bitecs@0.3.x（npm 直依赖）；kit 帧驱动（engine 侧 director UPDATE，或 ITimer）喂 tick；选型依据见 docs/research/2026-07-28-ecs-survey.md
---

# ECS 扩展（@cck/ecs-bitecs）设计文档

> **实现状态（2026-07-29）**：**已实现**——kit 主体三批地基完工（DI/Bootstrap/ITimer 接缝齐全），本包落地：pin `bitecs@0.3.40`、re-export 全套 + `createEcsWorld`/`createEcsRunner` 薄接入胶水，6 vitest 用例全绿（含「ITimer.onFrame 驱动 runner」的 kit 接入证明），四门全绿（全仓 369）、`dist` 33KB 自包含（noExternal 打进 bitecs）。**demo 的 cc 渲染场景（大量 agent 移动 + Position→cc.Node 同步）仍留后续**——按设计定位「用真实游戏反哺 kit」的增量，需先定玩法 + 真机验证；本包纯逻辑已 node 全测，不阻塞。详见文末「实现记录」。

## TL;DR

- **是什么**：把 bitECS v0.3 打包成 kit 的**独立扩展包** `@cck/ecs-bitecs`。项目要用 ECS **只加这一个依赖**，不直接装 bitecs、不改 core。
- **关键 API 一瞥**：`export * from 'bitecs'`（拿到全套 bitECS）+ `createEcsWorld()`（createWorld + world.time 初始化）+ `createEcsRunner(world, systems)`（返回 `{ world, tick(dtSec) }`，宿主每帧喂 dt）。
- **给谁用**：想用 ECS 建高性能数值系统（后续寻路/碰撞/ORCA）的项目；同时作「外部能力接入 kit 生命周期」的样板。
- **取向**：性能优先（bitECS SoA/TypedArray），DX 弱是已知代价（§选型 survey）。逻辑不跨 bundle → 组件模块级单例 identity 天然一致。

## Purpose（目标与定位）

- **做什么**：给 kit 提供一个可选的、高性能的 ECS 能力，并**示范第三方库如何接入 kit**（挂到 kit 的每帧生命周期、经统一时间步驱动）。
- **定位**：**不进 `packages/core`**（不是地基），作平级扩展包。core 的「零 cc」铁律不直接约束它，但本包**仍是纯 TS / 纯数据、可 node/vitest 直测**（守「逻辑可脱引擎测」精神）。
- **为什么选 bitECS v0.3**：性能最快梯队（SoA、零 GC、连续内存）契合后续寻路/碰撞/ORCA 的每帧大量 agent 数值运算；v0.3 长期稳定、第三方集成示例多、好照抄（选型全过程见 `docs/research/2026-07-28-ecs-survey.md`）。
- **YAGNI（首版砍）**：
  - **渲染同步 system**（Position→`cc.Node`）→ 归 engine/`apps/demo`，不进本包纯逻辑。
  - **网络同步**（bitECS `defineSerializer`/`defineDeserializer`）→ 首版只靠 re-export 让项目能用，不做 kit 胶水。
  - **寻路 / 碰撞 / ORCA** → 后续各自 system + 空间结构（grid/KD-tree），不在本包首版；本包只给底座 + 接入范式。
  - **全局 DI token / getWorld** → World 是实例作用域（可多个 world），不做全局单例；需要共享时项目自行 `register`。
  - **多 pipeline / stage 依赖编排** → `pipe` 够用。

## Public API（TypeScript 精确签名）

```ts
// 直接透传 bitECS v0.3 全套（createWorld / defineComponent / Types / defineQuery /
// addEntity / addComponent / removeComponent / hasComponent / removeEntity /
// enterQuery / exitQuery / Not / Changed / Or / pipe / defineSerializer / defineDeserializer …）
// —— 项目只引 @cck/ecs-bitecs 即拿到全部 bitECS API，不必再单独依赖 bitecs。
export * from 'bitecs'
import type { IWorld } from 'bitecs'

/** bitECS system 契约：接收并返回 world（供 pipe 串联）。 */
export type EcsSystem = (world: EcsWorld) => EcsWorld

/**
 * kit 约定的 world：在裸 IWorld 上挂 time。
 * 单位一律为**秒**（对齐 kit ITimer/dt 约定，偏离 bitECS README 的毫秒示例——
 * 所以 system 里 `Velocity.x[eid] * world.time.delta` 得到「每秒速度 × 秒」）。
 */
export interface EcsWorld extends IWorld {
  time: { delta: number; elapsed: number }
}

/** createWorld() + 初始化 world.time={delta:0,elapsed:0}。 */
export function createEcsWorld(): EcsWorld

/**
 * 极薄接入胶水：把一组 system 组成 pipeline，交给宿主每帧驱动。
 * 不自己拿时钟——由宿主（engine 帧回调 / ITimer / 测试）调 tick(dt) 喂时间步（接缝）。
 */
export function createEcsRunner(
  world: EcsWorld,
  systems: EcsSystem[],
): {
  readonly world: EcsWorld
  /** 宿主每帧调：设 world.time.delta=dtSec、累加 elapsed，然后跑 pipeline(world)。 */
  tick(dtSec: number): void
}
```

> facade 刻意**极薄**（ponytail）：bitECS 的 `addEntity`/`defineComponent`/`defineQuery` 等是稳定函数式 API，包一层只增样板无收益——直接 re-export。本包只补 bitECS **没有**的三件事：① `world.time` 秒制初始化，② pipeline 组装 + 每帧驱动壳，③ 与 kit 生命周期对接的 `tick(dt)` 接缝。

## Behavior & data flow（行为与数据流）

**一帧的数据流**：
1. 宿主帧源 → `runner.tick(dt)`（dt 秒）。
   - **engine/真机**：`director.on(Director.EVENT_UPDATE, (dt) => runner.tick(dt))` —— 这段胶水在 `apps/demo`/engine，**不在本包**（本包只暴露 `tick`）。
   - **测试/固定步长**：直接 `runner.tick(1/60)`，或项目用 `timer.interval(step, () => runner.tick(step))`。
2. `tick` 内：`world.time.delta = dt; world.time.elapsed += dt`。
3. `pipe(...systems)(world)` 按注册序跑每个 system。
4. 每个 system 内 `defineQuery([...])(world)` 拿 eid 数组，循环读写组件 SoA（`Comp.field[eid]`）。
5. 渲染：engine 侧一个 render system 把 `Position.x[eid]` 同步到对应 `cc.Node`（**在 engine/demo**，本包不涉 cc）。

**组件与 identity**：bitECS v0.3 `defineComponent` 返回模块级对象作查询 key。因**ECS 游戏逻辑不跨 bundle**（用户定），组件定义都在同一 bundle 内、identity 天然一致，无跨 bundle 分裂问题（对比 ADR-0001 场景不适用于本包）。

**core vs engine 归属**：本包**全部是纯逻辑**（world/component/system/runner，零 cc）；唯一的引擎接触点（帧驱动接线、render system）在 engine/`apps/demo`，经 `runner.tick(dt)` 这个接缝对接。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 库 | bitECS v0.3 / miniplex / koota | **bitECS v0.3** | 性能优先、SoA 契合寻路/碰撞/ORCA、稳定+示例多（survey 定案） |
| 2 | 包定位 | 进 core / 独立扩展包 | **独立扩展包 `@cck/ecs-bitecs`** | 不是地基；作「第三方接入 kit」范例；项目只引一个包 |
| 3 | facade 厚度 | 全量封装 / re-export + 薄胶水 | **re-export + 薄胶水** | bitECS API 已稳定，重造只增样板；只补 time+驱动+接缝 |
| 4 | 时间单位 | 毫秒(bitECS 示例) / 秒(kit) | **秒** | 对齐 kit ITimer/dt，避免混用；system 积分单位统一 |
| 5 | 帧驱动 | runner 自持时钟 / 宿主喂 tick | **宿主喂 `tick(dt)`** | 接缝可测（假 dt 确定性）、engine 帧与 core 逻辑解耦 |
| 6 | World 作用域 | 全局 DI 单例 / 实例作用域 | **实例作用域，无全局 token** | 可多 world；需要共享项目自行 register |
| 7 | 网络/渲染/寻路 | 首版做 / 后续 | **后续** | 首版只给底座+接入范式，避免过早铺开 |

## Platform considerations（全平台 / 小游戏兼容）

- **纯 TypedArray**，无 `SharedArrayBuffer` → **无 COOP/COEP 跨源隔离约束**（这是相对 becsy/thyseus 的关键落地优势），微信/抖音小游戏 runtime 对 TypedArray 支持良好，原生/Web 通吃。
- **node 可测**：纯数据结构，vitest 直接跑，不需 Creator。
- **三种热**：ECS 逻辑不跨 bundle → 组件定义随本扩展包走；线上热更时按整包版本化更新（不涉跨 bundle 组件共享）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：本包零 `cc`，纯 node 测；帧驱动经 `runner.tick(dt)` 注入假 dt，确定性、无真实时钟。re-export 的 bitECS 自身不测（上游职责）。
- **用例清单**：
  1. `createEcsWorld()` → `world.time` 为 `{delta:0, elapsed:0}`。
  2. `addEntity` + `addComponent(world, Position, eid)` → `hasComponent` 为 true；`Position.x[eid]` 可写可读。
  3. `defineQuery([Position, Velocity])(world)` 含该 eid；`removeComponent`/`removeEntity` 后不再含。
  4. movementSystem：`runner.tick(0.5)` 后 `Position.x[eid] === Velocity.x[eid] * 0.5`（秒制积分正确）。
  5. `runner.tick` 多次 → `world.time.elapsed` 累加、`delta` 为最近一帧 dt。
  6. `pipe` 多 system 按注册序执行（用记录序列的 spy system 验证）。
  7. 固定步长驱动：core `createTimer()` + `timer.interval(step, ()=>runner.tick(step))` + `timer.tick(n*step)` → 跑 n 次。
- **覆盖率**：本包非 core、非 CI 硬门槛，但目标覆盖自有逻辑（`createEcsWorld`/`createEcsRunner`/time 累积/pipeline 顺序）；re-export 部分不计。

## Open Questions（待用户拍板）

> 三条均为**实现后仍保留的后续项**——首版（re-export + 薄 kit 胶水 + 纯逻辑测试）不涉及，故不阻塞本次落地。

1. **demo 玩法（方向已定，具体待启动时定）**：demo 分多场景 / 多 bundle 承载不同游戏、反哺 kit；ECS 样例的具体玩法（群体避障 / 弹幕 / RTS 小兵）留到 demo 场景启动时再定。
2. **寻路/碰撞/ORCA 接入次序与形态**：作为本包内的可选 system 子模块，还是各自独立子包？（后续设计，先记）
3. **网络同步**是否要在本包提供 `defineSerializer` 的 kit 胶水（对接已有 Network 模块的 seq/codec），还是留项目自装？

---

## 实现记录（2026-07-29）

- **最终 API 与设计偏差**：
  - **API 与设计一致**：`export * from 'bitecs'` + `createEcsWorld()` + `createEcsRunner(world, systems) → { world, tick(dtSec) }` + 类型 `EcsWorld`/`EcsSystem`/`EcsRunner`。源码 `src/world.ts`（胶水）+ `src/index.ts`（barrel）。
  - **偏差①（runner 内部）**：用**有序 `for` loop** 顺序跑 system，替代设计数据流写的 `pipe(...systems)(world)`——三者等价（system 均返回同一 world）、但 loop 类型安全（避开 bitECS `pipe` 的 `(...args:any[])=>any` 签名）、空数组天然安全。bitECS `pipe` 仍 re-export，供项目自行组合 pipeline（决策 #3 的「pipe 够用」不变，只是不下沉进 runner）。
  - **偏差②（打包）**：bitecs 经 tsup `noExternal:['bitecs']` **打进 dist**（33KB，运行时自包含），非 external——ECS 逻辑不跨 bundle、无 core/cc 的跨 bundle 单例约束（[[adr-0001]]），内联最省事、兑现「一站式」。类型侧 `dist/index.d.ts` 仍 `export * from 'bitecs'`（rollup-plugin-dts 不 inline star re-export，`dts.resolve` 对 `export *` 无效），经 bitecs 传递依赖解析——bitecs 是本包 **pinned dependency**，随本包一并装入，故 TS 侧同样「只需 @cck/ecs-bitecs」。
  - **版本**：pin `bitecs@0.3.40`（精确、无范围）——最后一个稳定 0.3.x（0.3.16 之后无 alpha 断层，0.3.40 为线尾）；npm `latest` 已是 0.4.0（非平凡重写），但范例取向是「稳定 + 第三方寻路/碰撞/ORCA 示例多为 v0.3 写法、好照抄」，故锁 0.3；精确 pin 防范例漂移（选型见 [survey](../../../../docs/research/2026-07-28-ecs-survey.md) 决策表 Q2）。
- **测试结果 / 覆盖率**：本包**非 core、非 CI 硬门槛**（vitest coverage.include 仅 `packages/core/src/**`）；`src/__tests__/ecs.test.ts` **6 用例全绿**：① `createEcsWorld` time 初始化 ② 增删组件 + 查询命中/落空（实证 bitECS `removeComponent` 同步更新查询、`removeEntity` 后 `hasComponent`=false）③ movementSystem 秒制积分 `tick(0.5)→x+=v*0.5`（f32 精确）④ `tick` 累加 elapsed、delta 取最近帧 ⑤ 多 system 注册序 ⑥ **接入 kit 帧驱动**：`ITimer.onFrame(dt=>runner.tick(dt))` 驱动（等同 engine `driveWithDirector`→`timer.tick`→onFrame），`dispose()` 后冻结。设计 7 用例合并为 6（固定步长驱动并入 kit 帧驱动、用 `onFrame` 而非 `interval`，更贴真实接线）。**四门全绿**：typecheck 0 / lint 0 / test 369 passed（+6）/ build OK（dist 33KB 自包含）。
- **commit / PR**：待授权（本次实现完成，尚未提交）。
- **遗留 Minors**：
  - **demo 场景（cc 渲染大量 agent 移动）未做**——设计定位为「用真实游戏反哺 kit」的后续增量：需先定玩法 + engine 侧 render system（`Position.x[eid]`→`cc.Node`，在 demo/engine，本包不涉 cc）+ 真机验证。本包纯逻辑已 node 全测，engine 帧接线一行（`director`/`ITimer.onFrame` → `runner.tick(dt)`）已由用例 ⑥ 证明。
  - 寻路 / 碰撞 / ORCA 等高性能 system + 空间结构（grid/KD-tree）后续增量接，每接一个即一份「高性能系统接入 kit」样板（Open Questions #2）。
  - 网络同步（bitECS `defineSerializer`/`defineDeserializer` 对接 Network 的 seq/codec）留项目自装，暂不提供 kit 胶水（Open Questions #3）。
