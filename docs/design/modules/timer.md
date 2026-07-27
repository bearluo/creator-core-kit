---
模块: timer
所在包: packages/core（ITimer 接口 + 外部 tick 驱动的 TimerService 默认实现，零 cc） + packages/engine（Bootstrap 用 cc.director 转发 dt，后续）
状态: 已定稿          # 草案 → 评审中 → 已定稿 → 已实现
摘要: ITimer 定时器/帧回调抽象——delay/interval/onFrame/now + timeScale/pause；核心是外部 tick(dt) 驱动的纯逻辑 TimerService（engine 喂 cc 循环 dt，测试手动推进虚拟时间）；TIMER token / getTimer() 便捷。
何时读: core 逻辑要延迟/周期/每帧执行、要帧率无关的时间推进、要暂停/慢放定时、engine 接游戏循环驱动定时器时。
日期: 2026-07-27
依赖: di-container（TIMER 走 DI 注入/覆盖）；logger（错误隔离经 ILogger 上报）；eventbus（复用其 Disposer 类型）；架构总纲 §3.1 ITimer；横评 docs/research/2026-07-27-timer-survey.md
---

# ITimer 设计文档

## TL;DR

core 定义 `ITimer`（消费面：`delay`/`interval`/`onFrame`/`now` + `timeScale`/`paused`）+ `ITimerDriver`（驱动面：`tick(dt)`），并自带**外部 tick 驱动的纯逻辑 `TimerService`**（同时实现两者）。这是本模块灵魂——计时器**不自己持有真实时钟**，而是由外部每帧喂 `tick(dt)`：engine 在 `cc.director` 的帧回调里转发真实 dt，测试直接 `tick(0.016)` 推进虚拟时间。故 core 零 cc、可确定性单测、平台无关，且天然支持 `timeScale`/`pause`（暂停即冻结、慢放即缩放）。消费方经 `TIMER` token / `getTimer()` 取用（对齐 [[logger]]/[[eventbus]] 的 DI 范式），但看不到 `tick`（防误调）。退订用 disposer、tick 快照重入安全、回调错误隔离——均沿用 [[eventbus]] 验证过的接缝。

## Purpose（目标与定位）

- **做什么**：给 core 业务逻辑提供「延迟执行 / 周期执行 / 每帧回调 / 拿累计时间」，且**不碰** `cc.director`/`setTimeout`（架构总纲 §3.1 明令）。
- **定位/取舍**：这是**第一个真正需要 engine 适配的接口**（DI/Logger/EventBus 可全落 core）。正解 = **驱动源抽象成 `tick(dt)` 入口**：core 只管「给我 dt，我推进任务」，真实 dt 由 engine 注入。参照 tween.js「外部 `update(time)` → 可测」+ godot game_clock「time_scale × accum 累加」。
- **YAGNI（首版砍）**：帧降频错峰 + 每帧预算任务队列（godot frame_scheduler 的性能设施 → 独立 FrameScheduler 后续）、世界日历时钟（game_clock → 内容层）、unscaled 定时、真实墙钟 `Date.now`（离线结算归 SaveManager）、缓动 tween（View 层）、协程/async 定时。理由见横评 §3。

## Public API（TypeScript 精确签名）

