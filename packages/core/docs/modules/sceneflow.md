---
模块: sceneflow
所在包: packages/core（纯 TS 流程状态机，零 cc）；真实场景/bundle 加载副作用由状态在钩子里发起（engine/项目侧）
状态: 已实现          # 草案 → 评审中 → 已定稿 → 已实现
摘要: 流程状态机 createSceneFlow——按名注册 FlowState（onEnter/onExit/onUpdate/onPause/onResume），transitionTo 切换 + 重入入队 + MAX_CHAIN 防死循环、事件转移表 dispatch（ANY_STATE 通配）、pushdown 栈 push/pop、每帧 update 转发。纯逻辑零 cc、确定性可测；切场景/加载 bundle 等副作用由状态自身发起。
何时读: 需要建模应用/游戏的高层流程（Boot→Login→Lobby→Battle→Settle）、菜单/暂停叠加、或任意有限状态机时。
日期: 2026-07-27
依赖: logger（诊断告警经 ILogger）。真实场景加载走 engine（cc.director.loadScene / BundleManager，后续）。对标参照 godot-core-kit `state_machine/kit_state_machine.gd` + `systems/scene_manager.gd`。
---

# SceneFlow 设计文档

## TL;DR

`createSceneFlow({ states?, onChange?, logger? })` 返回一个 `SceneFlow`：`add(state)` 按名注册状态、`start(initial)` 进入初始态、`transitionTo(name)` 做 `exit(cur)→enter(new)`、`dispatch(event)` 走事件转移表（`addTransition(from,event,to)`，`from` 可为 `ANY_STATE` 通配）、`push/pop` 是暂停语义的 pushdown 栈、`update(dt)` 把帧驱动转发给当前态。**纯逻辑零 cc**：这是「决策核心」，同步、确定性、可脱引擎单测；**切场景/加载 bundle 等异步副作用由状态自身在 `onEnter` 里发起**，完成后再 `transitionTo`——FSM 不 await、不持有 cc。转换同步 + 重入入队（`MAX_CHAIN` 防死循环）、栈深 `MAX_STACK` 守卫，均照抄 godot 验证过的语义。

## Purpose（目标与定位）

- **做什么**：给「高层流程/状态」建模——启动流程、登录、大厅、战斗、结算之间的迁移，以及暂停/弹窗这类叠加态。也可当通用 FSM 用（实体 AI 等）。
- **定位/取舍**：godot 分成 `KitStateMachine`（通用 FSM，靠 Node 子节点组装）+ `SceneManager`（`change_scene_to_*` 实际切场景）。本框架守铁律 core 不能切 cc 场景，故 **core 只落「通用流程 FSM」**（`SceneManager` 的实际 `cc.director.loadScene`/过渡遮罩属重 cc → 按 ADR-0002 走 engine + apps/demo，不进这轮）。状态是**纯数据对象**（实现 `FlowState` 接口），不是 `cc.Component`——改用 `onEnter(from, flow)` 传入 flow 引用做自转，替代 godot 的 `child.machine = self`。
- **异步副作用怎么办**：`transitionTo` **同步**。需要加载场景/bundle 的态在 `onEnter` 里 fire 异步任务（`await bundle.load(...)`），完成回调里再 `flow.transitionTo('Battle')`。FSM 保持同步确定性，异步只活在状态体内——这是 FSM 与副作用解耦的经典做法。
- **YAGNI（首版砍）**：async transitionTo（转换串行化 + await 期重入语义，复杂度陡增，见决策 #2）；过渡动画/遮罩（View/engine）；状态历史/回退栈之外的持久化；状态注入 DI 容器自动装配。

## Public API（TypeScript 精确签名）