```ts
import type { Disposer } from '../eventbus'; // 复用 eventbus 的 Disposer（() => void），避免重复导出冲突

/** 消费面：业务代码拿到的定时器视图（看不到 tick，防误调驱动）。 */
export interface ITimer {
  /** 累计逻辑时间（秒）。受 timeScale/pause 影响：暂停时不增长。 */
  readonly now: number;
  /** 时间缩放（>=0，非法值夹到 0）。tick 时 effectiveDt = paused ? 0 : dt * timeScale。默认 1。 */
  timeScale: number;
  /** 暂停开关：true 时 effectiveDt=0，所有定时/onFrame 冻结（不推进、不触发）。默认 false。 */
  paused: boolean;

  /** seconds 后触发一次 cb；seconds<=0 视为下次 tick 触发。返回 disposer（调用即取消，幂等）。 */
  delay(seconds: number, cb: () => void): Disposer;
  /** 每 seconds 触发 cb（首触发在 seconds 后）。seconds<=0 抛错（防退化死循环）。返回 disposer。 */
  interval(seconds: number, cb: () => void): Disposer;
  /** 每次 tick 触发 cb，收 effectiveDt（秒）。返回 disposer。冻结帧（effectiveDt<=0）不触发。 */
  onFrame(cb: (dt: number) => void): Disposer;

  /** 清空全部定时任务 + 帧回调（不重置 now/timeScale/paused）。场景切换重置用。 */
  clear(): void;
}

/** 驱动面：只有游戏循环 driver（engine）/测试持有，负责推进时间。 */
export interface ITimerDriver {
  /** 推进时间：engine 每帧喂真实 dt（秒）；测试手动调。内部按 effectiveDt 推进 now、触发到期任务与 onFrame。 */
  tick(dt: number): void;
}

/** 造定时器（同时实现消费面 + 驱动面）。onError 默认经 getLogger('Timer').error 上报（错误隔离）。 */
export function createTimer(opts?: {
  onError?: (err: unknown) => void;
}): ITimer & ITimerDriver;

/** DI token：注入的是消费面 ITimer（engine Bootstrap register 一个 TimerService）。 */
export const TIMER: Token<ITimer>;

/**
 * 便捷取用：优先 getRootContainer().tryResolve(TIMER)；未注册则用进程级默认 TimerService。
 * ⚠ 与 Logger/EventBus 不同：ITimer **必须有人 tick 才走时**——engine Bootstrap 须 register(TIMER,…)
 * 并把 cc.director 的 dt 接到该实例的 tick()。默认 fallback 实例无人驱动则定时永不触发。
 */
export function getTimer(): ITimer;
```

## Behavior & data flow（行为与数据流）

- **内部结构**：`_now`（累计秒）；`_tasks: Task[]`，`Task = { due, interval|null, cb, alive }`（`due` = 触发的 `_now` 绝对阈值，`interval=null` 为一次性）；`_frameCbs: FrameCb[]`。
- **注册**：`delay(s,cb)` → push `{ due:_now+max(0,s), interval:null }`；`interval(s,cb)`（s>0）→ `{ due:_now+s, interval:s }`；`onFrame(cb)` → push `_frameCbs`。各返回绑定到该记录对象 + `disposed` 标记的 disposer（精确移除、幂等、不误伤新注册——照 [[eventbus]]）。
- **tick(dt)**：
  1. `effectiveDt = paused ? 0 : dt * timeScale`；`if (effectiveDt <= 0) return`（冻结帧：不推进、不触发任何）。
  2. `_now += effectiveDt`。
  3. **onFrame**：`_frameCbs.slice()` 快照后逐个 `cb(effectiveDt)`，`try/catch` 隔离。
  4. **定时任务**：`_tasks.slice()` 快照；对每个 alive 任务 `while (alive && due <= _now)`：触发 `cb()`（隔离）→ 一次性置 `alive=false`，周期 `due += interval`（一帧内可补触发多次，追平大 dt）。
  5. 末尾 compact：`_tasks = _tasks.filter(t => t.alive)`。
- **重入安全**：tick 用 slice 快照 → 回调里新增的定时/onFrame 只影响**下一次** tick；回调里 cancel 的（`alive=false` / 从实时数组删）本轮快照仍可能引用但按标记跳过（照抄 frame_scheduler「keys() 本帧快照」）。
- **错误隔离**：每个 cb 包 `try/catch` → `onError`（默认 `getLogger('Timer').error`），一个坏定时不拖垮整轮 tick。
- **消费/驱动分离**：`createTimer()` 返回 `ITimer & ITimerDriver`，engine driver / 测试持有完整实例调 `tick`；注入容器的 `TIMER` token 类型是 `ITimer`（消费方 `getTimer()` 拿不到 `tick`，杜绝业务误调驱动）。
- **与 cc 边界**：`TimerService` 全在 core（`Map`/数组/算术，零 cc）。engine 侧 **Bootstrap**：`const t = createTimer(); container.register(TIMER, { useValue: t }); cc.director.on(Director.EVENT_AFTER_UPDATE, () => t.tick(director.getDeltaTime()))`（或常驻 Component 的 `update(dt)`）。core 只认 `ITimer`/`TIMER`。

## Key design decisions（决策表）

| # | 维度 | 选项 | 推荐默认 | 一句话理由 |
|---|---|---|---|---|
| 1 | 驱动模型 | 自持 rAF/setTimeout / **外部 tick(dt) 驱动** | **外部 tick** | 零 cc + 可确定性单测 + 平台无关 + 天然支持暂停/缩放（tween.js/game_clock 验证） |
| 2 | 时间单位 | ms / **秒(float)** | **秒** | 对齐引擎惯例（cc dt/schedule、godot delta、Unity），免 ms/秒混用坑 |
| 3 | 能力集 | 全家桶 / **delay+interval+onFrame+now** | **四件套** | 覆盖 90% 游戏定时；语义借 cc scheduleOnce/schedule |
| 4 | timeScale/pause | 无 / **有（冻结即暂停、缩放即慢放）** | **有** | 游戏内定时直觉（暂停时倒计时同停）；对齐 game_clock/Unity |
| 5 | 冻结帧 onFrame | 收 dt=0 仍调 / **完全不触发** | **不触发** | 暂停=冻结，简单一致；要每帧收 dt 的场景后续加 unscaled |
| 6 | 退订/派发/错误 | 各自造 / **沿用 eventbus 接缝** | **沿用** | disposer + tick 快照重入安全 + 错误隔离经 ILogger，一致且已验证 |
| 7 | 消费/驱动接口 | 单接口含 tick / **ITimer + ITimerDriver 分离** | **分离** | 消费方看不到 tick，杜绝业务误调驱动 |
| 8 | DI fallback | 必须注册 / **TIMER token + getTimer() fallback** | **fallback + 文档强调 tick 责任** | 对齐 Logger/EventBus 范式；但明示"无 tick 不走时"这一差异 |
| 9 | Disposer 类型 | timer 自定义 / **复用 eventbus 的** | **复用** | 避免 core index `export *` 同名冲突；语义同一（`()=>void`） |

## Platform considerations（全平台 / 小游戏兼容）

- `TimerService` 纯 TS，node/web/所有小游戏/原生**无差异**。真实 dt 源由 engine 按平台提供（cc.director 已抹平平台）。
- **不受**后台节流/小游戏 setTimeout 差异影响——因为不依赖宿主定时器，只依赖引擎循环 dt（引擎 pause 时自然停 tick）。
- 与三种「热」：跨 bundle 共享须走全局 `TIMER` token（ADR-0001：AOT 共享层 + globalThis 根容器 → 各 bundle `getTimer()` 拿同一实例）。
- 浮点：`_now`/`due` 用 float 秒累加，长时运行有微小漂移，游戏定时精度足够；要绝对精度用帧计数场景请等 FrameScheduler。

## Testable seams + test plan（可测接缝 + vitest 用例）

- **可测性**：全纯 TS 零 cc。测试直接 `t.tick(sec)` 推进虚拟时间（确定性），`vi.fn()` 断言回调，`onError` 注入 fake 断言隔离。
- **用例清单**：
  1. `delay`：`delay(1,cb)`；`tick(0.5)` 不触发；再 `tick(0.5)` 触发一次；之后 `tick` 不再触发。
  2. `delay(0,cb)`（<=0）：下次 `tick(任意)` 即触发一次。
  3. `interval`：`interval(1,cb)`；`tick(1)` 触发 1 次；`tick(1)` 再 1 次（累计 2）。
  4. `interval` 大 dt 补触发：`interval(1,cb)`；`tick(3)` → 触发 3 次。
  5. `interval(0/负)` 抛错。
  6. `onFrame`：每次 `tick(dt)` 收到 effectiveDt；多次累加。
  7. `now`：`tick` 后 `now` = Σ effectiveDt。
  8. `timeScale=2`：`tick(1)` → now 前进 2、`delay(2)` 一帧即触发。
  9. `timeScale=0` / `paused`：`tick` 不推进 now、不触发定时、不调 onFrame（冻结）。
  10. **disposer**：`delay` 返回的 disposer 调用后不触发；重复调用幂等、不误伤后续新任务。
  11. `interval` disposer：取消后不再周期触发。
  12. `onFrame` disposer：取消后不再收帧。
  13. **重入安全**：定时回调里 `delay` 新任务 → 本轮不触发、下轮触发。
  14. **重入安全**：定时回调里 cancel 另一任务 → 该任务本轮不触发。
  15. **错误隔离**：一个定时 cb 抛异常 → `onError` 调用且其余定时/onFrame 仍触发。
  16. `clear()`：清空定时+帧回调，`now` 不变；之后 `tick` 无触发。
  17. `TIMER` token：`getTimer()` 未注册→进程级默认；`register(TIMER,fake)` 后→注入实现；注销后→回默认。
  18. 默认 `onError` 未注入时经 `getLogger('Timer').error` 上报（不抛）。