```ts
export const ANY_STATE = '*';

export interface FlowState {
  readonly name: string;
  onEnter?(from: string, flow: SceneFlow): void;  // from=上一态（初始进入''）；flow 便于自转/派发
  onExit?(to: string): void;                       // to=将进入的态（stop 收尾为''）
  onUpdate?(dt: number): void;                     // 仅当前态收到
  onPause?(): void;                                // 被 push 压栈让位
  onResume?(): void;                               // 经 pop 弹回复活
}

export interface SceneFlow {
  readonly current: string;      // 当前态名，''=未启动/无
  readonly stackDepth: number;
  readonly started: boolean;
  add(state: FlowState): SceneFlow;                // 链式；重名/保留名告警忽略
  start(initial: string): void;                    // 未知/已启动告警 no-op
  transitionTo(name: string): void;                // 未知告警 no-op；转换中入队
  addTransition(from: string, event: string, to: string): void;  // from 可为 ANY_STATE
  dispatch(event: string): boolean;                // 命中转移 true，否则 false
  push(name: string): void;                        // pushdown（未知/转换中/无当前态/栈满告警 no-op）
  pop(): void;                                      // 栈空/转换中告警 no-op
  update(dt: number): void;                        // 转发当前态 onUpdate
  isIn(name: string): boolean;
  has(name: string): boolean;
  stop(): void;                                    // exit 当前态、清栈与队列、started=false
}

export interface SceneFlowOptions {
  states?: FlowState[];
  onChange?: (from: string, to: string) => void;   // 每次转换后（含初始进入 from='')
  logger?: ILogger;
}
export function createSceneFlow(opts?: SceneFlowOptions): SceneFlow;
```

## Behavior & data flow（行为与数据流）

- **内部结构**：`states: Map<name, FlowState>`、`transitions: Map<"from|event", to>`、`stack: string[]`（pushdown 挂起态名）、`pending: string[]`（转换执行中收到的后续转换）、`current`、`transitioning`、`started`。
- **runTransition(from, to)**：置 `transitioning=true`；循环：`chain>=MAX_CHAIN(8)` → 告警 error + 清 pending + break（防死循环）；`current.onExit(next.name)` → `current=next` → `current.onEnter(oldName, flow)` → `onChange(oldName, current.name)`；若 `pending` 非空取队首作下一 `next`（支持「决策态」在 `onEnter` 里立即转走）。收尾 `transitioning=false`。
- **transitionTo**：未知名告警 no-op；`transitioning` 时入 `pending`（当前转换后按序消化）；否则 `runTransition`。
- **dispatch(event)**：无当前态返回 false；先查 `(cur,event)` 再查 `(ANY_STATE,event)`；命中则（转换中入队 / 否则 runTransition）返回 true，无匹配返回 false。
- **push/pop（pushdown，暂停语义）**：`push` → `cur.onPause()` → 压栈 → `current=new` → `new.onEnter`（不占 MAX_CHAIN、不复位现场）；`pop` → `cur.onExit(restored)` → 弹栈 → 切回 → `restored.onResume()`。守卫：未知/转换中/无当前态/栈满(`MAX_STACK=32`) 对 push、栈空/转换中对 pop，均告警 no-op。
- **update(dt)**：仅 `current.onUpdate(dt)`（由 engine 把 `ITimer.onFrame`/`cc.director` 帧转发进来）。
- **stop**：清 pending + stack，`current.onExit('')` 后置空，`started=false`（状态注册保留，可再 start）。
- **与 cc 边界**：全在 core（Map/数组/字符串，零 cc）。engine/项目侧：把 `getTimer().onFrame(dt => flow.update(dt))` 接上；在 `LoadingState.onEnter` 里调 engine 的 bundle/scene 加载，完成回调 `flow.transitionTo(...)`。

## Key design decisions（决策表）

| # | 维度 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| 1 | core/engine 切分 | core 直接切 cc 场景 / **core 只做 FSM，切场景在状态体内经 engine** | **只做 FSM** | 守铁律；重 cc（loadScene/过渡遮罩）按 ADR-0002 走 apps/demo |
| 2 | 转换同异步 | **同步** / async transitionTo | **同步**（**定稿**） | 对齐 godot；FSM 保持确定性 + 简单重入队列；异步副作用活在状态 onEnter 里，完成后再 transitionTo |
| 3 | 状态载体 | cc.Component 子节点 / **纯对象 FlowState** | **纯对象** | 零 cc、可脱引擎单测；flow 引用经 onEnter 传入替代 godot 的 machine 字段 |
| 4 | 重入 | 拒绝/抛 / **入队 pending + MAX_CHAIN** | **入队** | 支持「决策态」进入即转走；MAX_CHAIN=8 防死循环（照抄 godot）|
| 5 | 事件驱动 | 只有命令式 transitionTo / **叠加事件转移表 dispatch** | **叠加** | 解耦触发与目标；ANY_STATE 通配兜底（如全局 esc→menu）|
| 6 | pushdown 栈 | 无 / **push/pop 暂停语义** | **有** | 暂停/弹窗叠加常见；MAX_STACK=32 防无限 push |
| 7 | 帧驱动 | 内部订阅 timer / **外部 update(dt) 转发** | **外部转发** | 保持 core 零依赖 + 确定性；engine 决定接哪个帧源 |
| 8 | 变更观察 | 强绑 EventBus / **可选 onChange 回调** | **onChange 回调** | 不强耦合具体事件表；需要广播时项目侧在 onChange 里转发 EventBus |