## Open Questions（已决议 · 2026-07-27 定稿）

1. **时间单位**：✅ **秒（float）**（对齐引擎 dt/cc schedule/godot delta/Unity）。
2. **timeScale/pause 语义**：✅ 所有定时/onFrame 均受影响，暂停即**完全冻结**（effectiveDt<=0 不推进不触发）；unscaled 双轨留后续。
3. **消费/驱动分离**：✅ `ITimer`（业务，无 tick）+ `ITimerDriver`（`tick`，engine/测试）双接口，`createTimer()` 返回 `ITimer & ITimerDriver`。
4. **DI fallback**：✅ **保留** `getTimer()` 进程级默认（对齐 Logger/EventBus 范式）；文档强调「无 tick 不走时、engine Bootstrap 须接 cc.director 驱动」这一差异。
5. **Disposer 复用**：✅ 复用 [[eventbus]] 导出的 `Disposer`（timer 不重复导出，避免 core index `export *` 同名冲突）；后续多模块共用再提取 `common`。
6. **能力集**：✅ 首版仅 `delay/interval/onFrame/now`，砍帧降频/预算队列/世界时钟/unscaled/墙钟（见横评 §3）。

---

## 实现记录

- **落地文件**：`packages/core/src/timer/timer.ts`（`ITimer`/`ITimerDriver` + `TimerService` + `createTimer` + `TIMER` token + `getTimer`）、`index.ts`（导出，不导出 `Disposer`）；由 core `index.ts` re-export。
- **最终 API 与设计偏差**：完全按定稿，无偏差。
- **实现要点**：外部 `tick(dt)` 驱动——`effectiveDt = paused ? 0 : dt * timeScale`，`!(edt>0)` 时冻结（不推进不触发，兼防 NaN/负 dt）；`tick` 先 `slice()` 快照 onFrame + tasks 再派发（重入安全），一帧内 `interval` 用 `while` 补触发追平大 dt，末尾 `_compactTasks` 清一次性死任务；每个 cb `try/catch` 经 `onError`（默认 `getLogger('Timer').error`）隔离；**消费/驱动分离**——`createTimer()` 返回 `ITimer & ITimerDriver`，`TIMER` token 类型仅 `ITimer`（消费方 `getTimer()` 拿不到 `tick`）；disposer 绑定到具体记录对象 + `disposed` 标记（精确移除、幂等、不误伤新注册）；`timeScale` setter 非法值夹 0；`Disposer` 复用 [[eventbus]]（timer 不重复导出）。
- **测试结果 / 覆盖率**：`vitest` 全绿（core 共 **75 测试**：DI 20 + Logger 13 + EventBus 19 + Timer 21 + 骨架 2）；`tsc -b`、`eslint` 干净。`timer.ts` 覆盖 **Stmts/Branch/Funcs/Lines 全 100%**；core All files 100/98.61/100/100（剩余 branch 缺口来自 DI/logger 早前已接受的防御分支）。
- **commit / PR**：待提交。
- **遗留 Minors**：engine **Bootstrap** 接 `cc.director` `EVENT_AFTER_UPDATE` 转发 dt 到 `tick()` + `register(TIMER, timerService)`（Bootstrap 阶段）；unscaled 双轨 / FrameScheduler（帧降频错峰 + 每帧预算队列）/ 世界日历时钟（对标 godot game_clock）留后续独立模块。