## Platform considerations（全平台 / 小游戏兼容）

- 纯 TS（Map/数组），全平台无差异。
- 帧驱动源由 engine 按平台提供（cc.director 已抹平）；无 setTimeout/无 cc 依赖。
- 真实场景切换/过渡在 engine 侧实现，受平台资源加载差异影响 → 留 apps/demo 集成验证（ADR-0002）。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc；状态钩子用记录数组断言调用序列，`onChange` 断言迁移，告警注入 fake logger。
- **用例**（21 条，见 `sceneflow.test.ts`）：start 进入初始态 + onChange；transitionTo 的 exit→enter 顺序 + from/to；未知态告警 no-op；重入 onEnter 里 transitionTo 入队连转；MAX_CHAIN 死循环拦截；dispatch 命中/未命中/ANY_STATE 兜底/无当前态 false；addTransition 目标未注册+重复覆盖告警；update 仅当前态收到；push/pop 暂停恢复 + onChange；push/pop 无当前态/栈空告警；push/pop 转换进行中拒绝；MAX_STACK 栈满；stop 清理；add 重名/保留名；start 已启动/未知；isIn/has/opts.states 批量。

## Open Questions（已决议 · 2026-07-27 定稿）

1. **转换同异步**：✅ **同步**（异步副作用由状态 onEnter 发起，完成后 transitionTo）。
2. 真实场景加载/过渡遮罩的 engine 适配：缓到 apps/demo（ADR-0002 重 cc → 集成层）。
3. 是否强绑 EventBus 广播状态变更：否，用可选 `onChange` 回调，项目侧按需转发。

---

## 实现记录

- **落地文件**：`packages/core/src/sceneflow/sceneflow.ts`（`createSceneFlow` + `FlowState`/`SceneFlow`/`SceneFlowOptions` + `ANY_STATE`）、`index.ts`；由 core `index.ts` re-export。
- **最终 API 与设计偏差**：按定稿。一处收敛——`onExit(to)` 不传 `flow`（离开态无需自转，与 godot exit 一致；onEnter 才传 flow）。
- **测试结果 / 覆盖率**：`sceneflow.ts` Stmts/Funcs/Lines **100%**、Branch **95.89%**（剩余为默认注入 logger / pop 时 current 恒非空这类防御分支，按 batch-1 既定尺度接受）；21 条用例全绿。
- **commit / PR**：待提交。
- **遗留 Minors**：过渡遮罩（对标 godot SceneManager）、async transitionTo 双轨如后续确有需要再评。真实场景切换 engine 半已实现（见下）；engine 侧 `getTimer().onFrame → flow.update` 帧驱动接线随项目。

### engine 半适配（director 切场景 promisify，2026-07-28）

- **落地文件**：`packages/engine/src/scene-loader.ts`——`loadScene(name)` / `preloadScene(name)`，把 `cc.director.loadScene` / `preloadScene` promisify；engine `index.ts` 导出。**无 DI token**——切场景是 engine 直接行为，core 的 SceneFlow 是纯状态机，由 `FlowState` 在 `onEnter`/钩子里调本 helpers 发起副作用（对齐 sceneflow.ts「状态自发副作用」设计）。
- **实现**：`loadScene` 包 `director.loadScene(name, cb)` 的回调为 Promise，`director.loadScene` 返 false（场景未在 build 设置）时 reject 明确错误；`preloadScene` 同理。
- **类型策略**：官方 `@cocos/creator-types@3.8.7`（`Director.OnSceneLaunched` 等）（ADR-0005）。
- **验证**：四门全绿；**真机 gameView 预览已验证** 错误路径：`✅ loadScene 未知场景优雅 reject: 场景未找到…`（证明 promisify + false-path）。真切场景（成功加载第二场景）待 apps/demo 加一个第二场景并入 build 设置做端到端验证。
